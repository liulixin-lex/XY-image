import { randomBytes } from "node:crypto";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadServerEnv } from "../config/env.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import type { JobService } from "../features/jobs/job-service.js";
import { DeliveryPendingError } from "../features/xy2api/errors.js";
import { executeImageJob } from "../features/xy2api/image-runner.js";
import type { Xy2apiServices } from "../features/xy2api/services.js";
import type { AdminSupabaseClient } from "../supabase/admin.js";
import { registerGenerateRoutes } from "./generate.js";

vi.mock("../features/xy2api/image-runner.js", () => ({
  executeImageJob: vi.fn(),
}));

afterEach(() => vi.restoreAllMocks());
async function route() {
  const app = Fastify();
  const jobService = {
    createJob: vi.fn(async () => ({ id: "job-1" })),
    markRunning: vi.fn(async () => {}),
    markSucceeded: vi.fn(async () => {}),
    markDeadLetter: vi.fn(async () => {}),
    markRetrying: vi.fn(async () => {}),
    scheduleRedelivery: vi.fn(async () => {}),
  };
  registerGenerateRoutes(app, {
    auth: {
      authenticate: async () => ({
        id: "user-1",
        accessToken: "token",
        email: "",
        userMetadata: {},
      }),
    },
    viewerService: {
      ensureViewer: async () => ({ workspace: { id: "workspace-1" } }),
    } as unknown as ViewerService,
    jobService: jobService as unknown as JobService,
    xy2api: {
      billing: {
        withUserLock: (_id: string, fn: () => Promise<unknown>) => fn(),
        prepareImageJob: async () => ({
          keyId: 7,
          model: "gpt-image-2",
          resolution: "1K",
          quality: "auto",
          aspect_ratio: "1:1",
        }),
      },
    } as unknown as Xy2apiServices,
    env: loadServerEnv(
      {},
      {
        XY2API_BASE_URL: "https://gateway.example.com",
        LOOMIC_SECRET_KEY: randomBytes(32).toString("base64"),
        SSO_EMAIL_DOMAIN: "sso.example.com",
      },
    ),
    getAdminClient: () => ({}) as AdminSupabaseClient,
  });
  await app.ready();
  const generate = () =>
    app.inject({
      method: "POST",
      url: "/api/agent/generate-image",
      payload: { prompt: "test image" },
    });
  return { app, jobService, generate };
}

describe("sync image generation storage retry", () => {
  it("hands a held image to the worker instead of failing the job", async () => {
    vi.mocked(executeImageJob).mockRejectedValue(new DeliveryPendingError(30));
    const { app, jobService, generate } = await route();
    const response = await generate();
    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe("storage_retrying");
    expect(jobService.markRetrying).toHaveBeenCalledWith(
      "job-1",
      "storage_retrying",
      expect.any(String),
    );
    expect(jobService.scheduleRedelivery).toHaveBeenCalledWith("job-1", 30);
    expect(jobService.markDeadLetter).not.toHaveBeenCalled();
    await app.close();
  });
  it("fails as storage_failed when the retry cannot be queued", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(executeImageJob).mockRejectedValue(new DeliveryPendingError(30));
    const { app, jobService, generate } = await route();
    jobService.scheduleRedelivery.mockRejectedValue(new Error("queue down"));
    const response = await generate();
    expect(response.json().error.code).toBe("storage_failed");
    expect(jobService.markDeadLetter).toHaveBeenCalledWith(
      "job-1",
      "storage_failed",
      expect.any(String),
    );
    await app.close();
  });
});
