import type {
  AIMessage,
  AIMessageChunk,
  ToolMessage,
} from "@langchain/core/messages";
import {
  AIMessageChunk as AIMessageChunkClass,
  AIMessage as AIMessageClass,
  ToolMessage as ToolMessageClass,
} from "@langchain/core/messages";
import { chatRunError } from "../features/chat-providers/run-error.js";
import { describeErrorForLog } from "../utils/error-sanitizer.js";
import { CONTEXT_EVENT, type ContextUpdate } from "./context-window.js";
import { WEB_TOOL_NAMES } from "./tools/web-search.js";

/** Tools that change the canvas: the page fetches it again after them. */
const CANVAS_WRITING_TOOLS = new Set([
  "manipulate_canvas",
  // 第 69 条: node canvas workflows.
  "canvas_workflow",
  "run_workflow",
]);

/**
 * Tools whose result was placed on the canvas by the worker (an `elementId`
 * in the output). The runtime pushes a sync when the job lands, but straight
 * to the sockets: a page that was reconnecting missed it, and the replayed
 * tool.completed stamped 「已放到画布」 on a picture its canvas never
 * fetched. This sync goes through the run's stream, so it is buffered and
 * replayed on resume. (Not CANVAS_WRITING_TOOLS: a failed generation must
 * not count as an answer.)
 */
const CANVAS_PLACING_TOOLS = new Set(["generate_image", "generate_video"]);

import { imageArtifactSchema, videoArtifactSchema } from "@loomic/shared";
import type { StreamEvent, ToolArtifact } from "@loomic/shared";

/**
 * Shape of a LangChain v2 stream event from `streamEvents()`.
 */
type LangChainStreamEvent = {
  event: string;
  name?: string;
  data?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  run_id?: string;
  tags?: string[];
};

type AdaptDeepAgentStreamOptions = {
  conversationId: string;
  customChat?: boolean;
  now?: () => string;
  runId: string;
  sessionId: string;
  signal?: AbortSignal;
  stream: AsyncIterable<LangChainStreamEvent | unknown>;
};

/**
 * Sub-agent parent tool names whose inner tools should have their
 * artifacts suppressed (the parent re-emits them with placement).
 */
const SUB_AGENT_PARENT_TOOLS = new Set(["video_generate"]);
/** Inner tools that may be suppressed when running inside a sub-agent. */
const INNER_SUB_AGENT_TOOLS = new Set(["generate_video"]);

