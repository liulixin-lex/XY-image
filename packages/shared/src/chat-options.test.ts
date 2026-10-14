import { describe, expect, it } from "vitest";

import {
  chatEffortsFor,
  chatModelFamily,
  chatOptionsForModelId,
  chatWebSearchSupported,
  resolveChatEffort,
} from "./chat-options.js";
import { runCreateRequestSchema } from "./contracts.js";

const main = (model: string) => ({ source: "xy2api" as const, model });
const custom = (model: string) => ({
  source: "custom" as const,
  providerId: "p1",
  model,
});

describe("chat options (第 67 条)", () => {
  it("knows the vendor of the main site's chat models", () => {
    expect(chatModelFamily("gpt-6.1-sol")).toBe("openai");
    expect(chatModelFamily("gpt-5.6-terra")).toBe("openai");
    expect(chatModelFamily("codex-auto-review")).toBe("openai");
    expect(chatModelFamily("o4-mini")).toBe("openai");
    expect(chatModelFamily("claude-opus-4-7")).toBe("claude");
    expect(chatModelFamily("gemini-3.8-flash")).toBe("gemini");
    expect(chatModelFamily("grok-4.7")).toBe("grok");
    expect(chatModelFamily("deepseek-v4")).toBe("other");
  });

  it("offers each vendor's levels", () => {
    expect(chatEffortsFor(main("gpt-6.1-sol"))).toEqual([
      "auto",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(chatEffortsFor(main("claude-sonnet-5-5"))).toContain("max");
    expect(chatEffortsFor(main("gemini-3.8-flash"))).toEqual([
      "auto",
      "low",
      "medium",
      "high",
    ]);
    expect(chatEffortsFor(main("grok-4.7"))).toContain("xhigh");
    expect(chatEffortsFor(main("grok-4.5"))).not.toContain("xhigh");
    expect(chatEffortsFor(custom("gpt-6.1-sol"))).toEqual([
      "auto",
      "low",
      "medium",
      "high",
    ]);
    expect(chatEffortsFor(null)).toEqual(["auto"]);
  });

  it("runs a level the model lacks at the nearest one below", () => {
    expect(resolveChatEffort(main("gemini-3.8-flash"), "max")).toBe("high");
    expect(resolveChatEffort(main("grok-4.7"), "max")).toBe("xhigh");
    expect(resolveChatEffort(main("gpt-6.1-sol"), "xhigh")).toBe("xhigh");
    expect(resolveChatEffort(main("gpt-6.1-sol"), "auto")).toBe("auto");
    expect(resolveChatEffort(main("gpt-6.1-sol"), undefined)).toBe("auto");
    expect(resolveChatEffort(null, "high")).toBe("auto");
  });

  it("gives built-in web search to OpenAI and Grok models on the main site only", () => {
    expect(chatWebSearchSupported(main("gpt-6.1-sol"))).toBe(true);
    expect(chatWebSearchSupported(main("grok-4.7"))).toBe(true);
    expect(chatWebSearchSupported(main("gemini-3.8-flash"))).toBe(false);
    expect(chatWebSearchSupported(main("claude-opus-4-7"))).toBe(false);
    expect(chatWebSearchSupported(custom("gpt-6.1-sol"))).toBe(false);
    expect(chatOptionsForModelId("openai:gpt-6-sol")).toMatchObject({
      webSearch: true,
    });
    expect(chatOptionsForModelId(null)).toEqual({
      efforts: ["auto"],
      webSearch: false,
    });
  });

  it("accepts effort and web search on a run request", () => {
    const parsed = runCreateRequestSchema.parse({
      sessionId: "11111111-1111-4111-8111-111111111111",
      conversationId: "c1",
      prompt: "hi",
      effort: "xhigh",
      webSearch: true,
    });
    expect(parsed).toMatchObject({ effort: "xhigh", webSearch: true });
    expect(() =>
      runCreateRequestSchema.parse({
        sessionId: "11111111-1111-4111-8111-111111111111",
        conversationId: "c1",
        prompt: "hi",
        effort: "ultra",
      }),
    ).toThrow();
  });
});
