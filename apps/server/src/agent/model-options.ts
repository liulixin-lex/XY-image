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
 * 第 69 / 70 条 思考强度 that does not run away. A design request is mostly
 * "understand, plan, call a tool, report": deep thinking pays off when the
 * request is read (the call right after the user's message), not on every
 * step after a tool result.
 * - Planning call: the chosen level; 自动 is 中 there (where the model takes
 *   levels; personal providers keep sending nothing).
 * - Execution calls (after a tool result, 第 70 条): the model and level from
 *   设置 › 模型 › 执行步骤模型; without one, the chat model at 低
 *   (chat-options.ts defaultExecutionEffort). runtime.ts resolves them,
 *   deep-agent.ts builds the models, createChatOptionsMiddleware switches.
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

/**
 * Reasoning a model left in the history (Responses API reasoning items,
 * reasoning_content, thinking blocks). Another model may refuse them (an
 * encrypted item belongs to the model that wrote it), so when two models
 * share a run (第 70 条 执行步骤模型) each gets the history without them.
 * Text, tool calls and tool results stay.
 */
export function withoutReasoning<T>(messages: readonly T[]): T[] {
  return messages.map((message) => {
    const m = message as {
      getType?: () => string;
      _getType?: () => string;
      content?: unknown;
      additional_kwargs?: Record<string, unknown>;
    };
    const type = m.getType?.() ?? m._getType?.();
    if (type !== "ai") return message;
    const kwargs = m.additional_kwargs ?? {};
    const reasoningKeys = [
      "reasoning",
      "reasoning_content",
      "reasoning_details",
      "thinking",
    ].filter((k) => k in kwargs);
    const blocks = Array.isArray(m.content)
      ? (m.content as Array<{ type?: string }>).filter(
          (b) =>
            !["reasoning", "thinking", "redacted_thinking"].includes(
              String(b?.type),
            ),
        )
      : m.content;
    const changedBlocks =
      Array.isArray(m.content) &&
      (blocks as unknown[]).length !== m.content.length;
    if (!reasoningKeys.length && !changedBlocks) return message;
    const Ctor = (message as { constructor: new (fields: unknown) => T })
      .constructor;
    const fields = {
      ...(message as Record<string, unknown>),
      content: blocks,
      additional_kwargs: Object.fromEntries(
        Object.entries(kwargs).filter(([k]) => !reasoningKeys.includes(k)),
      ),
    };
    return new Ctor(fields);
  });
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

/** One side of a run: the planning model or the execution model. */
export type ModelTarget = {
  ref: ChatModelRef | null;
  label: string;
  /** The level its calls send (planningEffort / execution effort applied). */
  effort: SentEffort;
  /** How it searches while 联网搜索 is on. */
  search: SearchRoute;
  /**
   * The model with other options (same transport, same key). Without
   * hosted search a model that is not Responses-native goes back to Chat
   * Completions (deep-agent.ts createStreamingChatModel).
   */
  rebuild: (effort: SentEffort, hostedSearch: boolean) => BaseChatModel;
};

export function createChatOptionsMiddleware(options: {
  /** The planning model; the agent's own model is its (effort, search). */
  planning: ModelTarget;
  /**
   * 第 70 条: the calls after a tool result. `separate` when it is another
   * model than the planning one (both then get the history without
   * reasoning, see withoutReasoning). Missing: the planning model as is.
   */
  execution?: ModelTarget & { separate: boolean };
  /**
   * search_web / read_webpage: used for "tools", and what a refused
   * "hosted" search falls back to. Empty: a refusal means no search.
   */
  searchTools?: StructuredTool[];
}) {
  const searchTools = options.searchTools ?? [];
  const searchNames = new Set(searchTools.map((t) => t.name));
  type Side = {
    target: ModelTarget;
    /** Highest level any call may send after a refusal (none yet). */
    ceiling: SentEffort;
    search: SearchRoute;
    models: Map<string, BaseChatModel>;
    /** The agent's own model: the (effort, hosted) it was built with. */
    ownKey?: string;
  };
  const planning: Side = {
    target: options.planning,
    ceiling: "max",
    search: options.planning.search,
    models: new Map(),
    ownKey: `${options.planning.effort}|${options.planning.search === "hosted"}`,
  };
  const separate = options.execution?.separate ?? false;
  // The same model at another level shares the planning side (a refusal or
  // a search switch holds for both); another model has its own.
  const execution: Side | undefined = !options.execution
    ? undefined
    : separate
      ? {
          target: options.execution,
          ceiling: "max",
          search: options.execution.search,
          models: new Map(),
        }
      : planning;
  const executionEffort = options.execution?.effort ?? options.planning.effort;
  const modelFor = (s: Side, effort: SentEffort): BaseChatModel | undefined => {
    const hosted = s.search === "hosted";
    const key = `${effort}|${hosted}`;
    if (key === s.ownKey) return undefined;
    let model = s.models.get(key);
    if (!model) {
      model = s.target.rebuild(effort, hosted);
      s.models.set(key, model);
    }
    return model;
  };
  let executionLogged = false;
  return createMiddleware({
    name: "LoomicChatOptions",
    // Registered so the agent can run them; shown per call below.
    ...(searchTools.length ? { tools: searchTools } : {}),
    wrapModelCall: async (request, handler) => {
      const executing = Boolean(execution) && followsToolResult(request.messages);
      const s = executing ? (execution as Side) : planning;
      const label = executing && separate ? (execution as Side).target.label : planning.target.label;
      const wanted = executing ? executionEffort : options.planning.effort;
      const messages = separate
        ? withoutReasoning(request.messages)
        : request.messages;
      for (let step = 0; ; step++) {
        const effort = lowestOf(wanted, s.ceiling);
        if (executing && !executionLogged) {
          executionLogged = true;
          console.info(
            `[agent-model] steps after a tool result: ${label}${separate ? " (execution model)" : ""} effort ${effort} (first call ${planning.target.label} ${options.planning.effort})`,
          );
        }
        const model = modelFor(s, effort);
        const base = request.tools.filter(
          (t) => !searchNames.has(toolName(t) ?? ""),
        );
        const tools =
          s.search === "hosted"
            ? [...base, WEB_SEARCH_TOOL]
            : s.search === "tools"
              ? [...base, ...searchTools]
              : base;
        try {
          return await handler({
            ...request,
            messages,
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
              `[agent-model] ${label} refused a request with effort ${effort}; trying without`,
            );
            s.ceiling = "auto";
            continue;
          }
          // With hosted search on, a 4xx that names nothing may be the
          // Responses API itself (a group whose upstream lacks it): the
          // model goes back to the API it used before 第 67 条 and searches
          // with the search tools instead (第 68 条).
          if (
            s.search === "hosted" &&
            step < 6 &&
            (refused === "web_search" ||
              (!refused && rejectedRequest(error, [400, 404, 405, 422])))
          ) {
            s.search = searchTools.length ? "tools" : "off";
            console.warn(
              `[agent-model] ${label} refused a request with built-in web search (${refused ?? "unnamed 4xx"}); this run ${s.search === "tools" ? "searches with the web search tool instead" : "goes on without it"}`,
            );
            continue;
          }
          if (refused === "effort" && effort !== "off") {
            const next = lowerChatEffort(s.target.ref, effort);
            console.warn(
              `[agent-model] ${label} refused effort ${effort}; trying ${next}`,
            );
            s.ceiling = next;
            continue;
          }
          // A provider that cannot take our search tools (some refuse
          // function tools they do not know): go on without them.
          if (s.search === "tools" && step < 6 && refused === "web_search") {
            s.search = "off";
            console.warn(
              `[agent-model] ${label} refused the web search tools; this run goes on without them`,
            );
            continue;
          }
          throw error;
        }
      }
    },
  });
}
