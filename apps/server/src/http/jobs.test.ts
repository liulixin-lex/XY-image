import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import {
  type JobService,
  JobServiceError,
} from "../features/jobs/job-service.js";
import type { BillingGuard } from "../features/xy2api/billing-guard.js";
import { BillingGuardError } from "../features/xy2api/errors.js";
import { registerJobRoutes } from "./jobs.js";

afterEach(() => vi.restoreAllMocks());

const BATCH = "8f14e45f-ceea-4e7a-9f6c-1d2b3c4d5e6f";

function job(index: number, payload: Record<string, unknown>) {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    workspace_id: "00000000-0000-4000-8000-0000000000aa",
    project_id: null,
    canvas_id: null,
    session_id: null,
    thread_id: null,
    queue_name: "image_generation_jobs",
    job_type: "image_generation",
    status: "queued",
    payload,
    result: null,
    error_code: null,
    error_message: null,
    attempt_count: 0,
    max_attempts: 1,
    billing_status: "none",
    created_by: "00000000-0000-4000-8000-0000000000bb",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    started_at: null,
    completed_at: null,
    failed_at: null,
    canceled_at: null,
  };
}

async function route() {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const app = Fastify();
  let made = 0;
  const jobService = {
    createJob: vi.fn(
      async (_user: unknown, input: { payload: Record<string, unknown> }) =>
        job(made++, input.payload),
    ),
    cancelUnsentInBatch: vi.fn(async () => [
      "00000000-0000-4000-8000-000000000002",
    ]),
    listJobs: vi.fn(async () => [] as ReturnType<typeof job>[]),
    getJob: vi.fn(async () => job(0, {})),
    deleteJobs: vi.fn(async (_user: unknown, ids: string[]) => ({
      deleted: ids.slice(1),
      skipped: ids.slice(0, 1),
    })),
    restoreJobs: vi.fn(async (_user: unknown, ids: string[]) => ids),
  };
  const billing = {
    withUserLock: (_id: string, fn: () => Promise<unknown>) => fn(),
    prepareImageJobs: vi.fn(
      async (
        _user: unknown,
        _input: unknown,
        targets: { model?: string; key_id?: number; count: number }[],
      ) =>
        targets.map((target) => ({
          keyId: target.key_id ?? 7,
          model: target.model || "gpt-image-2",
          resolution: "2K" as const,
          quality: "high" as const,
          aspect_ratio: "3:4",
          count: target.count,
        })),
    ),
  };
  await registerJobRoutes(app, {
    auth: {
      authenticate: async () => ({
        id: "user-1",
        accessToken: "token",
        email: "",
        userMetadata: {},
      }),
    },
    billing: billing as unknown as BillingGuard,
    jobService: jobService as unknown as JobService,
    viewerService: {
      ensureViewer: async () => ({
        workspace: { id: "00000000-0000-4000-8000-0000000000aa" },
      }),
    } as unknown as ViewerService,
  });
  return { app, jobService, billing };
}

