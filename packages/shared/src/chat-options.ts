import { z } from "zod";

import { type ChatModelRef, parseChatModelRef } from "./chat-models.js";

// 第 67 / 68 条: the design assistant's 思考强度 (reasoning effort) and 联网搜索
// (web search), per chat model. The chat panel shows only what this file
// says a model takes, and the server sends exactly what resolveChatEffort
// and chatWebSearchMode return, so the two never disagree.
//
// 思考强度 through the main site (xy2api 0.3.0 source, checked 2026-10-14):
// - OpenAI / Codex (gpt-*, o*, codex*): reasoning.effort low / medium /
//   high / xhigh / max (openai_reasoning_effort_policy.go; a group ceiling
//   may lower it, "downgrade" by default). Measured: reasoning tokens grow
//   with the level (gpt-6-sol 12 → 24, gpt-5.6-sol 10 → 19).
// - Claude: low … max → output_config.effort (xhigh becomes max on most).
// - Grok: openai_gateway_grok.go keeps the level only for grok-4.3 / 4.5 /
//   4.6 / 4.7, grok-3-mini and the grok-4.20 reasoning models (xhigh only on
//   4.6 / 4.7, max becomes high) and drops it for the rest (composer, build,
//   non-reasoning), which therefore offer 自动 only.
// - Gemini: 自动 only. Chat Completions to a Gemini group go through the
//   Claude-messages converter, whose convertClaudeGenerationConfig keeps
//   max tokens, temperature, top_p and stop and nothing else, so any level
//   is dropped (measured: same output either way). Only the native
//   generateContent API takes thinkingLevel (measured: 109 thought tokens at
//   low, 375 at high). TODO(第 68 条): offer low/medium/high once the main
//   site maps reasoning_effort to thinkingConfig on that path.
// - A personal provider: low / medium / high, the OpenAI-compatible values
//   most of them accept.
// The server steps down once if a model still refuses the level
// (agent/model-options.ts).
//
// 联网搜索 (chatWebSearchMode), every chat model has one:
// - "hosted": the model's own search inside the answer, the Responses API
//   web_search tool, run by the main site: OpenAI models (Codex accounts)
//   and Grok (xAI's native search). Measured: searches, cites, current.
// - "gemini": Gemini's own Google Search, called as a tool. Next to function
//   tools Gemini does not ground, alone it does (features/web-search/
//   gemini-grounded.ts on the server).
// - "free": a search_web / read_webpage tool backed by free sources (and an
//   operator's search API key when set) for every other model: personal
//   providers, Claude, DeepSeek, Qwen, GLM, Kimi, …
// A model that refuses its built-in search at run time switches to "free".

export const CHAT_EFFORTS = [
  "auto",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type ChatEffort = (typeof CHAT_EFFORTS)[number];
export const chatEffortSchema = z.enum(CHAT_EFFORTS);

export const CHAT_EFFORT_LABEL: Record<ChatEffort, string> = {
  auto: "自动",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "最高",
};

export const CHAT_EFFORT_HINT: Record<ChatEffort, string> = {
  auto: "理解需求时多想一点，执行步骤时回得快",
  low: "回得快，适合简单改动",
  medium: "速度和思考兼顾",
  high: "多想一会儿，适合复杂需求",
  xhigh: "想得更久，适合多步策划",
  max: "想得最久，最慢",
};

export type ChatModelFamily = "openai" | "claude" | "gemini" | "grok" | "other";

/** Vendor family of a chat model id as the main site lists it. */
export function chatModelFamily(model: string): ChatModelFamily {
  const id = model.trim().toLowerCase();
  if (/(^|\/)claude/.test(id)) return "claude";
  if (/(^|\/)gemini/.test(id)) return "gemini";
  if (/(^|\/)grok/.test(id)) return "grok";
  if (/(^|\/)(gpt-|o\d|codex|chatgpt)/.test(id)) return "openai";
  return "other";
}

/** Whether this model is called through the Responses API (deep-agent.ts). */
export function usesResponsesApi(model: string): boolean {
  return /^gpt-6[.-]/.test(model.trim().toLowerCase());
}

function bareModelId(model: string) {
  return model.trim().toLowerCase().replace(/^.*\//, "");
}

/** Grok levels as the main site forwards them (openai_gateway_grok.go). */
function grokEfforts(model: string): ChatEffort[] {
  const id = bareModelId(model);
  if (/^grok-4\.[67](-latest)?$/.test(id))
    return ["auto", "low", "medium", "high", "xhigh"];
  if (
    /^grok-(4\.[35](-latest)?|3-mini(-fast)?|4\.20(-0309)?-reasoning|4\.20-multi-agent(-0309)?)$/.test(
      id,
    )
  )
    return ["auto", "low", "medium", "high"];
  return ["auto"];
}

/** Levels the model takes, 自动 first. */
export function chatEffortsFor(ref: ChatModelRef | null): ChatEffort[] {
  if (!ref) return ["auto"];
  if (ref.source === "custom") return ["auto", "low", "medium", "high"];
  switch (chatModelFamily(ref.model)) {
    case "openai":
    case "claude":
      return [...CHAT_EFFORTS];
    case "gemini":
      // The main site drops it on the Chat Completions path (see above).
      return ["auto"];
    case "grok":
      return grokEfforts(ref.model);
    default:
      // Unknown vendors on the main site: the common three.
      return ["auto", "low", "medium", "high"];
  }
}

/**
 * The level sent for a request: the one asked for when the model takes it,
 * else the highest it takes below that, else the lowest above, else 自动.
 */
export function resolveChatEffort(
  ref: ChatModelRef | null,
  wanted: ChatEffort | undefined,
): ChatEffort {
  if (!wanted || wanted === "auto") return "auto";
  const offered = chatEffortsFor(ref).filter((e) => e !== "auto");
  if (offered.includes(wanted)) return wanted;
  const rank = CHAT_EFFORTS.indexOf(wanted);
  return (
    [...offered].reverse().find((e) => CHAT_EFFORTS.indexOf(e) < rank) ??
    offered.find((e) => CHAT_EFFORTS.indexOf(e) > rank) ??
    "auto"
  );
}

export type ChatWebSearchMode = "hosted" | "gemini" | "free";

/** How 联网搜索 works for this model (see the top of this file). */
export function chatWebSearchMode(
  ref: ChatModelRef | null,
): ChatWebSearchMode | null {
  if (!ref) return null;
  if (ref.source !== "xy2api") return "free";
  const family = chatModelFamily(ref.model);
  if (family === "openai" || family === "grok") return "hosted";
  if (family === "gemini") return "gemini";
  return "free";
}

/** Whether the chat panel offers 联网搜索 for this model (all models now). */
export function chatWebSearchSupported(ref: ChatModelRef | null): boolean {
  return chatWebSearchMode(ref) !== null;
}

export const CHAT_WEB_SEARCH_HINT: Record<ChatWebSearchMode, string> = {
  hosted: "用模型自带的联网搜索",
  gemini: "用 Gemini 自带的 Google 搜索",
  free: "用免费网页搜索",
};

/** Same, from an id as /api/models lists it (`openai:<model>`, `custom:…`). */
export function chatOptionsForModelId(id: string | null | undefined): {
  efforts: ChatEffort[];
  webSearch: boolean;
  webSearchMode: ChatWebSearchMode | null;
} {
  const ref = id ? parseChatModelRef(id) : null;
  const webSearchMode = chatWebSearchMode(ref);
  return {
    efforts: chatEffortsFor(ref),
    webSearch: webSearchMode !== null,
    webSearchMode,
  };
}