export async function* adaptDeepAgentStream(
  options: AdaptDeepAgentStreamOptions,
): AsyncGenerator<StreamEvent> {
  const now = options.now ?? (() => new Date().toISOString());
  const seenCompletedToolCalls = new Set<string>();
  const seenStreamedMessageIds = new Set<string>();
  const seenStartedToolCalls = new Set<string>();
  /** Tracks active sub-agent parent runs so we can detect nested inner tools. */
  const activeSubAgentRuns = new Set<string>();
  // Whether the user saw anything (text or a tool). A run that ends with
  // neither used to report "completed" and leave the chat blank.
  let produced = false;
  // Whether the run gave the user an answer: text, a picture or video, or a
  // canvas change. Tools that only read (skills, canvas, brand kit) are not
  // one: production saw runs read a skill and the canvas, lose the last
  // turn, and end "completed" with nothing to show (FINDINGS A2).
  let answered = false;
  /** Tool calls the model sent but LangChain could not parse. */
  const invalidToolCalls: string[] = [];
  // L3: one log line per model turn and per tool, no user content.
  let modelTurns = 0;
  const toolStartedAt = new Map<string, number>();

  yield {
    conversationId: options.conversationId,
    runId: options.runId,
    sessionId: options.sessionId,
    timestamp: now(),
    type: "run.started",
  };

  if (options.signal?.aborted) {
    yield canceledEvent(options.runId, now);
    return;
  }

  try {
    for await (const rawEvent of options.stream) {
      if (options.signal?.aborted) {
        yield canceledEvent(options.runId, now);
        return;
      }

      if (!isStreamEvent(rawEvent)) {
        continue;
      }

      const evt = rawEvent;

      // 第 70 条 上下文: the context window's report after each model call
      // (context-window.ts), for the chat panel's meter.
      if (evt.event === "on_custom_event") {
        const name = evt.name;
        const data = evt.data as Partial<ContextUpdate> | undefined;
        if (
          name === CONTEXT_EVENT &&
          typeof data?.usedTokens === "number" &&
          typeof data.windowTokens === "number"
        ) {
          if (data.compacted)
            console.info(
              `[agent-context] run ${options.runId} compacted (${data.reason ?? "auto"}), now ~${data.usedTokens}/${data.windowTokens} tokens`,
            );
          yield {
            type: "context.updated",
            runId: options.runId,
            usedTokens: Math.max(0, Math.round(data.usedTokens)),
            windowTokens: Math.max(1, Math.round(data.windowTokens)),
            compacted: Boolean(data.compacted),
            ...(data.reason ? { reason: data.reason } : {}),
            timestamp: now(),
          };
        }
        continue;
      }

      // Per-token streaming from the chat model
      if (evt.event === "on_chat_model_stream") {
        const chunk = evt.data?.chunk;
        if (!chunk) continue;

        // 第 67 条: a search the model ran with the hosted web_search tool
        // (Responses API output item, finished). Shown as a 联网搜索 tool
        // block; the search itself ran at the main site, nothing ran here.
        for (const search of webSearchCalls(chunk)) {
          if (seenStartedToolCalls.has(search.id)) continue;
          seenStartedToolCalls.add(search.id);
          seenCompletedToolCalls.add(search.id);
          produced = true;
          console.info(
            `[agent-tool] run ${options.runId} web_search ${search.action} ${search.status}`,
          );
          yield {
            runId: options.runId,
            timestamp: now(),
            toolCallId: search.id,
            toolName: "web_search",
            input: search.input,
            type: "tool.started",
          };
          yield {
            output: search.output,
            outputSummary: search.summary,
            runId: options.runId,
            timestamp: now(),
            toolCallId: search.id,
            toolName: "web_search",
            type: "tool.completed",
          };
        }

        // Skip chunks that are tool calls (no text to emit)
        if (
          AIMessageChunkClass.isInstance(chunk) ||
          AIMessageClass.isInstance(chunk)
        ) {
          const msg = chunk as AIMessageChunk | AIMessage;
          if ((msg.tool_calls?.length ?? 0) > 0) continue;
        }

        const messageId =
          (chunk as { id?: string }).id ?? `message_${options.runId}`;

        const content = (chunk as { content: unknown }).content;

        // Handle array content (e.g. Gemini thinking + text blocks)
        if (Array.isArray(content)) {
          for (const part of content) {
            const thinking = thinkingText(part);
            if (thinking !== undefined) {
              if (thinking)
                yield {
                  type: "thinking.delta" as const,
                  runId: options.runId,
                  messageId,
                  delta: thinking,
                  timestamp: now(),
                };
            } else {
              const text =
                typeof part === "string"
                  ? part
                  : part &&
                      typeof part === "object" &&
                      "text" in part &&
                      typeof (part as { text: unknown }).text === "string"
                    ? (part as { text: string }).text
                    : "";
              if (text) {
                seenStreamedMessageIds.add(messageId);
                produced = true;
                answered = true;
                yield {
                  type: "message.delta" as const,
                  runId: options.runId,
                  messageId,
                  delta: text,
                  timestamp: now(),
                };
              }
            }
          }
          continue;
        }

        // String content (normal text)
        const delta = extractChunkText(chunk);
        if (!delta) continue;

        seenStreamedMessageIds.add(messageId);
        produced = true;
        answered = true;
        yield {
          delta,
          messageId,
          runId: options.runId,
          timestamp: now(),
          type: "message.delta",
        };
        continue;
      }

      // Fallback: complete message from non-streaming model (on_chat_model_end)
      if (evt.event === "on_chat_model_end") {
        const output = evt.data?.output;
        if (!output) continue;

        if (
          AIMessageClass.isInstance(output) ||
          AIMessageChunkClass.isInstance(output)
        ) {
          const msg = output as AIMessage | AIMessageChunk;
          const messageId = msg.id ?? `message_${options.runId}`;
          for (const call of msg.invalid_tool_calls ?? [])
            invalidToolCalls.push(call.name ?? "unknown");
          modelTurns += 1;
          console.info(
            `[agent-turn] run ${options.runId} turn ${modelTurns}: ${describeModelTurn(msg)}`,
          );

          // Skip if this was a tool call message (tool lifecycle via on_tool_*)
          if ((msg.tool_calls?.length ?? 0) > 0) continue;
          if (seenStreamedMessageIds.has(messageId)) continue;

          const delta = extractChunkText(msg);
          if (!delta) continue;

          produced = true;
          answered = true;
          yield {
            delta,
            messageId,
            runId: options.runId,
            timestamp: now(),
            type: "message.delta",
          };
        }
        continue;
      }

      // Tool execution started
      if (evt.event === "on_tool_start") {
        const toolName = evt.name ?? "unknown_tool";
        // Use run_id as the tool call identifier for consistent start/end pairing
        const toolCallId = readString(evt.run_id) ?? `tool_${Date.now()}`;

        if (seenStartedToolCalls.has(toolCallId)) continue;
        seenStartedToolCalls.add(toolCallId);
        toolStartedAt.set(toolCallId, Date.now());

        // Extract tool input arguments for frontend display
        const rawInput = evt.data?.input;
        const toolInput =
          rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
            ? (rawInput as Record<string, unknown>)
            : undefined;

        // Track sub-agent parent tools so we can detect nested inner calls.
        if (SUB_AGENT_PARENT_TOOLS.has(toolName)) {
          activeSubAgentRuns.add(toolCallId);
        }

        produced = true;
        yield {
          runId: options.runId,
          timestamp: now(),
          toolCallId,
          toolName,
          ...(toolInput ? { input: toolInput } : {}),
          type: "tool.started",
        };
        continue;
      }

      // A tool threw. The run goes on (tool-errors.ts hands the error to the
      // model), so close the tool's block here or it would spin until the
      // run ends. Skipped once the run is stopped: the stop closes it.
      if (evt.event === "on_tool_error") {
        const toolName = evt.name ?? "unknown_tool";
        const toolCallId = readString(evt.run_id) ?? `tool_${Date.now()}`;
        if (options.signal?.aborted || isAbortError(evt.data?.error)) continue;
        if (!seenStartedToolCalls.has(toolCallId)) continue;
        if (seenCompletedToolCalls.has(toolCallId)) continue;
        seenCompletedToolCalls.add(toolCallId);
        if (SUB_AGENT_PARENT_TOOLS.has(toolName)) {
          activeSubAgentRuns.delete(toolCallId);
        }
        const error = toolFailureText(toolName);
        console.warn(
          `[agent-tool] run ${options.runId} ${toolName} failed after ${toolMs(toolStartedAt, toolCallId)}ms: ${describeErrorForLog(evt.data?.error)}`,
        );
        yield {
          output: { error },
          outputSummary: error,
          runId: options.runId,
          timestamp: now(),
          toolCallId,
          toolName,
          type: "tool.completed",
        };
        continue;
      }

      // Tool execution completed
      if (evt.event === "on_tool_end") {
        const toolName = evt.name ?? "unknown_tool";
        // Use run_id for consistent pairing with on_tool_start
        const toolCallId = readString(evt.run_id) ?? `tool_${Date.now()}`;

        if (seenCompletedToolCalls.has(toolCallId)) continue;
        seenCompletedToolCalls.add(toolCallId);

        const output = evt.data?.output;

        // When an inner tool runs inside an active sub-agent parent,
        // suppress its artifacts because the parent will re-emit them.
        const isNestedInSubAgent =
          INNER_SUB_AGENT_TOOLS.has(toolName) && activeSubAgentRuns.size > 0;
        const extractedArtifacts = isNestedInSubAgent
          ? undefined
          : extractArtifacts(output);
        // 第 68 条: search results and page text are for the model; the
        // chat keeps the query and the sources.
        const extractedOutput = WEB_TOOL_NAMES.has(toolName)
          ? webToolDisplay(output)
          : extractOutput(output, (extractedArtifacts?.length ?? 0) > 0);
        if (
          (extractedArtifacts?.length ?? 0) > 0 ||
          CANVAS_WRITING_TOOLS.has(toolName)
        )
          answered = true;
        console.info(
          `[agent-tool] run ${options.runId} ${toolName} ${toolOutcome(extractedOutput)} in ${toolMs(toolStartedAt, toolCallId)}ms${extractedArtifacts?.length ? `, ${extractedArtifacts.length} artifact(s)` : ""}`,
        );
        yield {
          output: extractedOutput,
          outputSummary: summarizeOutput(output),
          artifacts: extractedArtifacts,
          runId: options.runId,
          timestamp: now(),
          toolCallId,
          toolName,
          type: "tool.completed",
        };

        // Clean up sub-agent parent tracking after its tool.completed is emitted.
        if (SUB_AGENT_PARENT_TOOLS.has(toolName)) {
          activeSubAgentRuns.delete(toolCallId);
        }

        if (
          CANVAS_WRITING_TOOLS.has(toolName) ||
          (CANVAS_PLACING_TOOLS.has(toolName) &&
            typeof (extractedOutput as { elementId?: unknown } | undefined)
              ?.elementId === "string")
        ) {
          yield {
            type: "canvas.sync" as const,
            runId: options.runId,
            timestamp: now(),
          } satisfies StreamEvent;
        }
        continue;
      }
    }
  } catch (error) {
    if (isAbortError(error) || options.signal?.aborted) {
      yield canceledEvent(options.runId, now);
      return;
    }

    // Upstream SDK exceptions may contain credentials or response bodies:
    // the log gets the masked one-line description, the client only the code.
    const failure = chatRunError(error, options.customChat);
    console.error("[stream-adapter] Stream failed", {
      runId: options.runId,
      code: failure.code,
      detail: describeErrorForLog(error),
    });

    yield {
      error: failure,
      runId: options.runId,
      timestamp: now(),
      type: "run.failed",
    };
    return;
  }

  if (!produced) {
    // Names only: tool arguments can carry the user's text.
    console.warn("[stream-adapter] Run ended without any output", {
      runId: options.runId,
      invalidToolCalls,
    });
    yield {
      error: {
        code: "run_failed",
        message: invalidToolCalls.length
          ? "模型返回的工具调用格式不对，这一轮没有结果。请重试，或换一个模型"
          : "模型这次没有返回内容。请重试，或换一个模型",
      },
      runId: options.runId,
      timestamp: now(),
      type: "run.failed",
    };
    return;
  }

  if (!answered) {
    console.warn("[stream-adapter] Run ended without an answer", {
      runId: options.runId,
      modelTurns,
      invalidToolCalls,
    });
    yield {
      error: {
        code: "run_failed",
        message: "这次没有得到回复，可以重试，或换一个对话模型",
      },
      runId: options.runId,
      timestamp: now(),
      type: "run.failed",
    };
    return;
  }

  yield {
    runId: options.runId,
    timestamp: now(),
    type: "run.completed",
  };
}

