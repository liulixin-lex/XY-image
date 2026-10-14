import { AIMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";

import { describeErrorForLog } from "../utils/error-sanitizer.js";

/**
 * 第 67 条 tool calling: guard rails around the agent loop.
 *
 * - A per-run budget of model calls. A confused model can loop on the same
 *   tool for ever (deepagents sets recursionLimit 10 000); past the budget
 *   the run stops with a line the user can act on instead of spinning.
 * - Read-only tools are tried again on a passing failure (a dropped database
 *   connection), never the ones that write or cost money.
 * - Context overflow: see utils/context-overflow.ts.
 */

/** Model calls one run may make. Typical runs take 3–12. */
export const RUN_MODEL_CALL_BUDGET = 60;

export const RUN_BUDGET_TEXT =
  "这一轮的步骤太多了，我先停在这里。已经完成的改动都保留着；你可以告诉我接下来先做哪一步，我接着来。";

export function createRunBudgetMiddleware(limit = RUN_MODEL_CALL_BUDGET) {
  let calls = 0;
  return createMiddleware({
    name: "LoomicRunBudget",
    wrapModelCall: async (request, handler) => {
      calls += 1;
      if (calls > limit) {
        console.warn(`[agent-model] run stopped after ${limit} model calls`);
        return new AIMessage({ content: RUN_BUDGET_TEXT });
      }
      return handler(request);
    },
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
          const signal = (request.runtime as { signal?: AbortSignal } | undefined)?.signal;
          if (delay === undefined || signal?.aborted || !isTransientToolError(error)) throw error;
          console.warn(
            `[agent-tools] ${name} failed (${describeErrorForLog(error)}); try ${attempt + 2} in ${delay}ms`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    },
  });
}
