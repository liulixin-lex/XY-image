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

/**
 * 第 69 条 思考强度 that does not run away. A design request is mostly
 * "understand, plan, call a tool, report": deep thinking pays off when the
 * request is read (the call right after the user's message), not on every
 * step after a tool result. So:
 * - 自动 is 中 for that first call (where the model takes levels; personal
 *   providers keep sending nothing), and 低 afterwards;
 * - a chosen level is used for the first call; the calls after a tool
 *   result use at most 中 (低 stays 低).
 */
export function planningEffort(
  ref: ChatModelRef | null,
  effort: ChatEffort,
): ChatEffort {
  if (effort !== "auto" || !ref || ref.source === "custom") return effort;
  return chatEffortsFor(ref).includes("medium") ? "medium" : "auto";
}

const EFFORT_RANK: Record<SentEffort, number> = {
  off: 0,
  auto: 1,
  low: 2,
  medium: 3,
  high: 4,
  xhigh: 5,
  max: 6,
};

function lowestOf(a: SentEffort, b: SentEffort): SentEffort {
  return EFFORT_RANK[a] <= EFFORT_RANK[b] ? a : b;
}

/** The level for a call that follows a tool result (see planningEffort). */
export function executionEffort(
  ref: ChatModelRef | null,
  planning: SentEffort,
  chosen: ChatEffort,
): SentEffort {
  if (planning === "off" || planning === "auto") return planning;
  const cap: ChatEffort =
    chosen === "auto" || chosen === "low" ? "low" : "medium";
  if (EFFORT_RANK[planning] <= EFFORT_RANK[cap]) return planning;
  return chatEffortsFor(ref).includes(cap) ? cap : planning;
}

/** Whether this model call follows a tool result (not the user's message). */
export function followsToolResult(messages: readonly unknown[]): boolean {
  const last = messages.at(-1) as
    | { getType?: () => string; _getType?: () => string; type?: unknown }
    | undefined;
  const type = last?.getType?.() ?? last?._getType?.() ?? last?.type;
  return type === "tool";
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
  /** The level of the planning call (planningEffort applied). */
  effort: SentEffort;
  /** What the chat panel asked for; picks the cap after tool results. */
  chosen?: ChatEffort;
  search: SearchRoute;
  /**
   * search_web / read_webpage: used for "tools", and what a refused
   * "hosted" search falls back to. Empty: a refusal means no search.
   */
  searchTools?: StructuredTool[];
  /**
   * The chat model with other options (same transport, same key). Without
   * hosted search a model that is not Responses-native goes back to Chat
   * Completions (deep-agent.ts createStreamingChatModel). The agent's own
   * model is the one for (effort, the initial search route).
   */
  rebuild: (effort: SentEffort, hostedSearch: boolean) => BaseChatModel;
}) {
  const chosen: ChatEffort =
    options.chosen ?? (options.effort === "off" ? "auto" : options.effort);
  /** Highest level any call may send after a refusal (none yet). */
  let ceiling: SentEffort = "max";
  let search: SearchRoute = options.search;
  const initialKey = `${options.effort}|${options.search === "hosted"}`;
  const models = new Map<string, BaseChatModel>();
  const modelFor = (effort: SentEffort): BaseChatModel | undefined => {
    const hosted = search === "hosted";
    const key = `${effort}|${hosted}`;
    if (key === initialKey) return undefined;
    let model = models.get(key);
    if (!model) {
      model = options.rebuild(effort, hosted);
      models.set(key, model);
    }
    return model;
  };
  const searchTools = options.searchTools ?? [];
  const searchNames = new Set(searchTools.map((t) => t.name));
  let executionLogged = false;
  return createMiddleware({
    name: "LoomicChatOptions",
    // Registered so the agent can run them; shown per call below.
    ...(searchTools.length ? { tools: searchTools } : {}),
    wrapModelCall: async (request, handler) => {
      const execution = followsToolResult(request.messages);
      for (let step = 0; ; step++) {
        const wanted = execution
          ? executionEffort(options.ref, options.effort, chosen)
          : options.effort;
        const effort = lowestOf(wanted, ceiling);
        if (execution && effort !== options.effort && !executionLogged) {
          executionLogged = true;
          console.info(
            `[agent-model] ${options.label} steps after a tool result use effort ${effort} (first call ${options.effort})`,
          );
        }
        const model = modelFor(effort);
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
            ceiling = "auto";
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
            ceiling = next;
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
