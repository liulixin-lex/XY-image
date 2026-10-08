import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { loadServerEnv } from "../config/env.js";
import { ChatProviderError } from "../features/chat-providers/errors.js";
import type { JobService } from "../features/jobs/job-service.js";
import { BillingGuardError } from "../features/xy2api/errors.js";
import { createXy2apiServices } from "../features/xy2api/services.js";
import { memoryDatabase } from "../features/xy2api/test-support.js";
import type { UserSupabaseClient } from "../supabase/user.js";
import type { LoomicAgentFactory } from "./deep-agent.js";
import { createAgentRunService } from "./runtime.js";

vi.mock("./backends/index.js", () => ({
  createAgentBackend: () => ({ factory: () => ({}) }),
}));

describe("custom chat run wiring", () => {
  it("runs without a main chat key, keeps image jobs on the main billing guard, and emits safe provider failures", async () => {
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
      workspaces: [{ id: "workspace-1", type: "personal" }],
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
    const mainChat = vi.spyOn(services.keys, "resolveChatCredential");
    vi.spyOn(services.keys, "resolveImageCredential").mockRejectedValue(
      new BillingGuardError("key_unavailable", 403),
    );
    const billing = vi
      .spyOn(services.billing, "prepareImageJob")
      .mockRejectedValue(new BillingGuardError("key_unavailable", 403));
    const factory = vi.fn<LoomicAgentFactory>(() => ({
      stream: vi.fn(),
      streamEvents: async function* () {
        yield { event: "on_chat_model_start", name: "custom", data: {} };
        throw new ChatProviderError("provider_auth_failed");
      } as never,
    }));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const runtime = createAgentRunService({
      env,
      xy2api: services,
      agentFactory: factory,
      createUserClient: () => db.admin as unknown as UserSupabaseClient,
      jobService: {} as JobService,
    });
    try {
      const run = runtime.createRun(
        {
          conversationId: "canvas-1",
          canvasId: "canvas-1",
          sessionId: "session-1",
          prompt: "hello",
        },
        { userId, accessToken: "synthetic-user-session" },
      );
      const events = [];
      for await (const event of runtime.streamRun(run.runId))
        events.push(event);
      expect(events.at(-1)).toMatchObject({
        type: "run.failed",
        error: { code: "provider_auth_failed" },
      });
      expect(mainChat).not.toHaveBeenCalled();
      const options = factory.mock.calls[0]?.[0];
      expect(options?.customChat).toMatchObject({
        model: "chat-model",
        baseUrl: "https://api.example.com/v1",
      });
      expect(options?.credentials).toBeUndefined();
      expect(options?.imageModels).toEqual([]);
      expect(options?.submitImageJob).toBeDefined();
      if (options?.submitImageJob)
        await expect(
          options.submitImageJob({
            prompt: "test",
            model: "gpt-image-2",
            quality: "standard",
            aspectRatio: "1:1",
            title: "test",
          }),
        ).rejects.toMatchObject({ code: "key_unavailable" });
      expect(billing).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(events)).not.toContain("synthetic-private-key");
      expect(JSON.stringify(errors.mock.calls)).not.toContain(
        "synthetic-private-key",
      );
    } finally {
      errors.mockRestore();
      await services.providers.network.close();
    }
  });
});
