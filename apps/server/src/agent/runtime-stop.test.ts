import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { loadServerEnv } from "../config/env.js";
import type { JobService } from "../features/jobs/job-service.js";
import { createXy2apiServices } from "../features/xy2api/services.js";
import { memoryDatabase } from "../features/xy2api/test-support.js";
import type { UserSupabaseClient } from "../supabase/user.js";
import type { LoomicAgentFactory } from "./deep-agent.js";
import { createAgentRunService } from "./runtime.js";

vi.mock("./backends/index.js", () => ({
  createAgentBackend: () => ({ factory: () => ({}) }),
}));

// Stopping a run while the agent waits for its image: a job the worker has
// not picked up is canceled (nothing sent, nothing charged); one already
// running is left to finish (the worker puts it on the canvas).
async function stopDuringImageWait(unsent: boolean) {
  const env = loadServerEnv(
    {},
    {
      XY2API_BASE_URL: "https://main.example.com",
      LOOMIC_SECRET_KEY: randomBytes(32).toString("base64"),
      SSO_EMAIL_DOMAIN: "sso.example.com",
    },
  );
  const userId = "11111111-1111-4111-8111-111111111111";
  const db = memoryDatabase({
    canvases: [{ id: "canvas-1", content: { elements: [] } }],
    workspaces: [
      { id: "workspace-1", type: "personal", owner_user_id: userId },
    ],
  });
  const services = createXy2apiServices(env, () => db.admin);
  vi.spyOn(services.providers.network, "listModels").mockResolvedValue([
    "chat-model",
  ]);
  const provider = await services.providers.create(userId, {
    name: "Mine",
    protocol: "openai_compatible",
    baseUrl: "https://api.example.com/v1",
    apiKey: "synthetic-private-key",
  });
  await services.keys.updatePreferences(userId, {
    defaultChatProviderId: provider.id,
    defaultChatModel: "chat-model",
  });
  vi.spyOn(services.billing, "prepareImageJob").mockResolvedValue({
    keyId: 7,
    model: "gpt-image-2",
    resolution: "2K",
    quality: "auto",
    aspect_ratio: "1:1",
  } as never);
  const jobService = {
    createJob: vi.fn(async () => ({ id: "job-1" })),
    getJobAdmin: vi.fn(async () => ({
      id: "job-1",
      status: unsent ? "queued" : "running",
      billing_status: unsent ? "none" : "pending",
    })),
    cancelUnsentJobAdmin: vi.fn(async () => unsent),
  };
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const factory = vi.fn<LoomicAgentFactory>(() => ({
    stream: vi.fn(),
    // Like LangGraph: once the run's signal fires, the stream throws.
    streamEvents: async function* (
      _input: unknown,
      config?: { signal?: AbortSignal },
    ) {
      yield { event: "on_chat_model_start", name: "custom", data: {} };
      await held;
      if (config?.signal?.aborted)
        throw Object.assign(new Error("This operation was aborted"), {
          name: "AbortError",
        });
    } as never,
  }));
  const logs = vi.spyOn(console, "log").mockImplementation(() => {});
  const runtime = createAgentRunService({
    env,
    xy2api: services,
    agentFactory: factory,
    createUserClient: () => db.admin as unknown as UserSupabaseClient,
    jobService: jobService as unknown as JobService,
  });
  try {
    const run = runtime.createRun(
      {
        conversationId: "canvas-1",
        canvasId: "canvas-1",
        sessionId: "session-1",
        prompt: "画一座灯塔",
      },
      { userId, accessToken: "synthetic-user-session" },
    );
    const stream = runtime.streamRun(run.runId);
    const events: unknown[] = [];
    const drained = (async () => {
      for await (const event of stream) events.push(event);
    })();
    await vi.waitFor(() => expect(factory).toHaveBeenCalled());
    const submit = factory.mock.calls[0]?.[0].submitImageJob;
    if (!submit) throw new Error("no submitImageJob");
    const waiting = submit({
      prompt: "灯塔",
      model: "gpt-image-2",
      resolution: "2K",
      quality: "auto",
      aspectRatio: "1:1",
      title: "灯塔",
    });
    await vi.waitFor(() => expect(jobService.createJob).toHaveBeenCalled());
    runtime.cancelRun(run.runId, userId);
    await expect(waiting).rejects.toThrow("Run was canceled");
    release();
    await drained;
    return { jobService, events, logs: JSON.stringify(logs.mock.calls) };
  } finally {
    logs.mockRestore();
    await services.providers.network.close();
  }
}

describe("stopping a run during an image wait", () => {
  it("cancels a job the worker has not picked up", async () => {
    const { jobService, events, logs } = await stopDuringImageWait(true);
    expect(jobService.cancelUnsentJobAdmin).toHaveBeenCalledWith("job-1");
    expect(logs).toContain("canceled_unsent");
    expect(events.at(-1)).toMatchObject({ type: "run.canceled" });
  }, 15_000);

  it("leaves a job that is already running to finish", async () => {
    const { jobService, logs } = await stopDuringImageWait(false);
    expect(jobService.cancelUnsentJobAdmin).toHaveBeenCalledWith("job-1");
    expect(logs).toContain("stopped_running");
  }, 15_000);
});
