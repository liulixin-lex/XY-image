import { afterEach, describe, expect, it, vi } from "vitest";

import type { ResolvedChat } from "../features/chat-providers/model-resolver.js";
import { BillingGuardError } from "../features/xy2api/errors.js";
import { resolveExecution, searchFallbackFor } from "./execution-model.js";
import { buildUserMessage, pickedTool } from "./runtime.js";

afterEach(() => vi.restoreAllMocks());

const chat: ResolvedChat = {
  source: "xy2api",
  ref: "openai:gpt-6-sol",
  credentials: { apiKey: "sk-chat", baseUrl: "https://main.example" },
};
const env = {
  xy2apiBaseUrl: "https://main.example",
  agentModel: "gpt-5.4",
  webSearchGeminiFallback: "on" as const,
};
const keys = (chatModels: string[]) =>
  ({
    resolveChatCredential: vi.fn(async () => ({
      keyId: 1,
      apiKey: "sk-chat",
      platform: "",
      chatModels,
    })),
    preferences: vi.fn(),
  }) as never;

describe("执行步骤模型 (第 70 条)", () => {
  it("uses the chat model at the saved level when no other model is set", async () => {
    expect(
      await resolveExecution({
        userId: "u",
        chat,
        prefs: { agent_exec_model: null, agent_exec_effort: "medium" },
        keys: keys(["gpt-6-sol"]),
        providers: {} as never,
        env,
      }),
    ).toEqual({ effort: "medium" });
    // The chat model picked as the execution model is the same thing.
    expect(
      await resolveExecution({
        userId: "u",
        chat,
        prefs: {
          agent_exec_model: "openai:gpt-6-sol",
          agent_exec_effort: null,
        },
        keys: keys(["gpt-6-sol"]),
        providers: {} as never,
        env,
      }),
    ).toEqual({});
  });

  it("resolves another main-site model with the chat key", async () => {
    const out = await resolveExecution({
      userId: "u",
      chat,
      prefs: {
        agent_exec_model: "openai:gpt-5.4-mini",
        agent_exec_effort: "low",
      },
      keys: keys(["gpt-6-sol", "gpt-5.4-mini"]),
      providers: {} as never,
      env,
    });
    expect(out).toEqual({
      model: {
        source: "xy2api",
        ref: "openai:gpt-5.4-mini",
        credentials: { apiKey: "sk-chat", baseUrl: "https://main.example" },
      },
      effort: "low",
    });
  });

  it("falls back to the chat model when the execution model is gone", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await resolveExecution({
      userId: "u",
      chat,
      prefs: {
        agent_exec_model: "openai:gpt-retired",
        agent_exec_effort: null,
      },
      keys: keys(["gpt-6-sol"]),
      providers: {} as never,
      env,
    });
    expect(out).toEqual({});
    expect(String(warn.mock.calls[0]?.[0])).toContain("not usable");
  });
});

describe("search_web's last resort (第 70 条)", () => {
  it("picks a Gemini Flash model on the chat key", async () => {
    expect(
      await searchFallbackFor({
        userId: "u",
        keys: keys([
          "gpt-6-sol",
          "gemini-3.8-pro",
          "gemini-3.8-flash",
          "gemini-3.1-flash-image",
        ]),
        env,
      }),
    ).toEqual({
      baseUrl: "https://main.example",
      apiKey: "sk-chat",
      model: "gemini-3.8-flash",
    });
    expect(
      await searchFallbackFor({ userId: "u", keys: keys(["gpt-6-sol"]), env }),
    ).toBeUndefined();
    expect(
      await searchFallbackFor({
        userId: "u",
        keys: keys(["gemini-3.8-flash"]),
        env: { ...env, webSearchGeminiFallback: "off" },
      }),
    ).toBeUndefined();
    const broken = {
      resolveChatCredential: vi.fn(async () => {
        throw new BillingGuardError("key_unavailable", 403);
      }),
    } as never;
    expect(
      await searchFallbackFor({ userId: "u", keys: broken, env }),
    ).toBeUndefined();
  });
});

describe("指定 from the chat panel (第 70 条)", () => {
  it("turns picked targets, a brand kit, tools and skills into explicit instructions", () => {
    const { text } = buildUserMessage("把背景换成蓝色", [], undefined, [
      {
        mentionType: "canvas-node",
        id: "g1",
        label: "主视觉生成",
        nodeType: "generator",
      },
      { mentionType: "brand-kit", id: "kit-2", label: "秋季活动" },
      { mentionType: "tool", id: "run_workflow", label: "运行工作流" },
      {
        mentionType: "skill",
        id: "s1",
        label: "生图提示词规范",
        slug: "prompt-guide",
      },
    ]);
    expect(text).toContain('<human_targets count="1">');
    expect(text).toContain('element_id="g1"');
    expect(text).toContain("别的元素不动");
    expect(text).toContain(
      '<human_brand_kit_choice id="kit-2" name="秋季活动">',
    );
    expect(text).toContain("<human_tool_choice");
    expect(text).toContain("run_workflow");
    expect(text).toContain("技能内容在系统提示词的「技能」部分");
    // Names are escaped like any other attribute.
    const { text: risky } = buildUserMessage("x", [], undefined, [
      { mentionType: "brand-kit", id: "k", label: '品牌"<x>' },
    ]);
    expect(risky).toContain("品牌&quot;&lt;x&gt;");
  });

  it("knows when 联网搜索 was picked", () => {
    expect(
      pickedTool(
        [{ mentionType: "tool", id: "web_search", label: "联网搜索" }],
        "web_search",
      ),
    ).toBe(true);
    expect(pickedTool([], "web_search")).toBe(false);
    expect(pickedTool(undefined, "web_search")).toBe(false);
  });
});
