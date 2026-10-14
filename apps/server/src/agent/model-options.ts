import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredTool } from "@langchain/core/tools";
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
 * 第 67 / 68 条: per-run chat options, applied innermost around every model
 * call.
 *
 * - 联网搜索 (chat-options.ts chatWebSearchMode says how, per model):
 *   - "hosted": the Responses API `web_search` tool is added to the tools
 *     the model sees. The main site runs the search inside the same
 *     response; nothing executes here, and the stream adapter shows the
 *     searches (web_search_call items).
 *   - "tools": the search_web / read_webpage function tools
 *     (tools/web-search.ts: Gemini's own Google Search, or the free search).
 *   They are registered with the agent through this middleware and shown to
 *   the model only while their mode is on.
 * - 思考强度: the model is built with the level (deep-agent.ts
 *   createStreamingChatModel); see chatEffortKwargs for the wire format.
 *
 * A model that still refuses either (an HTTP 400/422 whose text names it) is
 * called again without it, once per step, and the rest of the run goes on
 * without it: a choice in the chat panel must never end a run. A refused
 * built-in search becomes the search tools rather than no search. Logged as
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
    return (provider.upstreamStatus === 400 ||
      provider.upstreamStatus === 422) &&
      provider.refusedOption !== "image"
      ? provider.refusedOption
      : undefined;
  const status = gateway?.failure.diagnostics?.status;
  if (status !== 400 && status !== 422) return undefined;
  const text = `${gateway?.failure.diagnostics?.errorId ?? ""} ${gateway?.failure.diagnostics?.message ?? ""}`;
  if (
    /web[_ ]?search|hosted tool|tool type|unsupported tool|search tool/i.test(
      text,
    )
  )
    return "web_search";
  if (/reasoning|effort|thinking/i.test(text)) return "effort";
  return undefined;
}

/**
 * An HTTP 400/422 (or the given statuses) that rejected the request itself
 * (invalid parameters, an endpoint or model the group does not serve) from
 * the main site or a provider. Moderation, balance, key and rate refusals
 * never count: sending them again without an option changes nothing (the
 * lab's [[mock:safety]] reply was sent twice before this check).
 */
function rejectedRequest(
  error: unknown,
  statuses: readonly number[] = [400, 422],
): boolean {
  const gateway = findCause(
    error,
    (c): c is GatewayError => c instanceof GatewayError,
  );
  if (gateway) {
    const status = gateway.failure.diagnostics?.status;
    return (
      ["invalid_input", "model_not_accessible"].includes(
        gateway.failure.code,
      ) &&
      status !== undefined &&
      statuses.includes(status)
    );
  }
  const provider = findChatProviderError(error);
  return (
    provider !== undefined &&
    ["provider_unavailable", "provider_model_not_found"].includes(
      provider.code,
    ) &&
    provider.upstreamStatus !== undefined &&
    statuses.includes(provider.upstreamStatus)
  );
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
    [...offered].reverse().find((e) => CHAT_EFFORTS.indexOf(e) < rank) ?? "auto"
  );
}

/** How the model searches this run: its own search, our tools, or not. */
export type SearchRoute = "hosted" | "tools" | "off";

function toolName(tool: unknown): string | undefined {
  const name = (tool as { name?: unknown } | null)?.name;
  return typeof name === "string" ? name : undefined;
}

export function createChatOptionsMiddleware(options: {
  ref: ChatModelRef | null;
  label: string;
  effort: ChatEffort;
  search: SearchRoute;
  /**
   * search_web / read_webpage: used for "tools", and what a refused
   * "hosted" search falls back to. Empty: a refusal means no search.
   */
  searchTools?: StructuredTool[];
  /**
   * The chat model with other options (same transport, same key). Without
   * hosted search a model that is not Responses-native goes back to Chat
   * Completions (deep-agent.ts createStreamingChatModel).
   */
  rebuild: (effort: SentEffort, hostedSearch: boolean) => BaseChatModel;
}) {
  let effort: SentEffort = options.effort;
  let search: SearchRoute = options.search;
  let model: BaseChatModel | undefined;
  const searchTools = options.searchTools ?? [];
  const searchNames = new Set(searchTools.map((t) => t.name));
  return createMiddleware({
    name: "LoomicChatOptions",
    // Registered so the agent can run them; shown per call below.
    ...(searchTools.length ? { tools: searchTools } : {}),
    wrapModelCall: async (request, handler) => {
      for (let step = 0; ; step++) {
        const base = request.tools.filter(
          (t) => !searchNames.has(toolName(t) ?? ""),
        );
        const tools =
          search === "hosted"
            ? [...base, WEB_SEARCH_TOOL]
            : search === "tools"
              ? [...base, ...searchTools]
              : base;
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
            model = options.rebuild(effort, search === "hosted");
            continue;
          }
          // With hosted search on, a 4xx that names nothing may be the
          // Responses API itself (a group whose upstream lacks it): the
          // model goes back to the API it used before 第 67 条 and searches
          // with the search tools instead (第 68 条).
          if (
            search === "hosted" &&
            step < 6 &&
            (refused === "web_search" ||
              (!refused && rejectedRequest(error, [400, 404, 405, 422])))
          ) {
            search = searchTools.length ? "tools" : "off";
            model = options.rebuild(effort, false);
            console.warn(
              `[agent-model] ${options.label} refused a request with built-in web search (${refused ?? "unnamed 4xx"}); this run ${search === "tools" ? "searches with the web search tool instead" : "goes on without it"}`,
            );
            continue;
          }
          if (refused === "effort" && effort !== "off") {
            const next = lowerChatEffort(options.ref, effort);
            console.warn(
              `[agent-model] ${options.label} refused effort ${effort}; trying ${next}`,
            );
            effort = next;
            model = options.rebuild(effort, search === "hosted");
            continue;
          }
          // A provider that cannot take our search tools (some refuse
          // function tools they do not know): go on without them.
          if (search === "tools" && step < 6 && refused === "web_search") {
            search = "off";
            console.warn(
              `[agent-model] ${options.label} refused the web search tools; this run goes on without them`,
            );
            continue;
          }
          throw error;
        }
      }
    },
  });
}