/** finish reason, tool calls, text size, output tokens and content part types of one model turn. */
function describeModelTurn(msg: AIMessage | AIMessageChunk): string {
  const meta = (msg.response_metadata ?? {}) as Record<string, unknown>;
  const finish =
    meta.finish_reason ??
    meta.stop_reason ??
    meta.status ??
    meta.finishReason ??
    "?";
  // Read loosely: the message union narrows usage_metadata to never here.
  const usage = (
    msg as unknown as {
      usage_metadata?: {
        input_tokens?: number;
        output_tokens?: number;
        input_token_details?: { cache_read?: number };
        output_token_details?: { reasoning?: number };
      };
    }
  ).usage_metadata;
  const content = msg.content;
  const types = Array.isArray(content)
    ? [
        ...new Set(
          content.map((part) =>
            typeof part === "string"
              ? "string"
              : String((part as { type?: unknown }).type ?? "?"),
          ),
        ),
      ].join("+")
    : typeof content;
  const text = extractChunkText(msg)?.length ?? 0;
  // 第 67 条: in / cached (prompt cache hits) / reasoning tokens, to see
  // whether the stable prefix is being cached.
  const cached = usage?.input_token_details?.cache_read;
  const reasoning = usage?.output_token_details?.reasoning;
  return `finish=${String(finish)} tool_calls=${msg.tool_calls?.length ?? 0} invalid_tool_calls=${msg.invalid_tool_calls?.length ?? 0} text=${text} in_tokens=${usage?.input_tokens ?? "?"} cached=${cached ?? "?"} out_tokens=${usage?.output_tokens ?? "?"}${reasoning ? ` reasoning=${reasoning}` : ""} content=${types || "empty"}`;
}

