import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  CHAT_EFFORTS,
  type ChatEffort,
  type ChatModelRef,
  chatEffortsFor,
  chatModelFamily,
} from "@loomic/shared";
import { createMiddleware } from "langchain";

import { findChatProviderError } from "../features/chat-providers/errors.js";
import { GatewayError } from "../features/xy2api/errors.js";
import { findCause } from "../utils/error-chain.js";

/**
 * 第 67 条: per-run chat options, applied innermost around every model call.
 *
 * - 联网搜索: the hosted `web_search` tool of the Responses API is added to
 *   the tools the model sees (chat-options.ts says which models get it). The
 *   main site runs the search inside the same response; nothing executes
 *   here, and the stream adapter shows the searches (web_search_call items).
 * - 思考强度: the model is built with the level (deep-agent.ts
 *   createStreamingChatModel); see chatEffortKwargs for the wire format.
 *
 * A model that still refuses either (an HTTP 400/422 whose text names it) is
 * called again without it, once per step, and the rest of the run goes on
 * without it: a choice in the chat panel must never end a run. Logged as
 * `[agent-model] … refused …`.
 */

export const WEB_SEARCH_TOOL = { type: "web_search" } as const;

/**
 * Request fields for an effort level. LangChain's own `reasoning` option is
 * only sent for model names it knows (gpt-5*, o*), not the main site's
 * gpt-6*, grok-*, … names, so the fields go in as model kwargs.
 * - Responses API: `reasoning.effort`, plus `summary: "auto"` for OpenAI
 *   models so the reasoning shows as 思考 and the stream stays alive while
 *   the model thinks.
 * - Chat Completions: `reasoning_effort` (xy2api maps it per vendor).
 */
/** A level, or "off": no reasoning fields at all (the last fallback). */
export type SentEffort = ChatEffort | "off";

export function chatEffortKwargs(
  model: string,
  effort: SentEffort,
  responsesApi: boolean,
): Record<string, unknown> {
  if (effort === "off") return {};
  const summary = responsesApi && chatModelFamily(model) === "openai";
  if (effort === "auto")
    return summary ? { reasoning: { summary: "auto" } } : {};
  if (responsesApi)
    return {
      reasoning: { effort, ...(summary ? { summary: "auto" } : {}) },
    };
  return { reasoning_effort: effort };
}

/** What the refusal is about, read from the upstream's own words. */
export function refusedChatOption(
  error: unknown,
): "web_search" | "effort" | undefined {
  const gateway = findCause(
    error,
    (c): c is GatewayError => c instanceof GatewayError,
  );
  const provider = gateway ? undefined : findChatProviderError(error);
  if (provider)
    return provider.upstreamStatus === 400 || provider.upstreamStatus === 422
      ? provider.refusedOption
      : undefined;
  const status = gateway?.failure.diagnostics?.status;
  if (status !== 400 && status !== 422) return undefined;
  const text = `${gateway?.failure.diagnostics?.errorId ?? ""} ${gateway?.failure.diagnostics?.message ?? ""}`;
  if (/web[_ ]?search|hosted tool|tool type|unsupported tool|search tool/i.test(text))
    return "web_search";
  if (/reasoning|effort|thinking/i.test(text)) return "effort";
  return undefined;
}

/** An HTTP 400/422 (or the given statuses) from the main site or a provider. */
function rejectedRequest(
  error: unknown,
  statuses: readonly number[] = [400, 422],
): boolean {
  const gateway = findCause(
    error,
    (c): c is GatewayError => c instanceof GatewayError,
  );
  const status = gateway
    ? gateway.failure.diagnostics?.status
    : findChatProviderError(error)?.upstreamStatus;
  return status !== undefined && statuses.includes(status);
}

/**
 * The next level down that the model takes; below the lowest, 自动 (no
 * effort, a reasoning summary may still be asked for); below 自动, "off".
 */
export function lowerChatEffort(
  ref: ChatModelRef | null,
  effort: SentEffort,
): SentEffort {
  if (effort === "auto" || effort === "off") return "off";
  const offered = chatEffortsFor(ref).filter((e) => e !== "auto");
  const rank = CHAT_EFFORTS.indexOf(effort);
  return (
    [...offered].reverse().find((e) => CHAT_EFFORTS.indexOf(e) < rank) ??
    "auto"
  );
}

export function createChatOptionsMiddleware(options: {
  ref: ChatModelRef | null;
  label: string;
  effort: ChatEffort;
  webSearch: boolean;
  /**
   * The chat model with other options (same transport, same key). Without
   * web search a model that is not Responses-native goes back to Chat
   * Completions (deep-agent.ts createStreamingChatModel).
   */
  rebuild: (effort: SentEffort, webSearch: boolean) => BaseChatModel;
}) {
  let effort: SentEffort = options.effort;
  let webSearch = options.webSearch;
  let model: BaseChatModel | undefined;
  return createMiddleware({
    name: "LoomicChatOptions",
    wrapModelCall: async (request, handler) => {
      for (let step = 0; ; step++) {
        const tools = webSearch
          ? [...request.tools, WEB_SEARCH_TOOL]
          : request.tools;
        try {
          return await handler({
            ...request,
            tools: tools as typeof request.tools,
            ...(model ? { model } : {}),
          });
        } catch (error) {
          const refused = step < 6 ? refusedChatOption(error) : undefined;
          // A 400 that names nothing while a level is sent (some personal
          // providers just say "invalid parameter"): try once without it.
          if (
            !refused &&
            step < 6 &&
            effort !== "auto" &&
            effort !== "off" &&
            rejectedRequest(error)
          ) {
            console.warn(
              `[agent-model] ${options.label} refused a request with effort ${effort}; trying without`,
            );
            effort = "auto";
            model = options.rebuild(effort, webSearch);
            continue;
          }
          // With search on, a 4xx that names nothing may be the Responses
          // API itself (a group whose upstream lacks it): without search
          // the model goes back to the API it used before 第 67 条.
          if (
            webSearch &&
            step < 6 &&
            (refused === "web_search" ||
              (!refused && rejectedRequest(error, [400, 404, 405, 422])))
          ) {
            webSearch = false;
            model = options.rebuild(effort, false);
            console.warn(
              `[agent-model] ${options.label} refused a request with built-in web search (${refused ?? "unnamed 4xx"}); this run goes on without it`,
            );
            continue;
          }
          if (refused === "effort" && effort !== "off") {
            const next = lowerChatEffort(options.ref, effort);
            console.warn(
              `[agent-model] ${options.label} refused effort ${effort}; trying ${next}`,
            );
            effort = next;
            model = options.rebuild(effort, webSearch);
            continue;
          }
          throw error;
        }
      }
    },
  });
}
