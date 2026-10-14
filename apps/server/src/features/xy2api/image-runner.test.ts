import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadServerEnv } from "../../config/env.js";
import {
  clearProviders,
  registerImageProvider,
} from "../../generation/providers/registry.js";
import { BillingGuardError, GatewayError, mapGatewayError } from "./errors.js";
import {
  AsyncImageUnavailableError,
  ImageTaskParkedError,
  asyncImagesOff,
  resetAsyncImagesOff,
} from "./image-task.js";
import { TASK_LEASE_MS, THUMB_EDGE, executeImageJob, thumbnailPath } from "./image-runner.js";
import {
  MAX_DELIVERY_ATTEMPTS,
  type PendingDeliveryStore,
} from "./pending-delivery.js";
import { createXy2apiServices } from "./services.js";
import { memoryDatabase, memoryPendingDeliveries } from "./test-support.js";

afterEach(() => {
  clearProviders();
  resetAsyncImagesOff();
  vi.restoreAllMocks();
});
function setup(billing = "none") {
  const env = loadServerEnv(
    {},
    {
      XY2API_BASE_URL: "https://gateway.example.com",
      LOOMIC_SECRET_KEY: randomBytes(32).toString("base64"),
      SSO_EMAIL_DOMAIN: "sso.example.com",
    },
  );
  const db = memoryDatabase({
    background_jobs: [
      {
        id: "job-1",
        created_by: "user-1",
        workspace_id: "workspace-1",
        xy2api_key_id: 7,
        job_type: "image_generation",
        status: "running",
        billing_status: billing,
        payload: { model: "gpt-image-2", prompt: "test image", quality: "hd" },
      },
    ],
    workspace_members: [{ user_id: "user-1", workspace_id: "workspace-1" }],
    xy2api_accounts: [
      {
        user_id: "user-1",
        session_state: "active",
        access_token_enc: "encrypted-fixture",
      },
    ],
  });
  const xy2api = createXy2apiServices(env, () => db.admin);
  db.tables.xy2api_api_keys = [
    {
      user_id: "user-1",
      key_id: 7,
      status: "active",
      secret_enc: xy2api.box.sealSecret("synthetic-private-key"),
      image_capable: true,
      image_models: ["gpt-image-2"],
      chat_models: [],
      quota: 0,
      quota_used: 0,
      expires_at: null,
      invalid_reason: null,
      platform: "openai",
    },
  ];
  const generate = vi.fn(async () => ({
    url: "data:image/jpeg;base64,aW1hZ2U=",
    mimeType: "image/jpeg",
    width: 100,
    height: 100,
    requestId: "request-1",
  }));
  registerImageProvider({
    name: "xy2api-openai",
    models: [{ id: "gpt-image-2", displayName: "Test", description: "Test" }],
    generate,
  });
  return {
    ...db,
    env,
    xy2api,
    generate,
    execute: (deliveries?: PendingDeliveryStore) =>
      executeImageJob("job-1", {
        env,
        xy2api,
        getAdminClient: () => db.admin,
        ...(deliveries ? { deliveries } : {}),
      }),
  };
}
describe("image billing lifecycle", () => {
  it("allows only one paid dispatch for simultaneous deliveries", async () => {
    const fixture = setup();
    const results = await Promise.allSettled([
      fixture.execute(),
      fixture.execute(),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(fixture.generate).toHaveBeenCalledTimes(1);
  });
  it("stores charged status, request id, and the correct extension", async () => {
    const fixture = setup();
    const result = await fixture.execute();
    expect(result.object_path).toBe("workspace-1/generated/job-1.jpg");
    expect(fixture.tables.background_jobs?.[0]).toMatchObject({
      billing_status: "charged",
      xy2api_request_id: "request-1",
    });
    expect(JSON.stringify(fixture.tables.background_jobs)).not.toContain(
      "synthetic-private-key",
    );
    expect(fixture.generate).toHaveBeenCalledTimes(1);
  });
  it.each(["pending", "charged", "unknown"])(
    "never resends a %s job",
    async (billing) => {
      const fixture = setup(billing);
      await expect(fixture.execute()).rejects.toMatchObject({
        code: "upstream_unknown",
      });
      expect(fixture.generate).not.toHaveBeenCalled();
      expect(fixture.tables.background_jobs?.[0]?.billing_status).toBe(
        billing === "charged" ? "charged" : "unknown",
      );
    },
  );
  it("tells operators when a picture comes back under the 画质 asked for", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fixture = setup();
    const job = fixture.tables.background_jobs?.[0] as {
      payload: Record<string, unknown>;
    };
    job.payload = {
      model: "gpt-image-2",
      prompt: "test image",
      resolution: "4K",
      quality: "low",
      aspect_ratio: "3:4",
    };
    // Pre-launch site, main-site group gpt: 4K asked, 1085x1450 returned.
    fixture.generate.mockResolvedValueOnce({
      url: "data:image/png;base64,aW1hZ2U=",
      mimeType: "image/png",
      width: 1085,
      height: 1450,
      requestId: "request-4k",
    });
    await fixture.execute();
    expect(warn).toHaveBeenCalledWith(
      "[image-runner] job job-1 asked 4K of gpt-image-2 (key 7), got 1085x1450",
    );
    warn.mockClear();
    const real = setup();
    const realJob = real.tables.background_jobs?.[0] as {
      payload: Record<string, unknown>;
    };
    realJob.payload = { ...job.payload };
    real.generate.mockResolvedValueOnce({
      url: "data:image/png;base64,aW1hZ2U=",
      mimeType: "image/png",
      width: 2480,
      height: 3312,
      requestId: "request-4k-real",
    });
    await real.execute();
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining("[image-runner] job job-1 asked"),
    );
  });
  it("does not use another user's key", async () => {
    const fixture = setup();
    const key = fixture.tables.xy2api_api_keys?.[0];
    if (key) key.user_id = "other-user";
    await expect(fixture.execute()).rejects.toMatchObject({
      code: "key_unavailable",
    });
    expect(fixture.generate).not.toHaveBeenCalled();
  });
  it("passes a 局部重绘 edit to the provider with its one source", async () => {
    const fixture = setup();
    const job = fixture.tables.background_jobs?.[0];
    if (job)
      job.payload = {
        model: "gpt-image-2",
        prompt: "把杯子换成红色",
        resolution: "2K",
        quality: "auto",
        aspect_ratio: "1:1",
        input_images: ["https://assets.example.com/a.png"],
        edit: { mode: "inpaint", mask: "https://assets.example.com/m.png" },
      };
    await fixture.execute();
    expect(fixture.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "把杯子换成红色",
        inputImages: ["https://assets.example.com/a.png"],
        edit: { mode: "inpaint", mask: "https://assets.example.com/m.png" },
      }),
      expect.anything(),
    );
  });
  it("refuses an edit with two sources before claiming the job", async () => {
    const fixture = setup();
    const job = fixture.tables.background_jobs?.[0];
    if (job)
      job.payload = {
        model: "gpt-image-2",
        prompt: "x",
        resolution: "2K",
        quality: "auto",
        input_images: ["https://a.example/1.png", "https://a.example/2.png"],
        edit: { mode: "outpaint", scale: 1.5, anchor: "center" },
      };
    await expect(fixture.execute()).rejects.toMatchObject({
      code: "invalid_input",
    });
    expect(fixture.generate).not.toHaveBeenCalled();
    expect(fixture.tables.background_jobs?.[0]?.billing_status).toBe("none");
  });
  it("does not dispatch when the durable claim fails", async () => {
    const fixture = setup();
    fixture.failClaim();
    await expect(fixture.execute()).rejects.toThrow();
    expect(fixture.generate).not.toHaveBeenCalled();
  });
  it("retains an uncertain billing status after a timeout", async () => {
    const fixture = setup();
    fixture.generate.mockRejectedValue(new GatewayError(mapGatewayError({})));
    await expect(fixture.execute()).rejects.toMatchObject({
      code: "upstream_unknown",
    });
    expect(fixture.tables.background_jobs?.[0]?.billing_status).toBe("unknown");
    await expect(fixture.execute()).rejects.toThrow();
    expect(fixture.generate).toHaveBeenCalledTimes(1);
  });
  it("records an explicit gateway rejection as not charged and disables the key", async () => {
    const fixture = setup();
    fixture.generate.mockRejectedValue(
      new GatewayError(
        mapGatewayError({ status: 401, body: { code: "INVALID_API_KEY" } }),
      ),
    );
    await expect(fixture.execute()).rejects.toMatchObject({
      code: "key_unavailable",
    });
    expect(fixture.tables.background_jobs?.[0]?.billing_status).toBe(
      "not_charged",
    );
    expect(fixture.tables.xy2api_api_keys?.[0]?.invalid_reason).toBe(
      "key_unavailable",
    );
  });
  it.each([
    // xy2api risk-control block (shape from the recorded fixtures)
    {
      error: {
        message: "内容审计命中风险规则，请调整输入后重试",
        type: "content_policy_violation",
      },
    },
    // a refusal we cannot classify
    {
      error: { code: 403, message: "custom rule", status: "PERMISSION_DENIED" },
    },
  ])("keeps the key usable after a 403 refusal %#", async (body) => {
    const fixture = setup();
    fixture.generate.mockRejectedValue(
      new GatewayError(mapGatewayError({ status: 403, body })),
    );
    await expect(fixture.execute()).rejects.toThrow();
    expect(fixture.tables.background_jobs?.[0]?.billing_status).toBe(
      "not_charged",
    );
    expect(fixture.tables.xy2api_api_keys?.[0]?.invalid_reason ?? null).toBe(
      null,
    );
  });
  it("retries only storage uploads and preserves charged billing on failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fixture = setup();
    fixture.uploads.mockResolvedValue({ error: "fixture storage failure" });
    await expect(fixture.execute()).rejects.toMatchObject({
      code: "storage_failed",
    });
    expect(fixture.uploads).toHaveBeenCalledTimes(3);
    expect(fixture.generate).toHaveBeenCalledTimes(1);
    expect(fixture.tables.background_jobs?.[0]?.billing_status).toBe("charged");
  });
  it("holds a charged image when storage fails and delivers it later without a new request", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fixture = setup();
    const deliveries = memoryPendingDeliveries();
    fixture.uploads.mockResolvedValue({ error: { message: "storage down" } });
    await expect(fixture.execute(deliveries)).rejects.toMatchObject({
      code: "storage_retrying",
      retryInSeconds: 30,
    });
    expect(deliveries.rows.get("job-1")).toMatchObject({
      objectPath: "workspace-1/generated/job-1.jpg",
      mimeType: "image/jpeg",
      attempts: 1,
      lastError: expect.stringContaining("storage down"),
    });
    expect(fixture.tables.background_jobs?.[0]?.billing_status).toBe("charged");

    fixture.uploads.mockResolvedValue({ error: null });
    const result = await fixture.execute(deliveries);
    expect(result).toMatchObject({
      object_path: "workspace-1/generated/job-1.jpg",
      width: 100,
      height: 100,
    });
    expect(fixture.uploads).toHaveBeenLastCalledWith(
      "workspace-1/generated/job-1.jpg",
      Buffer.from("image"),
      expect.objectContaining({ contentType: "image/jpeg" }),
    );
    expect(fixture.generate).toHaveBeenCalledTimes(1);
    expect(fixture.tables.asset_objects).toHaveLength(1);
    // The worker removes the held copy once success is recorded.
    expect(deliveries.rows.has("job-1")).toBe(true);
  });
  it("backs off between storage attempts and gives up keeping the held image", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fixture = setup("charged");
    const deliveries = memoryPendingDeliveries();
    await deliveries.hold(
      {
        jobId: "job-1",
        objectPath: "workspace-1/generated/job-1.png",
        mimeType: "image/png",
        width: 64,
        height: 64,
        bytes: Buffer.from("held"),
      },
      "storage down",
    );
    fixture.uploads.mockResolvedValue({ error: { message: "storage down" } });
    const waits: number[] = [];
    for (let attempt = 2; attempt < MAX_DELIVERY_ATTEMPTS; attempt++)
      await fixture.execute(deliveries).catch((error) => {
        waits.push(error.retryInSeconds);
      });
    expect(waits).toEqual([60, 120, 240, 480, 600, 600, 600, 600, 600, 600]);
    await expect(fixture.execute(deliveries)).rejects.toMatchObject({
      code: "storage_failed",
    });
    expect(deliveries.rows.get("job-1")?.attempts).toBe(MAX_DELIVERY_ATTEMPTS);
    expect(fixture.generate).not.toHaveBeenCalled();
  });
  it("reuses the asset row written by an earlier delivery attempt", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fixture = setup("charged");
    const deliveries = memoryPendingDeliveries();
    await deliveries.hold(
      {
        jobId: "job-1",
        objectPath: "workspace-1/generated/job-1.png",
        mimeType: "image/png",
        width: 64,
        height: 64,
        bytes: Buffer.from("held"),
      },
      "asset row: timeout",
    );
    fixture.tables.asset_objects = [
      {
        id: "asset-earlier",
        bucket: "project-assets",
        object_path: "workspace-1/generated/job-1.png",
      },
    ];
    await expect(fixture.execute(deliveries)).resolves.toMatchObject({
      asset_id: "asset-earlier",
    });
    expect(fixture.tables.asset_objects).toHaveLength(1);
  });
  it("fails as storage_failed when the charged image cannot be held", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fixture = setup();
    const deliveries = memoryPendingDeliveries();
    deliveries.hold = vi.fn(async () => {
      throw new Error("database down");
    });
    fixture.uploads.mockResolvedValue({ error: { message: "storage down" } });
    await expect(fixture.execute(deliveries)).rejects.toMatchObject({
      code: "storage_failed",
    });
    expect(fixture.generate).toHaveBeenCalledTimes(1);
  });
  it("keeps a charged job without a held image for reconciliation", async () => {
    const fixture = setup("charged");
    await expect(
      fixture.execute(memoryPendingDeliveries()),
    ).rejects.toMatchObject({ code: "upstream_unknown" });
    expect(fixture.generate).not.toHaveBeenCalled();
  });
  it.each([
    { prompt: "x".repeat(4001), model: "gpt-image-2" },
    { prompt: "test", model: "unavailable-model" },
    { prompt: "test", model: "gpt-image-2", resolution: "8K" },
    // "max" is a real level since 第 66 条; an unknown one is still refused.
    { prompt: "test", model: "gpt-image-2", resolution: "2K", quality: "ultra-max" },
    { prompt: "test", model: "gpt-image-2", resolution: "2K", quality: "auto", output_format: "gif" },
    { prompt: "test", model: "gpt-image-2", resolution: "2K", quality: "auto", output_compression: 101 },
    { prompt: "test", model: "gpt-image-2", aspect_ratio: "wide" },
  ])("revalidates untrusted job data", async (payload) => {
    const fixture = setup();
    const row = fixture.tables.background_jobs?.[0];
    if (row) row.payload = payload;
    await expect(fixture.execute()).rejects.toThrow();
    expect(fixture.generate).not.toHaveBeenCalled();
  });
});

