import { ContextOverflowError } from "@langchain/core/errors";

/**
 * 第 67 条: a gateway's "too many tokens" becomes LangChain's
 * ContextOverflowError in the cause chain, which makes deepagents'
 * summarization middleware compact the history and call again instead of
 * failing the run (it catches only that class, anywhere in the chain).
 * Used by the xy2api chat transport (agent/deep-agent.ts) and personal
 * providers (features/chat-providers/errors.ts).
 */
const CONTEXT_OVERFLOW =
  /context[_ ]length|maximum context|context window|too many tokens|prompt is too long|input is too long|exceeds? the (model'?s )?(context|maximum)|token limit|上下文.{0,6}(超|过长)/i;

/** True when a refusal says the conversation no longer fits the model. */
export function isContextOverflowText(text: string): boolean {
  return CONTEXT_OVERFLOW.test(text);
}

/** Puts a ContextOverflowError in an error's cause chain (deepagents looks there). */
export function markContextOverflow<T extends Error>(error: T): T {
  if (!(error as { cause?: unknown }).cause)
    Object.defineProperty(error, "cause", {
      value: new ContextOverflowError("The conversation is longer than the model's context window."),
      enumerable: false,
      configurable: true,
      writable: true,
    });
  return error;
}
