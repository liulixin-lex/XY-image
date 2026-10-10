import { ToolMessage } from "@langchain/core/messages";
import { ToolInputParsingException } from "@langchain/core/tools";
/**
 * Tool errors go back to the model instead of ending the chat run.
 *
 * deepagents' filesystem middleware wraps every tool call (`wrapToolCall`, to
 * move large results into files). Once any `wrapToolCall` middleware is
 * present, langchain's ToolNode treats an exception from a tool as a
 * middleware error and re-throws it: its default handler, which turns tool
 * errors into a ToolMessage, only applies without middleware. So one argument
 * the schema rejected (`ToolInputParsingException`, e.g. an old
 * `quality: "standard"`) or one unexpected exception ended the whole run with
 * run_failed (「请求处理失败」), and the model never got to fix the call.
 *
 * Custom middleware comes after deepagents' defaults, which makes this the
 * innermost `wrapToolCall`: it sees the tool's own exception first and
 * answers with an error ToolMessage the model can act on.
 *
 * Still thrown, so the run ends as before:
 * - LangGraph bubble-ups (interrupts, parent commands);
 * - anything once the run is aborted (user stop, billing refusal), so a stop
 *   still ends as `run.canceled`.
 *
 * Paid tools (one send, no automatic retry): an argument error happens before
 * anything is sent, so the model may fix the arguments and call again. Any
 * other exception may come after the request went out, so the model is told
 * not to call again for the same picture and to say the result needs checking.
 */
import { isGraphBubbleUp } from "@langchain/langgraph";
import { createMiddleware } from "langchain";

import { describeErrorForLog } from "../utils/error-sanitizer.js";

/** Tools whose call may have sent a paid request before it failed. */
export const PAID_TOOLS = new Set(["generate_image", "generate_video"]);

const DETAIL_MAX = 800;

/**
 * The schema rejected the arguments: the tool never ran. ToolNode wraps the
 * parsing exception in its own ToolInvocationError (`toolError`); that class
 * comes from deepagents' copy of langchain, so it is matched by shape.
 */
export function toolInputError(
  error: unknown,
): ToolInputParsingException | null {
  if (error instanceof ToolInputParsingException) return error;
  const inner =
    error && typeof error === "object" && "toolError" in error
      ? (error as { toolError: unknown }).toolError
      : null;
  return inner instanceof ToolInputParsingException ? inner : null;
}

function isAbortLike(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" ||
      error.message === "This operation was aborted")
  );
}

/** Errors that must still end the run. */
export function mustPropagate(
  error: unknown,
  signal: AbortSignal | undefined,
): boolean {
  return (
    isGraphBubbleUp(error as Error | undefined) ||
    Boolean(signal?.aborted) ||
    isAbortLike(error)
  );
}

/** What the model reads in place of the tool's result. */
export function toolErrorText(toolName: string, error: unknown): string {
  const input = toolInputError(error);
  if (input) {
    const detail = input.message.trim().slice(0, DETAIL_MAX);
    return `调用 ${toolName} 的参数不符合要求，工具没有执行，也没有发出任何请求。\n${detail}\n请按工具说明改正参数后重新调用。`;
  }
  const detail = describeErrorForLog(error);
  if (PAID_TOOLS.has(toolName)) {
    const what = toolName === "generate_video" ? "视频" : "图";
    return `${toolName} 执行出错（${detail}）。这次请求可能已经发出，不要为同一张${what}再次调用。请告诉用户这次的结果待核对，可以在设置的「生成记录」里查看。`;
  }
  return `${toolName} 执行出错（${detail}）。可以改正参数再试一次，或者不用这个工具继续。`;
}

export function createToolErrorMiddleware() {
  return createMiddleware({
    name: "ToolErrorsToModel",
    wrapToolCall: async (request, handler) => {
      try {
        return await handler(request);
      } catch (error) {
        if (mustPropagate(error, request.runtime?.signal)) throw error;
        const toolName = request.toolCall.name;
        const input = toolInputError(error) !== null;
        console.warn(
          `[agent-tools] ${toolName} ${input ? "arguments rejected" : "failed"}; returned to the model: ${describeErrorForLog(input ? toolInputError(error) : error)}`,
        );
        return new ToolMessage({
          content: toolErrorText(toolName, error),
          tool_call_id: request.toolCall.id ?? "",
          name: toolName,
          status: "error",
        });
      }
    },
  });
}