/**
 * Text of a reasoning content part: Gemini-style `{type:"thinking",
 * thinking}` and LangChain's Responses API `{type:"reasoning", reasoning}`
 * (OpenAI reasoning summaries, asked for since 第 67 条). Undefined when the
 * part is not reasoning.
 */
export function thinkingText(part: unknown): string | undefined {
  if (!part || typeof part !== "object" || !("type" in part)) return undefined;
  const p = part as Record<string, unknown>;
  if (p.type === "thinking")
    return typeof p.thinking === "string" ? p.thinking : "";
  if (p.type === "reasoning")
    return typeof p.reasoning === "string" ? p.reasoning : "";
  return undefined;
}

type WebSearchCall = {
  id: string;
  action: string;
  status: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  summary: string;
};

/**
 * Hosted web_search calls finished in this chunk (LangChain puts the
 * Responses API `web_search_call` output item in additional_kwargs
 * .tool_outputs). Action `search` has a query (and, when asked for, the
 * sources), `open_page` a url, `find_in_page` a pattern and url.
 */
export function webSearchCalls(chunk: unknown): WebSearchCall[] {
  const outputs = (
    chunk as { additional_kwargs?: { tool_outputs?: unknown } } | undefined
  )?.additional_kwargs?.tool_outputs;
  if (!Array.isArray(outputs)) return [];
  const calls: WebSearchCall[] = [];
  for (const raw of outputs) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (item.type !== "web_search_call" || typeof item.id !== "string")
      continue;
    const action = (item.action ?? {}) as Record<string, unknown>;
    const kind = typeof action.type === "string" ? action.type : "search";
    const query =
      typeof action.query === "string" ? action.query.slice(0, 200) : undefined;
    const url =
      typeof action.url === "string" ? action.url.slice(0, 300) : undefined;
    const pattern =
      typeof action.pattern === "string"
        ? action.pattern.slice(0, 120)
        : undefined;
    const sources = Array.isArray(action.sources)
      ? action.sources
          .flatMap((s) =>
            s &&
            typeof s === "object" &&
            typeof (s as { url?: unknown }).url === "string"
              ? [{ url: String((s as { url: string }).url).slice(0, 300) }]
              : [],
          )
          .slice(0, 10)
      : [];
    const input = {
      action: kind,
      ...(query ? { query } : {}),
      ...(url ? { url } : {}),
      ...(pattern ? { pattern } : {}),
    };
    const summary =
      kind === "open_page"
        ? `打开网页${url ? ` ${hostOf(url)}` : ""}`
        : kind === "find_in_page"
          ? `在网页里查找${pattern ? `「${pattern}」` : ""}`
          : `搜索${query ? `「${query}」` : "网页"}`;
    calls.push({
      id: item.id,
      action: kind,
      status: typeof item.status === "string" ? item.status : "completed",
      input,
      output: {
        ...input,
        status: item.status ?? "completed",
        ...(sources.length ? { sources } : {}),
      },
      summary,
    });
  }
  return calls;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 60);
  }
}