describe("list thumbnails", () => {
  async function largeImage() {
    const bytes = await sharp({
      create: { width: 1600, height: 1000, channels: 3, background: { r: 200, g: 90, b: 70 } },
    })
      .png()
      .toBuffer();
    return {
      url: `data:image/png;base64,${bytes.toString("base64")}`,
      mimeType: "image/png",
      width: 1600,
      height: 1000,
      requestId: "request-1",
    };
  }

  it("names the thumbnail after the picture", () => {
    expect(thumbnailPath("ws/generated/job.png")).toBe("ws/generated/job.thumb.webp");
    expect(thumbnailPath("ws/generated/job.jpg")).toBe("ws/generated/job.thumb.webp");
  });

  it("stores a WebP thumbnail next to a large picture and returns its URL", async () => {
    const fixture = setup();
    fixture.generate.mockResolvedValueOnce(await largeImage());
    const result = await fixture.execute();
    expect(result).toMatchObject({
      object_path: "workspace-1/generated/job-1.png",
      thumb_path: "workspace-1/generated/job-1.thumb.webp",
      thumb_url: "https://storage.example.com/workspace-1/generated/job-1.thumb.webp",
    });
    const call = fixture.uploads.mock.calls.find(
      (args: unknown[]) => args[0] === "workspace-1/generated/job-1.thumb.webp",
    ) as unknown[] | undefined;
    expect(call?.[2]).toMatchObject({ contentType: "image/webp", upsert: true });
    const meta = await sharp(call?.[1] as Buffer).metadata();
    expect(meta).toMatchObject({ format: "webp", width: THUMB_EDGE, height: 480 });
  });

  it("skips the thumbnail for a picture that is already small", async () => {
    const fixture = setup();
    const result = await fixture.execute();
    expect(result.thumb_url).toBeUndefined();
    expect(fixture.uploads).toHaveBeenCalledTimes(1);
  });

  it("still delivers the picture when the thumbnail upload fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fixture = setup();
    fixture.generate.mockResolvedValueOnce(await largeImage());
    fixture.uploads.mockImplementation(async (...args: unknown[]) =>
      String(args[0]).endsWith(".thumb.webp") ? { error: { message: "thumb refused" } } : { error: null },
    );
    const result = await fixture.execute();
    expect(result.object_path).toBe("workspace-1/generated/job-1.png");
    expect(result.thumb_url).toBeUndefined();
    expect(fixture.tables.background_jobs?.[0]?.billing_status).toBe("charged");
    expect(fixture.generate).toHaveBeenCalledTimes(1);
  });
});

