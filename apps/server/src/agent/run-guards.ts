import { ToolMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";

import { describeErrorForLog } from "../utils/error-sanitizer.js";

/**
 * 第 67 条 tool calling: guard rails around the agent loop.
 *
 * - 第 70 条: no budget of model calls any more (it was 60, then 30): a run
 *   is held by its context window instead (context-window.ts), and a model
 *   that repeats the very same tool call is stopped by the loop guard below.
 *   The graph's recursion limit is RUN_RECURSION_LIMIT, as in deepagents.
 * - Read-only tools are tried again on a passing failure (a dropped database
 *   connection), never the ones that write or cost money.
 * - Context overflow: see utils/context-overflow.ts and context-window.ts.
 */

/**
 * LangGraph supersteps one run may take: a safety net only (a model call
 * plus its tools is two to four). Without it LangGraph's default of 25 ends
 * a run after about eight tool rounds (v0.0.15 had that, since 第 69 条 built
 * the agent with createAgent instead of createDeepAgent).
 */
export const RUN_RECURSION_LIMIT = 10_000;

/** The same call (tool + arguments) this many times in a row is refused. */
export const LOOP_REPEAT_LIMIT = 3;

export const LOOP_GUARD_TEXT =
  "这个调用和前两次完全一样（同一个工具、同样的参数），结果不会变，这次没有执行。不要再重复它：换个做法，或者直接把现在的情况告诉用户。";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, stable(v)]),
    );
  return value;
}

/**
 * Refuses a tool call identical to the ones right before it (from the
 * LOOP_REPEAT_LIMIT-th on). Any other call in between resets the count, so
 * "look, change, look again" is fine. One guard per agent, i.e. per run.
 */
export function createLoopGuardMiddleware(limit = LOOP_REPEAT_LIMIT) {
  let last = "";
  let repeats = 0;
  return createMiddleware({
    name: "LoomicLoopGuard",
    wrapToolCall: async (request, handler) => {
      const call = request.toolCall;
      const signature = `${call.name}:${JSON.stringify(stable(call.args ?? {}))}`;
      repeats = signature === last ? repeats + 1 : 1;
      last = signature;
      if (repeats >= limit) {
        console.warn(
          `[agent-tools] ${call.name} called ${repeats} times in a row with the same arguments; not run`,
        );
        return new ToolMessage({
          content: LOOP_GUARD_TEXT,
          tool_call_id: call.id ?? "",
          name: call.name,
        });
      }
      return handler(request);
    },
  });
}

/**
 * 第 69 条: tools the design assistant has but should not see. deepagents'
 * file middleware brings ls / glob / grep with read_file; the assistant
 * knows its paths (/workspace/, /memories/AGENTS.md, skills are in the
 * prompt), and with them it browsed directories like a coding agent before
 * doing anything. A call from older history still runs.
 */
export const HIDDEN_TOOLS = ["ls", "glob", "grep", "execute"];

export function createToolDietMiddleware(
  hidden: readonly string[] = HIDDEN_TOOLS,
) {
  const names = new Set(hidden);
  return createMiddleware({
    name: "LoomicToolDiet",
    wrapModelCall: (request, handler) =>
      handler({
        ...request,
        tools: request.tools.filter(
          (tool) => !names.has(String((tool as { name?: unknown }).name ?? "")),
        ),
      }),
  });
}

/** Tools that only read: safe to call again after a passing failure. */
export const RETRYABLE_TOOLS = [
  "inspect_canvas",
  "project_search",
  "get_brand_kit",
  "view_images",
  "read_file",
  "ls",
  "glob",
  "grep",
];

const TRANSIENT =
  /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up|network|timeout|temporarily|503|502|504/i;

const READ_RETRY_DELAYS_MS = [800, 2_000];

export function isTransientToolError(error: unknown): boolean {
  return (
    error instanceof Error && TRANSIENT.test(`${error.name} ${error.message}`)
  );
}

/**
 * Read-only tools get up to two more tries on a passing failure. Inside the
 * tool-errors middleware, which turns what is left into a message for the
 * model. Stops at once when the run is stopped.
 */
export function createReadToolRetryMiddleware(
  delaysMs: readonly number[] = READ_RETRY_DELAYS_MS,
) {
  const tools = new Set(RETRYABLE_TOOLS);
  return createMiddleware({
    name: "LoomicReadToolRetry",
    wrapToolCall: async (request, handler) => {
      const name = request.toolCall.name;
      if (!tools.has(name)) return handler(request);
      for (let attempt = 0; ; attempt++) {
        try {
          return await handler(request);
        } catch (error) {
          const delay = delaysMs[attempt];
          const signal = (
            request.runtime as { signal?: AbortSignal } | undefined
          )?.signal;
          if (
            delay === undefined ||
            signal?.aborted ||
            !isTransientToolError(error)
          )
            throw error;
          console.warn(
            `[agent-tools] ${name} failed (${describeErrorForLog(error)}); try ${attempt + 2} in ${delay}ms`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    },
  });
}