function toolMs(started: Map<string, number>, id: string): number {
  const at = started.get(id);
  started.delete(id);
  return at ? Date.now() - at : -1;
}

/** ok, or the error code a tool returned in its output. */
function toolOutcome(output: unknown): string {
  if (output && typeof output === "object") {
    const o = output as Record<string, unknown>;
    if (typeof o.errorCode === "string") return `error ${o.errorCode}`;
    if (o.error) return "error";
  }
  return "ok";
}

function canceledEvent(runId: string, now: () => string): StreamEvent {
  return {
    runId,
    timestamp: now(),
    type: "run.canceled",
  };
}

/**
 * LangChain sub-agent tools return a Command object whose real payload
 * lives inside update.messages[0].kwargs.content (a JSON string).
 * Unwrap it so extractArtifacts can find url/placement at the top level.
 */
function unwrapCommandOutput(
  record: Record<string, unknown>,
): Record<string, unknown> {
  if (record.lg_name !== "Command") return record;
  try {
    const messages = (record.update as any)?.messages;
    if (!Array.isArray(messages) || messages.length === 0) return record;
    const content = messages[0]?.kwargs?.content ?? messages[0]?.content;
    if (typeof content !== "string") return record;
    const inner = JSON.parse(content);
    if (inner && typeof inner === "object")
      return inner as Record<string, unknown>;
  } catch {
    // fall through
  }
  return record;
}

const ARTIFACT_KEYS = new Set([
  "url",
  "imageUrl",
  "screenshotUrl",
  "videoUrl",
  "durationSeconds",
  "mimeType",
  "width",
  "height",
  "placement",
]);
const OUTPUT_SIZE_LIMIT = 10240; // 10KB