describe("async image tasks (FINDINGS G7 step 2)", () => {
  function asyncSetup(
    job: Record<string, unknown> = {},
    envVars: Record<string, string> = {},
  ) {
    const env = loadServerEnv(
      {},
      {
        XY2API_BASE_URL: "https://gateway.example.com",
        LOOMIC_SECRET_KEY: randomBytes(32).toString("base64"),
        SSO_EMAIL_DOMAIN: "sso.example.com",
        XY2API_ASYNC_IMAGES: "on",
        ...envVars,
      },
    );
    const db = memoryDatabase({
      background_jobs: [
        {
          id: "job-1",
          created_by: "user-1",
          workspace_id: "workspace-1",
          xy2api_key_id: 7,
          job_type: "image_generation",
          status: "running",
          billing_status: "none",
          payload: {
            model: "gpt-image-2",
            prompt: "test image",
            input_images: ["https://storage.example.com/ref.png"],
          },
          ...job,
        },
      ],
      workspace_members: [{ user_id: "user-1", workspace_id: "workspace-1" }],
      xy2api_accounts: [
        { user_id: "user-1", session_state: "active", access_token_enc: "encrypted-fixture" },
      ],
    });
    const xy2api = createXy2apiServices(env, () => db.admin);
    db.tables.xy2api_api_keys = [
      {
        user_id: "user-1",
        key_id: 7,
        status: "active",
        secret_enc: xy2api.box.sealSecret("synthetic-private-key"),
        image_capable: true,
        image_models: ["gpt-image-2"],
        chat_models: [],
        quota: 0,
        quota_used: 0,
        expires_at: null,
        invalid_reason: null,
        platform: "openai",
      },
    ];
    const image = {
      url: "data:image/jpeg;base64,aW1hZ2U=",
      mimeType: "image/jpeg",
      width: 100,
      height: 100,
    };
    const generate = vi.fn(
      async (
        _params: import("../../generation/types.js").ImageGenerateParams,
        ctx?: import("../../generation/types.js").ImageCallContext,
      ) => {
        const task = ctx?.imageTask;
        if (task && !task.resume) {
          task.handle = { taskId: "imgtask_1", requestId: "req-task", submittedAt: Date.now() };
          await task.onAccepted?.(task.handle);
        } else if (task?.resume) task.handle = task.resume;
        return image;
      },
    );
    registerImageProvider({
      name: "xy2api-openai",
      models: [{ id: "gpt-image-2", displayName: "Test", description: "Test" }],
      generate,
    });
    const park = new AbortController();
    return {
      ...db,
      generate,
      park,
      job: () => db.tables.background_jobs?.[0] as Record<string, unknown>,
      execute: () =>
        executeImageJob("job-1", {
          env,
          xy2api,
          getAdminClient: () => db.admin,
          park: park.signal,
        }),
    };
  }
  const old = () => new Date(Date.now() - 5 * 60_000).toISOString();

  it("sends an OpenAI key's image as a task and stores the task before polling", async () => {
    const fixture = asyncSetup();
    await fixture.execute();
    const ctx = fixture.generate.mock.calls[0]?.[1];
    expect(ctx?.imageTask).toBeDefined();
    expect(ctx?.imageTask?.park).toBe(fixture.park.signal);
    expect(fixture.job()).toMatchObject({
      billing_status: "charged",
      xy2api_task_id: "imgtask_1",
      xy2api_request_id: "req-task",
    });
    expect(fixture.job().xy2api_task_submitted_at).toEqual(expect.any(String));
  });

  it("stays synchronous when switched off or outside the canary list", async () => {
    const off = asyncSetup({}, { XY2API_ASYNC_IMAGES: "off" });
    await off.execute();
    expect(off.generate.mock.calls[0]?.[1]?.imageTask).toBeUndefined();
    clearProviders();
    const canary = asyncSetup({}, { XY2API_ASYNC_IMAGE_USERS: "user-2, user-3" });
    await canary.execute();
    expect(canary.generate.mock.calls[0]?.[1]?.imageTask).toBeUndefined();
    clearProviders();
    const listed = asyncSetup({}, { XY2API_ASYNC_IMAGE_USERS: "user-1" });
    await listed.execute();
    expect(listed.generate.mock.calls[0]?.[1]?.imageTask).toBeDefined();
  });

  it("sends synchronously when the main site has no async tasks, and remembers", async () => {
    const fixture = asyncSetup();
    fixture.generate.mockImplementationOnce(async () => {
      throw new AsyncImageUnavailableError("async image tasks are not enabled");
    });
    await fixture.execute();
    expect(fixture.generate).toHaveBeenCalledTimes(2);
    expect(fixture.generate.mock.calls[1]?.[1]?.imageTask).toBeUndefined();
    expect(fixture.job().billing_status).toBe("charged");
    expect(asyncImagesOff("openai")).toBe(true);
  });

  it("resumes a stored task without sending or reading references again", async () => {
    const fixture = asyncSetup({
      billing_status: "pending",
      xy2api_task_id: "imgtask_9",
      xy2api_request_id: "req-9",
      xy2api_task_submitted_at: old(),
      xy2api_task_polled_at: old(),
    });
    await fixture.execute();
    expect(fixture.generate).toHaveBeenCalledTimes(1);
    const [params, ctx] = fixture.generate.mock.calls[0] ?? [];
    expect(ctx?.imageTask?.resume).toMatchObject({ taskId: "imgtask_9", requestId: "req-9" });
    expect(params?.inputImages).toBeUndefined();
    expect(fixture.job()).toMatchObject({ billing_status: "charged", xy2api_request_id: "req-9" });
  });

  it("leaves a task to the process still polling it", async () => {
    const fixture = asyncSetup({
      billing_status: "pending",
      xy2api_task_id: "imgtask_9",
      xy2api_task_submitted_at: old(),
      xy2api_task_polled_at: new Date().toISOString(),
    });
    await expect(fixture.execute()).rejects.toBeInstanceOf(ImageTaskParkedError);
    expect(fixture.generate).not.toHaveBeenCalled();
    expect(fixture.job().billing_status).toBe("pending");
  });

  it("settles a task it can no longer read from the usage list, never as free", async () => {
    const fixture = asyncSetup({
      billing_status: "pending",
      xy2api_task_id: "imgtask_9",
      xy2api_request_id: "req-9",
      xy2api_task_submitted_at: old(),
      xy2api_task_polled_at: old(),
    });
    (fixture.tables.xy2api_api_keys?.[0] as Record<string, unknown>).status = "disabled";
    const error = await fixture.execute().catch((caught) => caught);
    expect(error).toBeInstanceOf(GatewayError);
    expect(error.failure).toMatchObject({ billing: "unknown", requestId: "req-9" });
    expect(fixture.job()).toMatchObject({ billing_status: "unknown", xy2api_request_id: "req-9" });
    expect(fixture.generate).not.toHaveBeenCalled();
  });

  it("never records a resumed task as not charged on a local refusal", async () => {
    const fixture = asyncSetup({
      billing_status: "pending",
      xy2api_task_id: "imgtask_9",
      xy2api_request_id: "req-9",
      xy2api_task_submitted_at: old(),
      xy2api_task_polled_at: old(),
    });
    fixture.generate.mockImplementationOnce(async () => {
      throw new BillingGuardError("invalid_input");
    });
    await expect(fixture.execute()).rejects.toBeInstanceOf(GatewayError);
    expect(fixture.job()).toMatchObject({ billing_status: "unknown", xy2api_request_id: "req-9" });
  });

  it("keeps the task's request id when the task fails", async () => {
    const fixture = asyncSetup();
    fixture.generate.mockImplementationOnce(async (_params, ctx) => {
      const task = ctx?.imageTask;
      if (task) {
        task.handle = { taskId: "imgtask_1", requestId: "req-task", submittedAt: Date.now() };
        await task.onAccepted?.(task.handle);
      }
      throw new Error("Image download failed");
    });
    await expect(fixture.execute()).rejects.toBeInstanceOf(GatewayError);
    expect(fixture.job()).toMatchObject({ billing_status: "unknown", xy2api_request_id: "req-task", xy2api_task_id: "imgtask_1" });
  });

  it("parks on shutdown without touching billing", async () => {
    const fixture = asyncSetup();
    fixture.generate.mockImplementationOnce(async (_params, ctx) => {
      const task = ctx?.imageTask;
      if (task) {
        task.handle = { taskId: "imgtask_1", requestId: "req-task", submittedAt: Date.now() };
        await task.onAccepted?.(task.handle);
      }
      throw new ImageTaskParkedError();
    });
    await expect(fixture.execute()).rejects.toBeInstanceOf(ImageTaskParkedError);
    expect(fixture.job()).toMatchObject({ billing_status: "pending", xy2api_task_id: "imgtask_1" });
    // Handed over: the next worker takes the lease at once.
    expect(Date.parse(String(fixture.job().xy2api_task_polled_at))).toBeLessThan(Date.now() - TASK_LEASE_MS);
  });
});
