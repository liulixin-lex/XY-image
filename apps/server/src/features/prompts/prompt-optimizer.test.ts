import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import type { BaseMessage } from "@langchain/core/messages";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerPromptRoutes } from "../../http/prompts.js";
import { ChatProviderError } from "../chat-providers/errors.js";
import type { ChatProviderService } from "../chat-providers/service.js";
import { BillingGuardError, GatewayError } from "../xy2api/errors.js";
import type { KeyService } from "../xy2api/key-service.js";
import {
  PROMPT_OPTIMIZER_SYSTEM,
  cleanPrompt,
  createPromptOptimizer,
  textOf,
} from "./prompt-optimizer.js";

afterEach(() => vi.restoreAllMocks());

function setup(answer: () => Promise<unknown>) {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const invoke = vi.fn(async (_messages: BaseMessage[]) => answer());
  const keys = {
    preferences: vi.fn(async () => ({
      default_chat_provider_id: null,
      default_chat_model: "gpt-4.1",
    })),
    resolveChatCredential: vi.fn(async () => ({
      apiKey: "synthetic-chat-credential",
      chatModels: ["gpt-4.1"],
    })),
  };
  const createModel = vi.fn(() => ({ invoke }) as unknown as BaseLanguageModel);
  const optimizer = createPromptOptimizer({
    keys: keys as unknown as KeyService,
    providers: {} as ChatProviderService,
    env: { xy2apiBaseUrl: "https://example.com", agentModel: "gpt-4.1" },
    createModel,
  });
  return { optimizer, invoke, createModel };
}

describe("prompt optimizer", () => {
  it("sends the description once with the editing rules and returns the cleaned prompt", async () => {
    const { optimizer, invoke, createModel } = setup(async () => ({
      content:
        "提示词：“雨夜的霓虹街口，湿润路面倒映粉蓝灯牌，低机位广角，电影感”",
    }));
    const result = await optimizer.optimize("user-1", {
      prompt: "雨夜霓虹街口",
      aspect_ratio: "3:4",
    });
    expect(result).toEqual({
      prompt: "雨夜的霓虹街口，湿润路面倒映粉蓝灯牌，低机位广角，电影感",
      model: "gpt-4.1",
    });
    expect(invoke).toHaveBeenCalledOnce();
    const [system, human] = invoke.mock.calls[0]?.[0] ?? [];
    expect(system?.content).toBe(PROMPT_OPTIMIZER_SYSTEM);
    expect(String(human?.content)).toContain("雨夜霓虹街口");
    expect(String(human?.content)).toContain("3:4");
    expect(createModel).toHaveBeenCalledWith(
      expect.objectContaining({ source: "xy2api", ref: "openai:gpt-4.1" }),
    );
  });

  it("refuses an empty answer instead of clearing the user's text", async () => {
    const { optimizer } = setup(async () => ({ content: "  ```\n```  " }));
    await expect(
      optimizer.optimize("user-1", { prompt: "猫" }),
    ).rejects.toMatchObject({ code: "upstream_busy", statusCode: 502 });
  });

  it("keeps a known refusal and hides the image wording of an unknown one", async () => {
    const refused = setup(async () => {
      throw new Error("connection error", {
        cause: new GatewayError({
          code: "insufficient_balance",
          retryable: false,
          billing: "not_charged",
          userMessage: "主站余额不足，请充值后重试",
        }),
      });
    });
    await expect(
      refused.optimizer.optimize("user-1", { prompt: "猫" }),
    ).rejects.toMatchObject({ code: "insufficient_balance", statusCode: 402 });
    const unknown = setup(async () => {
      throw new Error("socket hang up");
    });
    const error = await unknown.optimizer
      .optimize("user-1", { prompt: "猫" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BillingGuardError);
    expect((error as BillingGuardError).message).not.toContain("扣费");
  });
});

describe("prompt cleanup", () => {
  it.each([
    ["```text\n夕阳下的灯塔\n```", "夕阳下的灯塔"],
    ["Prompt: a lighthouse at dusk", "a lighthouse at dusk"],
    ["「夕阳下的灯塔」", "夕阳下的灯塔"],
    ["招牌写着“开业”，暖光", "招牌写着“开业”，暖光"],
  ])("cleans %j", (raw, expected) => {
    expect(cleanPrompt(raw)).toBe(expected);
  });
  it("reads text from content parts", () => {
    expect(
      textOf({
        content: [
          { type: "text", text: "灯塔" },
          { type: "text", text: "，暖光" },
        ],
      }),
    ).toBe("灯塔，暖光");
  });
});

describe("POST /api/prompts/optimize", () => {
  async function route(
    optimize = vi.fn(async () => ({
      prompt: "更具体的描述",
      model: "gpt-4.1",
    })),
  ) {
    const app = Fastify();
    registerPromptRoutes(app, {
      auth: {
        authenticate: async () => ({
          id: "user-1",
          accessToken: "token",
          email: "",
          userMetadata: {},
        }),
      },
      optimizer: { optimize },
    });
    return { app, optimize };
  }
  it("rewrites, validates input, and limits a user to 12 a minute", async () => {
    const { app, optimize } = await route();
    const ok = await app.inject({
      method: "POST",
      url: "/api/prompts/optimize",
      payload: { prompt: "海边日落" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ prompt: "更具体的描述", model: "gpt-4.1" });
    const empty = await app.inject({
      method: "POST",
      url: "/api/prompts/optimize",
      payload: { prompt: "   " },
    });
    expect(empty.statusCode).toBe(400);
    for (let i = 0; i < 11; i++)
      await app.inject({
        method: "POST",
        url: "/api/prompts/optimize",
        payload: { prompt: "海边日落" },
      });
    const limited = await app.inject({
      method: "POST",
      url: "/api/prompts/optimize",
      payload: { prompt: "海边日落" },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBeDefined();
    expect(optimize).toHaveBeenCalledTimes(12);
  });
  it("passes a provider refusal through", async () => {
    const { app } = await route(
      vi.fn(async () => {
        throw new ChatProviderError("provider_unavailable", 502);
      }),
    );
    const response = await app.inject({
      method: "POST",
      url: "/api/prompts/optimize",
      payload: { prompt: "海边日落" },
    });
    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe("provider_unavailable");
  });
});
