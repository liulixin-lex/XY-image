import { dispatchCustomEvent } from "@langchain/core/callbacks/dispatch";
import { ContextOverflowError } from "@langchain/core/errors";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { getBufferString } from "@langchain/core/messages";
import { type BaseStore, Command } from "@langchain/langgraph";
import { CHAT_CONTEXT_COMPACT_AT, CHAT_CONTEXT_WINDOW } from "@loomic/shared";
import type { BackendFactory } from "deepagents";
import {
  AIMessage,
  type BaseMessage,
  HumanMessage,
  ToolMessage,
  createMiddleware,
} from "langchain";
import { z } from "zod";

import { describeErrorForLog } from "../utils/error-sanitizer.js";

/**
 * 第 70 条 上下文窗口: a conversation is held to a token window instead of a
 * number of model calls. Replaces deepagents' summarization middleware (it
 * summarised only the last 4k tokens of what it dropped, counted Chinese at a
 * quarter of its real size, and could not be run from a 压缩 button).
 *
 * - The window is CHAT_CONTEXT_WINDOW (100k) tokens. When a model call would
 *   send CHAT_CONTEXT_COMPACT_AT (80 %) of it, the older turns are
 *   summarised by the execution model (agent/deep-agent.ts) and only the
 *   summary plus the most recent ~KEEP_RECENT_TOKENS go on. The same happens
 *   when a provider says the context is too long (reason "overflow").
 * - The user can do it at any time from the chat panel (compactThread,
 *   runtime.compactSession, POST /api/sessions/:id/compact).
 * - The summarised turns are written to /history/<session>.md (project
 *   store) so the model can read details back with read_file.
 * - State keys are deepagents' own (_summarizationEvent: cutoff index into
 *   the stored messages + the summary message), so threads it already
 *   summarised keep working.
 * - After each call a `loomic_context` custom event carries the estimate;
 *   stream-adapter.ts turns it into `context.updated` for the chat panel.
 */

export const CONTEXT_WINDOW = CHAT_CONTEXT_WINDOW;
export const COMPACT_AT = CHAT_CONTEXT_COMPACT_AT;
/** Recent turns kept word for word after a compaction. */
export const KEEP_RECENT_TOKENS = 20_000;
/** Most of the dropped turns that goes into the summary call. */
export const SUMMARY_INPUT_TOKENS = 50_000;
export const CONTEXT_EVENT = "loomic_context";
const HISTORY_PREFIX = "/history";

export type SummarizationEvent = {
  cutoffIndex: number;
  summaryMessage: HumanMessage;
  filePath: string | null;
};

export const contextStateSchema = z.object({
  _summarizationSessionId: z.string().optional(),
  _summarizationEvent: z
    .object({
      cutoffIndex: z.number(),
      summaryMessage: z.instanceof(HumanMessage),
      filePath: z.string().nullable(),
    })
    .optional(),
});

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

