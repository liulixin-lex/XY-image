import { describe, expect, it } from "vitest";

import {
  chatEffortsFor,
  chatModelFamily,
  chatOptionsForModelId,
  chatWebSearchMode,
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

describe("chat options (第 67 / 68 条)", () => {
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
    // The main site drops Gemini's level on Chat Completions (第 68 条).
    expect(chatEffortsFor(main("gemini-3.8-flash"))).toEqual(["auto"]);
    expect(chatEffortsFor(custom("gemini-3.8-flash"))).toEqual([
      "auto",
      "low",
      "medium",
      "high",
    ]);
    expect(chatEffortsFor(main("grok-4.7"))).toContain("xhigh");
    expect(chatEffortsFor(main("grok-4.6-latest"))).toContain("xhigh");
    expect(chatEffortsFor(main("grok-4.5"))).toEqual([
      "auto",
      "low",
      "medium",
      "high",
    ]);
    expect(chatEffortsFor(main("grok-4.20-0309-reasoning"))).toContain("high");
    // Levels the main site removes for these Grok models.
    expect(chatEffortsFor(main("grok-composer-2.5-fast"))).toEqual(["auto"]);
    expect(chatEffortsFor(main("grok-4.20-0309-non-reasoning"))).toEqual([
      "auto",
    ]);
    expect(chatEffortsFor(main("grok-build-0.1"))).toEqual(["auto"]);
    expect(chatEffortsFor(custom("gpt-6.1-sol"))).toEqual([
      "auto",
      "low",
      "medium",
      "high",
    ]);
    expect(chatEffortsFor(null)).toEqual(["auto"]);
  });

  it("runs a level the model lacks at the nearest one below", () => {
    expect(resolveChatEffort(main("gemini-3.8-flash"), "max")).toBe("auto");
    expect(resolveChatEffort(custom("gemini-3.8-flash"), "max")).toBe("high");
    expect(resolveChatEffort(main("grok-4.7"), "max")).toBe("xhigh");
    expect(resolveChatEffort(main("gpt-6.1-sol"), "xhigh")).toBe("xhigh");
    expect(resolveChatEffort(main("gpt-6.1-sol"), "auto")).toBe("auto");
    expect(resolveChatEffort(main("gpt-6.1-sol"), undefined)).toBe("auto");
    expect(resolveChatEffort(null, "high")).toBe("auto");
  });

  it("gives every chat model a way to search the web", () => {
    expect(chatWebSearchMode(main("gpt-6.1-sol"))).toBe("hosted");
    expect(chatWebSearchMode(main("gpt-5.6-sol"))).toBe("hosted");
    expect(chatWebSearchMode(main("grok-4.7"))).toBe("hosted");
    expect(chatWebSearchMode(main("gemini-3.8-flash"))).toBe("gemini");
    expect(chatWebSearchMode(main("claude-opus-4-7"))).toBe("free");
    expect(chatWebSearchMode(main("deepseek-v4"))).toBe("free");
    expect(chatWebSearchMode(custom("gpt-6.1-sol"))).toBe("free");
    expect(chatWebSearchMode(custom("qwen3-max"))).toBe("free");
    expect(chatWebSearchMode(null)).toBeNull();
    expect(chatWebSearchSupported(custom("glm-5"))).toBe(true);
    expect(chatOptionsForModelId("openai:gpt-6-sol")).toMatchObject({
      webSearch: true,
      webSearchMode: "hosted",
    });
    expect(chatOptionsForModelId(null)).toEqual({
      efforts: ["auto"],
      webSearch: false,
      webSearchMode: null,
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
