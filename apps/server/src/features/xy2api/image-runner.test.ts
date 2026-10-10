import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadServerEnv } from "../../config/env.js";
import {
  clearProviders,
  registerImageProvider,
} from "../../generation/providers/registry.js";
import { GatewayError, mapGatewayError } from "./errors.js";
import { executeImageJob } from "./image-runner.js";
import {
  MAX_DELIVERY_ATTEMPTS,
  type PendingDeliveryStore,
} from "./pending-delivery.js";
import { createXy2apiServices } from "./services.js";
import { memoryDatabase, memoryPendingDeliveries } from "./test-support.js";

afterEach(() => {
  clearProviders();
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
    { prompt: "test", model: "gpt-image-2", resolution: "2K", quality: "max" },
    { prompt: "test", model: "gpt-image-2", aspect_ratio: "wide" },
  ])("revalidates untrusted job data", async (payload) => {
    const fixture = setup();
    const row = fixture.tables.background_jobs?.[0];
    if (row) row.payload = payload;
    await expect(fixture.execute()).rejects.toThrow();
    expect(fixture.generate).not.toHaveBeenCalled();
  });
});
