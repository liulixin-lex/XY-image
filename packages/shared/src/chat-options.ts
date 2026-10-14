import { z } from "zod";

import { type ChatModelRef, parseChatModelRef } from "./chat-models.js";

// 第 67 条: the design assistant's 思考强度 (reasoning effort) and built-in
// web search, per chat model. The chat panel shows only what this file says
// a model takes, and the server sends exactly what resolveChatEffort and
// chatWebSearchSupported return, so the two never disagree.
//
// Main site (xy2api 0.3.0, backend/internal/service/
// openai_reasoning_effort_policy.go and the apicompat converters):
// - OpenAI / Codex (gpt-*, o*, codex*): reasoning.effort low / medium /
//   high / xhigh / max (gpt-6.1-sol lists all five; older ones may stop at
//   xhigh, and a group ceiling may lower it: "downgrade" by default).
// - Claude: low / medium / high / xhigh / max → output_config.effort
//   (xhigh becomes max on most models).
// - Gemini: low / medium / high (OpenAI-compatible reasoning_effort).
// - Grok: low / medium / high; xhigh on grok-4.6 / 4.7 (xy2api turns xhigh
//   into high elsewhere).
// - A personal provider: low / medium / high, the OpenAI-compatible values
//   most of them accept.
// The server steps down once if a model still refuses the level
// (agent/model-options.ts).
//
// Built-in web search: the hosted `web_search` tool of the Responses API.
// xy2api forwards it for Codex accounts (and keeps replayed search history
// valid, openai_oauth_web_search_history.go) and for Grok groups (xAI's
// native web_search). Gemini's google_search needs its own result display
// (Google's grounding rules) and personal providers vary, so they get none.

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
  auto: "由模型决定想多久",
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

function grokTakesXhigh(model: string) {
  return /^grok-4\.[67](-latest)?$/.test(model.trim().toLowerCase());
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
      return ["auto", "low", "medium", "high"];
    case "grok":
      return grokTakesXhigh(ref.model)
        ? ["auto", "low", "medium", "high", "xhigh"]
        : ["auto", "low", "medium", "high"];
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

/** Whether the model gets the hosted web_search tool. */
export function chatWebSearchSupported(ref: ChatModelRef | null): boolean {
  if (!ref || ref.source !== "xy2api") return false;
  const family = chatModelFamily(ref.model);
  return family === "openai" || family === "grok";
}

/** Same, from an id as /api/models lists it (`openai:<model>`, `custom:…`). */
export function chatOptionsForModelId(id: string | null | undefined): {
  efforts: ChatEffort[];
  webSearch: boolean;
} {
  const ref = id ? parseChatModelRef(id) : null;
  return { efforts: chatEffortsFor(ref), webSearch: chatWebSearchSupported(ref) };
}