/** A picture sent to the model costs about this much, whatever its bytes. */
const IMAGE_TOKENS = 1_000;
const CJK = /[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/g;

/** Tokens of a text: CJK characters ~1 each, other text ~1 per 4 chars. */
export function textTokens(text: string): number {
  const cjk = text.match(CJK)?.length ?? 0;
  return Math.ceil(cjk + (text.length - cjk) / 4);
}

function contentTokens(content: unknown): number {
  if (typeof content === "string") return textTokens(content);
  if (!Array.isArray(content)) return 0;
  let total = 0;
  for (const part of content) {
    const p = part as { type?: string; text?: unknown };
    if (typeof part === "string") total += textTokens(part);
    else if (p?.type === "text" && typeof p.text === "string")
      total += textTokens(p.text);
    else if (/image/.test(String(p?.type))) total += IMAGE_TOKENS;
    // Reasoning items and the like: their visible size.
    else total += textTokens(JSON.stringify(part)) / 2;
  }
  return Math.ceil(total);
}

/** Estimated tokens of messages (+ system prompt and tool schemas). */
export function estimateTokens(
  messages: readonly BaseMessage[],
  extra: { system?: unknown; tools?: readonly unknown[] } = {},
): number {
  let total = 0;
  for (const message of messages) {
    total += 4 + contentTokens(message.content);
    const calls = (message as AIMessage).tool_calls;
    if (calls?.length) total += textTokens(JSON.stringify(calls));
  }
  const system = extra.system as { content?: unknown } | string | undefined;
  if (system)
    total += contentTokens(
      typeof system === "string" ? system : (system.content ?? ""),
    );
  if (extra.tools?.length)
    total += textTokens(JSON.stringify(extra.tools.map(toolShape)));
  return total;
}

function toolShape(tool: unknown) {
  const t = tool as {
    name?: string;
    description?: string;
    schema?: unknown;
  };
  return { n: t?.name, d: t?.description };
}

// ---------------------------------------------------------------------------
// Compaction
// ---------------------------------------------------------------------------

/** The messages the model sees: the summary, then what came after it. */
export function effectiveMessages(
  messages: readonly BaseMessage[],
  event: SummarizationEvent | undefined,
): BaseMessage[] {
  if (!event) return [...messages];
  return [event.summaryMessage, ...messages.slice(event.cutoffIndex)];
}

/**
 * A cut point that never separates a tool result from the call that asked
 * for it (port of deepagents' findSafeCutoffPoint): back to the AI message
 * when that is close, else forward past the results.
 */
export function safeCutoff(
  messages: readonly BaseMessage[],
  cutoff: number,
): number {
  if (cutoff >= messages.length || !ToolMessage.isInstance(messages[cutoff]))
    return cutoff;
  let forward = cutoff;
  while (forward < messages.length && ToolMessage.isInstance(messages[forward]))
    forward++;
  const ids = new Set<string>();
  for (let i = cutoff; i < forward; i++) {
    const id = (messages[i] as ToolMessage).tool_call_id;
    if (id) ids.add(id);
  }
  for (let i = cutoff - 1; i >= 0; i--) {
    const message = messages[i];
    if (AIMessage.isInstance(message) && message.tool_calls?.length) {
      if (message.tool_calls.some((c) => c.id && ids.has(c.id)))
        return cutoff - i > cutoff / 2 && cutoff > 2 ? forward : i;
    }
  }
  return forward;
}

/**
 * Where to cut so that about `keep` tokens of recent turns stay. The newest
 * message always stays (the request or tool result being answered).
 */
export function cutoffForKeep(
  messages: readonly BaseMessage[],
  keep: number,
): number {
  let kept = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    kept += estimateTokens([messages[i] as BaseMessage]);
    if (kept > keep)
      return safeCutoff(messages, Math.min(i + 1, messages.length - 1));
  }
  return 0;
}

function isSummary(message: BaseMessage) {
  return (
    HumanMessage.isInstance(message) &&
    message.additional_kwargs?.lc_source === "summarization"
  );
}

export const SUMMARY_PROMPT = `你在为一个 AI 设计助手压缩对话历史。之后的对话只能看到你写的摘要和最近几轮原文，所以要保留继续工作需要的一切：
1. 用户的目标和要求（风格、尺寸、比例、品牌、禁忌），前后矛盾时以后说的为准；
2. 已经做了什么：画布上建了、改了哪些东西（写出元素 id 和名字）；生成了哪些图（任务或图片 id、模型、关键参数）；读写了哪些文件；
3. 用户的反馈和决定：选了哪个、否定了哪个、为什么；
4. 还没做完的事和下一步；
5. 重要的事实、数字、链接。
不写寒暄，不编造，不评价。用中文，分条，控制在 1500 字以内。

对话：
{conversation}`;

function summaryText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((p) =>
        typeof p === "string"
          ? p
          : (p as { type?: string; text?: string })?.type === "text"
            ? ((p as { text?: string }).text ?? "")
            : "",
      )
      .join("");
  return "";
}

/** The newest part of `messages` that fits in `limit` tokens. */
function newestWithin(messages: BaseMessage[], limit: number): BaseMessage[] {
  const out: BaseMessage[] = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as BaseMessage;
    const size = estimateTokens([message]);
    if (used + size > limit) break;
    out.unshift(message);
    used += size;
  }
  return out;
}