/**
 * What the chat keeps of a search_web / read_webpage result (第 68 条): the
 * query, where the answer came from and the sources' titles and links, or
 * the page's address and title. The text itself went to the model only.
 */
export function webToolDisplay(
  output: unknown,
): Record<string, unknown> | undefined {
  const text = ToolMessageClass.isInstance(output)
    ? extractChunkText(output)
    : typeof output === "string"
      ? output
      : "";
  const parsed = tryParseJson(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return undefined;
  const value = parsed as Record<string, unknown>;
  const links = [
    ...(Array.isArray(value.sources) ? value.sources : []),
    ...(Array.isArray(value.results) ? value.results : []),
  ]
    .flatMap((s) => {
      const item = s as { url?: unknown; title?: unknown } | null;
      return item && typeof item.url === "string"
        ? [
            {
              url: item.url.slice(0, 500),
              ...(typeof item.title === "string"
                ? { title: item.title.slice(0, 120) }
                : {}),
            },
          ]
        : [];
    })
    .slice(0, 10);
  const pick = (key: string, max: number) =>
    typeof value[key] === "string"
      ? { [key]: (value[key] as string).slice(0, max) }
      : {};
  return {
    ...pick("summary", 200),
    ...pick("query", 200),
    ...pick("via", 40),
    ...pick("url", 500),
    ...pick("title", 200),
    ...pick("error", 200),
    ...(Array.isArray(value.searches)
      ? {
          searches: value.searches
            .filter((q) => typeof q === "string")
            .slice(0, 8),
        }
      : {}),
    ...(links.length ? { sources: links } : {}),
  };
}

function extractOutput(
  output: unknown,
  hasArtifacts: boolean,
): Record<string, unknown> | undefined {
  let text = "";
  if (ToolMessageClass.isInstance(output)) {
    text = extractChunkText(output);
  } else if (typeof output === "string") {
    text = output;
  } else if (output && typeof output === "object") {
    text = JSON.stringify(output);
  }

  const parsed = tryParseJson(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return undefined;

  const unwrapped = unwrapCommandOutput(parsed as Record<string, unknown>);

  // Strip artifact keys if artifacts were extracted
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(unwrapped)) {
    if (hasArtifacts && ARTIFACT_KEYS.has(key)) continue;
    result[key] = value;
  }

  // Skip if empty after stripping
  if (Object.keys(result).length === 0) return undefined;

  // Size limit check
  const serialized = JSON.stringify(result);
  if (serialized.length > OUTPUT_SIZE_LIMIT) return undefined;

  return result;
}

function extractArtifacts(output: unknown): ToolArtifact[] | undefined {
  let text = "";
  if (ToolMessageClass.isInstance(output)) {
    text = extractChunkText(output);
  } else if (typeof output === "string") {
    text = output;
  } else if (output && typeof output === "object") {
    text = JSON.stringify(output);
  }

  const parsed = tryParseJson(text);
  if (!parsed || typeof parsed !== "object") return undefined;

  // If this is a LangChain Command object (from sub-agent), dig into
  // update.messages[0].kwargs.content to find the real structured response.
  const unwrapped = unwrapCommandOutput(parsed as Record<string, unknown>);

  const artifacts: ToolArtifact[] = [];
  const record = unwrapped;

  // New format: sub-agent structured response with url + placement
  if (typeof record.url === "string" && record.url.length > 0) {
    const candidate: Record<string, unknown> = {
      type: "image" as const,
      url: record.url,
      mimeType: (record.mimeType as string) ?? "image/png",
      width: (record.placement as any)?.width ?? 512,
      height: (record.placement as any)?.height ?? 512,
    };
    if (typeof record.title === "string" && record.title.length > 0) {
      candidate.title = record.title;
    }
    if (record.placement && typeof record.placement === "object") {
      candidate.placement = record.placement;
    }
    const result = imageArtifactSchema.safeParse(candidate);
    if (result.success) {
      artifacts.push(result.data);
    }
  }

  // Legacy format: direct tool response with imageUrl
  if (artifacts.length === 0 && typeof record.imageUrl === "string") {
    const candidate: Record<string, unknown> = {
      type: "image" as const,
      url: record.imageUrl,
      mimeType: record.mimeType,
      width: record.width,
      height: record.height,
    };
    if (typeof record.title === "string" && record.title.length > 0) {
      candidate.title = record.title;
    }
    if (record.placement && typeof record.placement === "object") {
      candidate.placement = record.placement;
    }
    const result = imageArtifactSchema.safeParse(candidate);
    if (result.success) {
      artifacts.push(result.data);
    }
  }

  // Screenshot format: tool response with screenshotUrl
  if (artifacts.length === 0 && typeof record.screenshotUrl === "string") {
    const candidate: Record<string, unknown> = {
      type: "image" as const,
      url: record.screenshotUrl,
      mimeType: "image/png",
      width: typeof record.width === "number" ? record.width : 1024,
      height: typeof record.height === "number" ? record.height : 1024,
    };
    const result = imageArtifactSchema.safeParse(candidate);
    if (result.success) {
      artifacts.push(result.data);
    }
  }

  // Video format: tool response with videoUrl from generate_video
  if (typeof record.videoUrl === "string" && record.videoUrl.length > 0) {
    const candidate: Record<string, unknown> = {
      type: "video" as const,
      url: record.videoUrl,
      mimeType: (record.mimeType as string) ?? "video/mp4",
      width: typeof record.width === "number" ? record.width : 1280,
      height: typeof record.height === "number" ? record.height : 720,
    };
    if (typeof record.durationSeconds === "number") {
      candidate.durationSeconds = record.durationSeconds;
    }
    // Prefer LLM-authored title, then original prompt, then technical summary
    if (typeof record.title === "string" && record.title.length > 0) {
      candidate.title = record.title.slice(0, 120);
    } else if (typeof record.prompt === "string") {
      candidate.title = record.prompt.slice(0, 200);
    } else if (typeof record.summary === "string") {
      candidate.title = record.summary.slice(0, 100);
    }
    if (record.placement && typeof record.placement === "object") {
      candidate.placement = record.placement;
    }
    const result = videoArtifactSchema.safeParse(candidate);
    if (result.success) {
      artifacts.push(result.data);
    }
  }

  return artifacts.length > 0 ? artifacts : undefined;
}

/**
 * Extract text from a chat model stream chunk.
 */
function extractChunkText(chunk: unknown): string {
  if (!chunk || typeof chunk !== "object") return "";

  // AIMessageChunk / AIMessage with string content
  if ("content" in chunk) {
    const content = (chunk as { content: unknown }).content;
    if (typeof content === "string") return content;

    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === "string") return part;
          if (
            part &&
            typeof part === "object" &&
            "text" in part &&
            typeof part.text === "string"
          ) {
            return part.text;
          }
          return "";
        })
        .join("");
    }
  }

  return "";
}

