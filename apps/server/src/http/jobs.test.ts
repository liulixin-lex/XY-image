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
    id: `00000000-0000-4000-8000-00000000000${index}`,
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
  };
  const billing = {
    withUserLock: (_id: string, fn: () => Promise<unknown>) => fn(),
    prepareImageJob: vi.fn(async () => ({
      keyId: 7,
      model: "gpt-image-2",
      resolution: "2K" as const,
      quality: "high" as const,
      aspect_ratio: "3:4",
    })),
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
    expect(billing.prepareImageJob).toHaveBeenCalledOnce();
    expect(billing.prepareImageJob).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-1" }),
      expect.objectContaining({ prompt: "雨夜霓虹街口" }),
      { count: 3 },
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

  it("returns the pictures that were queued when a later one fails", async () => {
    const { app, jobService } = await route();
    jobService.createJob
      .mockImplementationOnce(async (_user, input) => job(0, input.payload))
      .mockRejectedValueOnce(
        new JobServiceError("job_create_failed", "queue down", 500),
      );
    const response = await app.inject({
      method: "POST",
      url: "/api/jobs/image-generation/batch",
      payload: { prompt: "海边日落", count: 4 },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ requested: 4 });
    expect(response.json().jobs).toHaveLength(1);
    expect(jobService.createJob).toHaveBeenCalledTimes(2);
  });

  it("refuses a batch over the limit or past the pending cap", async () => {
    const { app, billing } = await route();
    const tooMany = await app.inject({
      method: "POST",
      url: "/api/jobs/image-generation/batch",
      payload: { prompt: "海边日落", count: 5 },
    });
    expect(tooMany.statusCode).toBe(400);
    billing.prepareImageJob.mockRejectedValueOnce(
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