export function buildSummaryMessage(
  summary: string,
  filePath: string | null,
): HumanMessage {
  const where = filePath
    ? `完整的早期记录在 ${filePath}，需要细节时用 read_file 读（可以分段读）。`
    : "";
  return new HumanMessage({
    content: `这段对话较早的部分已经压缩成下面的摘要。${where}\n\n<summary>\n${summary}\n</summary>`,
    additional_kwargs: { lc_source: "summarization" },
  });
}

export type CompactionDeps = {
  /** Writes the summarised turns (best effort). */
  backend?: BackendFactory;
  store?: BaseStore;
  /** The model that writes the summary (the execution model). */
  model: BaseChatModel;
};

export type CompactionResult = {
  event: SummarizationEvent;
  sessionId: string;
  /** Estimated tokens of the messages before and after. */
  before: number;
  after: number;
};

async function offload(
  deps: CompactionDeps,
  state: Record<string, unknown>,
  path: string,
  messages: BaseMessage[],
): Promise<string | null> {
  if (!deps.backend) return null;
  try {
    const backend = deps.backend({
      state: state as never,
      ...(deps.store ? { store: deps.store } : {}),
    } as never) as {
      read?: (path: string) => Promise<string>;
      write: (path: string, content: string) => Promise<{ error?: string }>;
      edit: (
        path: string,
        oldText: string,
        newText: string,
      ) => Promise<{ error?: string }>;
      downloadFiles?: (
        paths: string[],
      ) => Promise<Array<{ content?: Uint8Array; error?: unknown }>>;
    };
    const section = `## ${new Date().toISOString()} 压缩前的对话\n\n${getBufferString(messages.filter((m) => !isSummary(m)))}\n\n`;
    let existing: string | null = null;
    if (backend.downloadFiles) {
      const [file] = await backend.downloadFiles([path]).catch(() => []);
      if (file?.content && !file.error)
        existing = new TextDecoder().decode(file.content);
    }
    const result =
      existing === null
        ? await backend.write(path, section)
        : await backend.edit(path, existing, existing + section);
    if (result?.error) {
      console.warn(`[context] could not save the history (${result.error})`);
      return null;
    }
    return path;
  } catch (error) {
    console.warn(
      `[context] could not save the history (${describeErrorForLog(error)})`,
    );
    return null;
  }
}

/**
 * Summarises `effective[0..cutoff)` (the messages the model sees now) and
 * returns the state event that replaces them. `stored` is the length of the
 * stored message list (the cutoff in the event indexes it).
 */