describe("studio batch routes", () => {
  it("queues one job per picture under one batch id, admitted together", async () => {
    const { app, jobService, billing } = await route();
    const response = await app.inject({
      method: "POST",
      url: "/api/jobs/image-generation/batch",
      payload: { prompt: "雨夜霓虹街口", aspect_ratio: "3:4", count: 3 },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.requested).toBe(3);
    expect(body.jobs).toHaveLength(3);
    expect(billing.prepareImageJobs).toHaveBeenCalledOnce();
    expect(billing.prepareImageJobs).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-1" }),
      expect.objectContaining({ prompt: "雨夜霓虹街口" }),
      [{ model: "", count: 3 }],
    );
    const payloads = jobService.createJob.mock.calls.map(
      ([, input]) => input.payload,
    );
    expect(payloads.map((p) => p.batch_index)).toEqual([0, 1, 2]);
    expect(new Set(payloads.map((p) => p.batch_id))).toEqual(
      new Set([body.batch_id]),
    );
    // The stored payload holds what the billing guard resolved for the model.
    expect(payloads[0]).toMatchObject({
      prompt: "雨夜霓虹街口",
      model: "gpt-image-2",
      resolution: "2K",
      quality: "high",
      aspect_ratio: "3:4",
      batch_size: 3,
    });
    expect(payloads[0]).not.toHaveProperty("count");
  });

  it("stores the output options the billing guard resolved, not the request's (第 66 条)", async () => {
    const { app, jobService, billing } = await route();
    billing.prepareImageJobs.mockImplementationOnce(async () => [
      {
        keyId: 7,
        model: "gpt-image-2.5-sunburst",
        resolution: "2K" as const,
        quality: "max" as const,
        aspect_ratio: "1:1",
        // Transparent moved jpeg to png.
        background: "transparent",
        output_format: "png",
        moderation: "low",
        count: 1,
      },
      {
        keyId: 8,
        model: "grok-imagine-image-2.0",
        resolution: "2K" as const,
        quality: "medium" as const,
        aspect_ratio: "1:1",
        count: 1,
      },
    ] as never);
    const response = await app.inject({
      method: "POST",
      url: "/api/jobs/image-generation/batch",
      payload: {
        prompt: "透明底的狐狸贴纸",
        quality: "max",
        background: "transparent",
        output_format: "jpeg",
        output_compression: 80,
        moderation: "low",
        targets: [
          { model: "gpt-image-2.5-sunburst", key_id: 7, count: 1 },
          { model: "grok-imagine-image-2.0", key_id: 8, count: 1 },
        ],
      },
    });
    expect(response.statusCode).toBe(201);
    const [openaiJob, grokJob] = jobService.createJob.mock.calls.map(
      ([, input]) => input.payload,
    );
    expect(openaiJob).toMatchObject({
      quality: "max",
      background: "transparent",
      output_format: "png",
      moderation: "low",
    });
    expect(openaiJob?.output_compression).toBeUndefined();
    // Grok takes none of them: the request's own values are not kept.
    expect(grokJob?.background).toBeUndefined();
    expect(grokJob?.output_format).toBeUndefined();
    expect(grokJob?.moderation).toBeUndefined();
  });

  it("refuses output options outside the vendors' values", async () => {
    const { app } = await route();
    for (const extra of [
      { output_format: "gif" },
      { output_compression: 120 },
      { background: "blurred" },
      { moderation: "off" },
      { quality: "ultra-max" },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/jobs/image-generation/batch",
        payload: { prompt: "x", count: 1, ...extra },
      });
      expect(response.statusCode).toBe(400);
    }
  });

  it("stores each picture's canvas slot and generator node (node canvas)", async () => {
    const { app, jobService } = await route();
    const canvas = "00000000-0000-4000-8000-0000000000cc";
    const slots = [
      { x: 400, y: 0, width: 240, height: 320 },
      { x: 660, y: 0, width: 240, height: 320 },
    ];
    const response = await app.inject({
      method: "POST",
      url: "/api/jobs/image-generation/batch",
      payload: {
        prompt: "雨夜霓虹街口",
        count: 2,
        canvas_id: canvas,
        canvas_source_id: "gen-1",
        canvas_slots: slots,
      },
    });
    expect(response.statusCode).toBe(201);
    const payloads = jobService.createJob.mock.calls.map(
      ([, input]) => input.payload,
    );
    expect(payloads.map((p) => p.canvas_slot)).toEqual(slots);
    expect(payloads.every((p) => p.canvas_source_id === "gen-1")).toBe(true);
    expect(payloads[0]).not.toHaveProperty("canvas_slots");
    // Without a canvas the placement means nothing and is not stored.
    jobService.createJob.mockClear();
    await app.inject({
      method: "POST",
      url: "/api/jobs/image-generation/batch",
      payload: { prompt: "x", count: 1, canvas_slots: [slots[0]] },
    });
    expect(jobService.createJob.mock.calls[0]?.[1].payload).not.toHaveProperty(
      "canvas_slot",
    );
    // Absurd geometry is refused before anything is queued.
    const bad = await app.inject({
      method: "POST",
      url: "/api/jobs/image-generation/batch",
      payload: {
        prompt: "x",
        count: 1,
        canvas_id: canvas,
        canvas_slots: [{ x: 0, y: 0, width: 1e9, height: 10 }],
      },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("returns the pictures that were queued when a later one fails", async () => {
    const { app, jobService } = await route();
    // Created 8 at a time: the 2nd of the first chunk fails, the other 7 of
    // that chunk are real jobs and come back; the next chunks are not tried.
    jobService.createJob
      .mockImplementationOnce(async (_user, input) => job(0, input.payload))
      .mockRejectedValueOnce(
        new JobServiceError("job_create_failed", "queue down", 500),
      );
    const response = await app.inject({
      method: "POST",
      url: "/api/jobs/image-generation/batch",
      payload: { prompt: "海边日落", count: 20 },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ requested: 20 });
    expect(response.json().jobs).toHaveLength(7);
    expect(jobService.createJob).toHaveBeenCalledTimes(8);
  });

  it("queues hundreds from one click, numbered in order (第 57 条)", async () => {
    const { app, jobService } = await route();
    const response = await app.inject({
      method: "POST",
      url: "/api/jobs/image-generation/batch",
      payload: {
        prompt: "海边日落",
        targets: [
          { model: "gpt-image-2", count: 120 },
          { model: "nano-banana-2.1", count: 80 },
        ],
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().jobs).toHaveLength(200);
    const indexes = jobService.createJob.mock.calls.map((call) => Number(call[1].payload.batch_index));
    expect(new Set(indexes).size).toBe(200);
    expect(Math.max(...indexes)).toBe(199);
  });

  it("refuses a batch over the limit or past the pending cap", async () => {
    const { app, billing } = await route();
    // Only the runaway guard (IMAGE_REQUEST_MAX = 500) is left.
    const tooMany = await app.inject({
      method: "POST",
      url: "/api/jobs/image-generation/batch",
      payload: { prompt: "海边日落", count: 501 },
    });
    expect(tooMany.statusCode).toBe(400);
    billing.prepareImageJobs.mockRejectedValueOnce(
      new BillingGuardError("concurrency_limit", 429),
    );
    const capped = await app.inject({
      method: "POST",
      url: "/api/jobs/image-generation/batch",
      payload: { prompt: "海边日落", count: 2 },
    });
    expect(capped.statusCode).toBe(429);
    expect(capped.json().error.code).toBe("concurrency_limit");
  });

  it("runs several models side by side, each through its own key (第 56 条)", async () => {
    const { app, jobService, billing } = await route();
    const response = await app.inject({
      method: "POST",
      url: "/api/jobs/image-generation/batch",
      payload: {
        prompt: "雨夜霓虹街口",
        targets: [
          { model: "gpt-image-2", key_id: 11, count: 2 },
          { model: "nano-banana-2.1", key_id: 12, count: 1 },
          { model: "grok-imagine-image-2.0", count: 1 },
        ],
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().requested).toBe(4);
    expect(billing.prepareImageJobs).toHaveBeenCalledOnce();
    const calls = jobService.createJob.mock.calls.map(([, input]) => input);
    expect(
      calls.map((input) => [
        input.payload.model,
        (input as { xy2apiKeyId?: number }).xy2apiKeyId,
        input.payload.batch_index,
        input.payload.batch_size,
      ]),
    ).toEqual([
      ["gpt-image-2", 11, 0, 4],
      ["gpt-image-2", 11, 1, 4],
      ["nano-banana-2.1", 12, 2, 4],
      ["grok-imagine-image-2.0", 7, 3, 4],
    ]);
    expect(calls[0]?.payload).not.toHaveProperty("targets");
    expect(calls[0]?.payload).not.toHaveProperty("key_id");
  });

  it("refuses malformed 多模型 requests before anything is queued", async () => {
    const { app, jobService } = await route();
    const bad = [
      // targets replace count / model / key_id
      { prompt: "x", count: 1, targets: [{ model: "a", count: 1 }] },
      { prompt: "x", model: "a", targets: [{ model: "b", count: 1 }] },
      // neither
      { prompt: "x" },
      // more than IMAGE_REQUEST_MAX (500) pictures
      {
        prompt: "x",
        targets: [
          { model: "a", count: 400 },
          { model: "b", count: 101 },
        ],
      },
      // the same model through the same key twice
      {
        prompt: "x",
        targets: [
          { model: "a", key_id: 3, count: 1 },
          { model: "a", key_id: 3, count: 1 },
        ],
      },
      // a canvas run needs one slot per picture
      {
        prompt: "x",
        canvas_id: "00000000-0000-4000-8000-0000000000cc",
        canvas_slots: [{ x: 0, y: 0, width: 100, height: 100 }],
        targets: [
          { model: "a", count: 1 },
          { model: "b", count: 1 },
        ],
      },
    ];
    for (const payload of bad) {
      const response = await app.inject({
        method: "POST",
        url: "/api/jobs/image-generation/batch",
        payload,
      });
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect(jobService.createJob).not.toHaveBeenCalled();
  });

  it("cancels only the unsent pictures of a batch", async () => {
    const { app, jobService } = await route();
    const response = await app.inject({
      method: "POST",
      url: `/api/jobs/image-batches/${BATCH}/cancel`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      batch_id: BATCH,
      canceled: ["00000000-0000-4000-8000-000000000002"],
    });
    expect(jobService.cancelUnsentInBatch).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-1" }),
      BATCH,
    );
    const bad = await app.inject({
      method: "POST",
      url: "/api/jobs/image-batches/not-a-uuid/cancel",
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe("job history pages (第 56 条)", () => {
  it("passes the page to the service and says where the next one starts", async () => {
    const { app, jobService } = await route();
    const page = Object.assign([job(1, { prompt: "a" }), job(2, { prompt: "b" })], {
      more: true,
    });
    page[1]!.created_at = "2026-10-12T08:00:00.000Z";
    jobService.listJobs.mockResolvedValueOnce(page);
    const response = await app.inject({
      method: "GET",
      url: "/api/jobs?job_type=image_generation&status=succeeded&limit=2&before=2026-10-12T09:00:00.000Z",
    });
    expect(response.statusCode).toBe(200);
    expect(jobService.listJobs).toHaveBeenCalledWith(expect.anything(), {
      jobType: "image_generation",
      status: "succeeded",
      limit: 2,
      before: "2026-10-12T09:00:00.000Z",
    });
    expect(response.json().next_before).toBe("2026-10-12T08:00:00.000Z");
    // The last page has no next one.
    jobService.listJobs.mockResolvedValueOnce([job(3, { prompt: "c" })]);
    const last = await app.inject({ method: "GET", url: "/api/jobs" });
    expect(last.json().next_before).toBeNull();
    // 最近生成 filters by where a picture was made.
    jobService.listJobs.mockResolvedValueOnce([]);
    await app.inject({ method: "GET", url: "/api/jobs?job_type=image_generation&source=canvas" });
    expect(jobService.listJobs).toHaveBeenLastCalledWith(expect.anything(), {
      jobType: "image_generation",
      source: "canvas",
    });
    // A bad cursor, page size or source is the caller's mistake, not a 500.
    for (const query of ["before=yesterday", "limit=0", "limit=101", "source=everywhere"]) {
      const bad = await app.inject({ method: "GET", url: `/api/jobs?${query}` });
      expect(bad.statusCode, query).toBe(400);
    }
  });
});

describe("picture titles (第 58 条)", () => {
  it("stores the user's own words as the title when the prompt carries more", async () => {
    const { app, jobService } = await route();
    const response = await app.inject({
      method: "POST",
      url: "/api/jobs/image-generation/batch",
      payload: { prompt: "秋季新品海报\n\n【品牌规范·咖啡店】配色以朱红为主", title: "秋季新品海报", count: 2 },
    });
    expect(response.statusCode).toBe(201);
    const payloads = jobService.createJob.mock.calls.map((call) => call[1].payload);
    expect(payloads).toHaveLength(2);
    for (const payload of payloads) {
      expect(payload.title).toBe("秋季新品海报");
      expect(payload.prompt).toContain("【品牌规范");
    }
    // Without a title nothing is stored, as before.
    jobService.createJob.mockClear();
    await app.inject({ method: "POST", url: "/api/jobs/image-generation/batch", payload: { prompt: "灯塔", count: 1 } });
    expect(jobService.createJob.mock.calls[0]![1].payload).not.toHaveProperty("title");
  });
});

describe("生成记录 pages and deleting pictures (第 58 条)", () => {
  const ids = [
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002",
    "00000000-0000-4000-8000-000000000003",
  ];

  it("passes numbered pages and filters, and returns the totals", async () => {
    const { app, jobService } = await route();
    jobService.listJobs.mockResolvedValueOnce(
      Object.assign([job(1, { prompt: "a" })], {
        more: true,
        total: 41,
        counts: { all: 120, reconcile: 2, failed: 41 },
      }),
    );
    const response = await app.inject({
      method: "GET",
      url: "/api/jobs?job_type=image_generation&offset=40&limit=20&view=failed&with_total=1",
    });
    expect(response.statusCode).toBe(200);
    expect(jobService.listJobs).toHaveBeenCalledWith(expect.anything(), {
      jobType: "image_generation",
      offset: 40,
      limit: 20,
      view: "failed",
      withTotal: true,
    });
    expect(response.json()).toMatchObject({
      total: 41,
      counts: { all: 120, reconcile: 2, failed: 41 },
    });
    // Without with_total the response has no totals, as before.
    jobService.listJobs.mockResolvedValueOnce([]);
    const plain = await app.inject({ method: "GET", url: "/api/jobs" });
    expect(plain.json()).not.toHaveProperty("total");
    for (const query of ["offset=-1", "view=paid", "with_total=yes"]) {
      const bad = await app.inject({ method: "GET", url: `/api/jobs?${query}` });
      expect(bad.statusCode, query).toBe(400);
    }
  });

  it("deletes the pictures it can and says which it skipped", async () => {
    const { app, jobService } = await route();
    const response = await app.inject({
      method: "POST",
      url: "/api/jobs/delete",
      payload: { ids },
    });
    expect(response.statusCode).toBe(200);
    expect(jobService.deleteJobs).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-1" }),
      ids,
    );
    expect(response.json()).toEqual({ deleted: ids.slice(1), skipped: ids.slice(0, 1) });
  });

  it("restores deleted pictures (撤销)", async () => {
    const { app, jobService } = await route();
    const response = await app.inject({
      method: "POST",
      url: "/api/jobs/restore",
      payload: { ids: ids.slice(0, 2) },
    });
    expect(response.statusCode).toBe(200);
    expect(jobService.restoreJobs).toHaveBeenCalledWith(expect.anything(), ids.slice(0, 2));
    expect(response.json()).toEqual({ restored: ids.slice(0, 2) });
  });

  it("refuses an empty, oversized or malformed id list", async () => {
    const { app, jobService } = await route();
    const many = Array.from(
      { length: 501 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    );
    for (const payload of [{}, { ids: [] }, { ids: ["not-a-uuid"] }, { ids: many }]) {
      for (const url of ["/api/jobs/delete", "/api/jobs/restore"]) {
        const response = await app.inject({ method: "POST", url, payload });
        expect(response.statusCode, `${url} ${JSON.stringify(payload).slice(0, 40)}`).toBe(400);
      }
    }
    expect(jobService.deleteJobs).not.toHaveBeenCalled();
    expect(jobService.restoreJobs).not.toHaveBeenCalled();
  });
});

describe("job responses", () => {
  it("cut inline reference images to their header; URLs pass through", async () => {
    const { app, jobService } = await route();
    const url =
      "https://site.example.test/supabase/storage/v1/object/public/project-assets/u/a.png";
    const inline = `data:image/jpeg;base64,${"A".repeat(400_000)}`;
    // An agent job from before the fix kept its reference inline.
    const stored = job(1, { prompt: "夜景海报", input_images: [inline, url] });
    jobService.listJobs.mockResolvedValue([stored]);
    jobService.getJob.mockResolvedValue(stored);
    for (const path of ["/api/jobs", `/api/jobs/${stored.id}`]) {
      const response = await app.inject({ method: "GET", url: path });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      const sent = body.jobs?.[0] ?? body.job;
      // The studio shows the count (查看大图: 参考图 2 张); the bytes stay home.
      expect(sent.payload.input_images).toEqual([
        "data:image/jpeg;base64,",
        url,
      ]);
      expect(sent.payload.prompt).toBe("夜景海报");
      expect(response.body.length).toBeLessThan(4000);
    }
    expect(stored.payload).toEqual({
      prompt: "夜景海报",
      input_images: [inline, url],
    });
  });
});