function summarizeOutput(output: unknown): string | undefined {
  if (ToolMessageClass.isInstance(output)) {
    const textContent = extractChunkText(output);
    const parsed = tryParseJson(textContent);
    if (
      parsed &&
      typeof parsed === "object" &&
      "summary" in parsed &&
      typeof parsed.summary === "string"
    ) {
      return parsed.summary;
    }
    return textContent || undefined;
  }

  if (output && typeof output === "object") {
    const serialized = JSON.stringify(output);
    const parsed = tryParseJson(serialized);
    if (
      parsed &&
      typeof parsed === "object" &&
      "summary" in parsed &&
      typeof parsed.summary === "string"
    ) {
      return parsed.summary;
    }
    return serialized.length > 200
      ? `${serialized.slice(0, 197)}...`
      : serialized;
  }

  if (typeof output === "string") return output || undefined;
  return undefined;
}

function tryParseJson(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * What the chat shows for a tool that threw. Paid tools may have sent their
 * request before failing, so their result is unknown, not failed.
 */
export function toolFailureText(toolName: string): string {
  if (toolName === "generate_image")
    return "出图过程出错了，图片可能已经生成。可以在设置的「生成记录」里看一下，不会自动重发。";
  if (toolName === "generate_video")
    return "生成视频时出错了，视频可能已经生成。可以在设置的「生成记录」里看一下，不会自动重发。";
  return "这一步出错了，没有完成。";
}

function isAbortError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "AbortError" ||
      error.message === "This operation was aborted")
  );
}

function isStreamEvent(value: unknown): value is LangChainStreamEvent {
  return (
    value !== null &&
    typeof value === "object" &&
    "event" in value &&
    typeof (value as { event: unknown }).event === "string"
  );
}

function readString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