export async function compactMessages(options: {
  effective: BaseMessage[];
  storedLength: number;
  keepTokens: number;
  state: Record<string, unknown>;
  deps: CompactionDeps;
  extra?: { system?: unknown; tools?: readonly unknown[] };
}): Promise<CompactionResult | null> {
  const { effective, deps, state } = options;
  const cutoff = cutoffForKeep(effective, options.keepTokens);
  if (cutoff <= 0) return null;
  const dropped = effective.slice(0, cutoff);
  const kept = effective.slice(cutoff);
  // Nothing new to summarise: only the previous summary would go.
  if (dropped.every(isSummary)) return null;
  const sessionId =
    (state._summarizationSessionId as string | undefined) ??
    `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const filePath = await offload(
    deps,
    state,
    `${HISTORY_PREFIX}/${sessionId}.md`,
    dropped,
  );
  // The previous summary stays in the input, so details from before it
  // survive a second compaction.
  const input = newestWithin(dropped, SUMMARY_INPUT_TOKENS);
  const response = await deps.model.invoke([
    new HumanMessage(
      SUMMARY_PROMPT.replace("{conversation}", getBufferString(input)),
    ),
  ]);
  const summary = summaryText(response.content).trim();
  if (!summary) throw new Error("the summary came back empty");
  const summaryMessage = buildSummaryMessage(summary, filePath);
  // effective[0] is the old summary when there was one: its position in
  // the stored list is the old cutoff.
  const previous = state._summarizationEvent as SummarizationEvent | undefined;
  const offset = previous ? previous.cutoffIndex - 1 : 0;
  const event: SummarizationEvent = {
    cutoffIndex: Math.min(options.storedLength, offset + cutoff),
    summaryMessage,
    filePath,
  };
  return {
    event,
    sessionId,
    before: estimateTokens(effective, options.extra),
    after: estimateTokens([summaryMessage, ...kept], options.extra),
  };
}

function isContextOverflow(error: unknown): boolean {
  for (let cause = error; cause; ) {
    if (ContextOverflowError.isInstance(cause)) return true;
    cause =
      typeof cause === "object" && cause && "cause" in cause
        ? (cause as { cause?: unknown }).cause
        : undefined;
  }
  return false;
}

export type ContextUpdate = {
  usedTokens: number;
  windowTokens: number;
  compacted: boolean;
  reason?: "auto" | "manual" | "overflow";
};

async function report(update: ContextUpdate) {
  try {
    await dispatchCustomEvent(CONTEXT_EVENT, update);
  } catch {
    // Outside a run (tests, compaction from the button): nobody listens.
  }
}

/** Real input tokens of a response, when the provider reported them. */
function reportedInput(response: unknown): number | undefined {
  const usage = (
    response as { usage_metadata?: { input_tokens?: unknown } } | undefined
  )?.usage_metadata;
  const input = usage?.input_tokens;
  return typeof input === "number" && input > 0 ? input : undefined;
}

export function createContextWindowMiddleware(
  options: CompactionDeps & {
    window?: number;
    label?: string;
  },
) {
  const window = options.window ?? CONTEXT_WINDOW;
  // Our estimate against what the provider counted on the last call of
  // this run (clamped): Chinese, code and pictures all count differently.
  let ratio = 1;
  return createMiddleware({
    name: "LoomicContextWindow",
    stateSchema: contextStateSchema,
    wrapModelCall: async (request, handler) => {
      const state = request.state as Record<string, unknown>;
      const stored = (request.messages ?? []) as BaseMessage[];
      const previous = state._summarizationEvent as
        | SummarizationEvent
        | undefined;
      let messages = effectiveMessages(stored, previous);
      const extra = {
        system: request.systemMessage,
        tools: request.tools as readonly unknown[],
      };
      const estimate = () =>
        Math.round(estimateTokens(messages, extra) * ratio);
      let update: CompactionResult | null = null;
      let reason: ContextUpdate["reason"];

      const compact = async (why: "auto" | "overflow", keep: number) => {
        const started = Date.now();
        const result = await compactMessages({
          effective: messages,
          storedLength: stored.length,
          keepTokens: keep,
          state: {
            ...state,
            ...(update
              ? {
                  _summarizationEvent: update.event,
                  _summarizationSessionId: update.sessionId,
                }
              : {}),
          },
          deps: options,
          extra,
        });
        if (!result) return false;
        console.info(
          `[context] ${options.label ?? "run"}: compacted (${why}) ~${Math.round(result.before * ratio)} → ~${Math.round(result.after * ratio)} tokens in ${Date.now() - started}ms${result.event.filePath ? "" : ", history not saved"}`,
        );
        update = result;
        reason = why;
        messages = effectiveMessages(stored, result.event);
        return true;
      };

      // A quarter of the window at most (20k of 100k).
      const keepRecent = Math.min(KEEP_RECENT_TOKENS, Math.round(window / 4));
      if (estimate() >= window * COMPACT_AT)
        await compact("auto", keepRecent).catch((error) => {
          // A failed summary must not end the run: go on with everything.
          console.warn(
            `[context] compaction failed (${describeErrorForLog(error)}); sending the full context`,
          );
        });

      let response: unknown;
      try {
        response = await handler({ ...request, messages });
      } catch (error) {
        if (!isContextOverflow(error)) throw error;
        // The provider's window is smaller than ours: keep less.
        const keep = Math.min(keepRecent, Math.round(estimate() / 4));
        if (!(await compact("overflow", keep))) throw error;
        response = await handler({ ...request, messages });
      }

      const input = reportedInput(response);
      const approx = estimateTokens(messages, extra);
      if (input && approx > 0)
        ratio = Math.min(3, Math.max(0.5, input / approx));
      const output = estimateTokens(
        AIMessage.isInstance(response) ? [response] : [],
      );
      await report({
        usedTokens: Math.round((input ?? approx * ratio) + output),
        windowTokens: window,
        compacted: Boolean(update),
        ...(reason ? { reason } : {}),
      });
      if (!update) return response as AIMessage;
      const done = update as CompactionResult;
      return new Command({
        update: {
          _summarizationEvent: done.event,
          _summarizationSessionId: done.sessionId,
        },
      });
    },
  });
}

/**
 * The 压缩 button (第 70 条): compacts a stored thread outside a run. Keeps
 * less than the automatic one (the user asked for room), at least ~2k.
 */
export async function compactThread(options: {
  messages: BaseMessage[];
  state: Record<string, unknown>;
  deps: CompactionDeps;
}): Promise<CompactionResult | null> {
  const previous = options.state._summarizationEvent as
    | SummarizationEvent
    | undefined;
  const effective = effectiveMessages(options.messages, previous);
  const total = estimateTokens(effective);
  const keep = Math.min(
    KEEP_RECENT_TOKENS,
    Math.max(2_000, Math.round(total * 0.3)),
  );
  return compactMessages({
    effective,
    storedLength: options.messages.length,
    keepTokens: keep,
    state: options.state,
    deps: options.deps,
  });
}

/** How full a stored thread is (the chat panel's meter). */
export function threadContext(
  messages: BaseMessage[],
  state: Record<string, unknown>,
): { usedTokens: number; windowTokens: number; compacted: boolean } {
  const event = state._summarizationEvent as SummarizationEvent | undefined;
  return {
    usedTokens: estimateTokens(effectiveMessages(messages, event)),
    windowTokens: CONTEXT_WINDOW,
    compacted: Boolean(event),
  };
}

/** The part of a compiled agent graph compaction needs. */
export type ThreadGraph = {
  getState(config: {
    configurable: { thread_id: string };
  }): Promise<{ values: unknown }>;
  updateState(
    config: { configurable: { thread_id: string } },
    values: Record<string, unknown>,
    asNode?: string,
  ): Promise<unknown>;
};

/** createAgent's model node: the summary is written as if it ran. */
export const MODEL_NODE = "model_request";

/**
 * 压缩 a stored thread (runtime.compactSession): reads it through the
 * agent's own graph (same state channels as a run, so nothing else in the
 * thread is touched), summarises, writes the event back.
 */
export async function compactAgentThread(options: {
  graph: ThreadGraph;
  threadId: string;
  deps: CompactionDeps;
}): Promise<{
  compacted: boolean;
  usedTokens: number;
  windowTokens: number;
  before?: number;
}> {
  const config = { configurable: { thread_id: options.threadId } };
  const snapshot = await options.graph.getState(config);
  const values = (snapshot.values ?? {}) as Record<string, unknown>;
  const messages = (values.messages ?? []) as BaseMessage[];
  const result = await compactThread({
    messages,
    state: values,
    deps: options.deps,
  });
  if (!result) {
    const { usedTokens, windowTokens } = threadContext(messages, values);
    return { compacted: false, usedTokens, windowTokens };
  }
  await options.graph.updateState(
    config,
    {
      _summarizationEvent: result.event,
      _summarizationSessionId: result.sessionId,
    },
    MODEL_NODE,
  );
  console.info(
    `[context] thread compacted by hand ~${result.before} → ~${result.after} tokens${result.event.filePath ? "" : ", history not saved"}`,
  );
  return {
    compacted: true,
    usedTokens: result.after,
    windowTokens: CONTEXT_WINDOW,
    before: result.before,
  };
}

/** The chat panel's meter for a stored thread. */
export async function readThreadContext(graph: ThreadGraph, threadId: string) {
  const snapshot = await graph.getState({
    configurable: { thread_id: threadId },
  });
  const values = (snapshot.values ?? {}) as Record<string, unknown>;
  return threadContext((values.messages ?? []) as BaseMessage[], values);
}
