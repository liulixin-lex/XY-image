import { createMiddleware } from "langchain";

import { findChatProviderError } from "../features/chat-providers/errors.js";
import { findCause } from "../utils/error-chain.js";
import { describeErrorForLog } from "../utils/error-sanitizer.js";
import { GatewayError } from "../features/xy2api/errors.js";

/**
 * 第 67 条: model calls the main site (or a personal provider) turned away
 * before answering are sent again, a few seconds later, instead of ending
 * the chat run.
 *
 * Before: the chat model ran with maxRetries 0, so one 503 「主站暂时繁忙」
 * (old prod: 2 of 25 runs, both on their very first call) or one dropped
 * connection ended the run. LangChain's modelRetryMiddleware does the same
 * loop, but it cannot see our error types through the MiddlewareError
 * wrapping, does not stop on a user's stop, and logs nothing; this one does.
 *
 * Only failures that came before any streamed output are retried:
 * - GatewayError from the xy2api transport (deep-agent.ts), raised on a
 *   non-2xx status before the body is handed to the model client, or for an
 *   error event inside the stream before any output (tool-call-stream.ts
 *   marks one after output with `afterOutput`; e.g. 200 + "Codex is at
 *   capacity" as the first event, seen on prod 10-14);
 * - ChatConnectError: the request could not be sent or no response came;
 * - ChatProviderError from a personal provider's transport (network.ts),
 *   also raised before the body is returned.
 * An error in the middle of a stream is never retried here: the page has
 * already shown part of the answer, and a second answer would follow it.
 */

/** Thrown by the xy2api chat transport when no response came back. */
export class ChatConnectError extends Error {
  constructor(readonly detail: string) {
    super("对话连接中断，请稍后再试");
    this.name = "ChatConnectError";
  }
}

const RETRY_GATEWAY_CODES = new Set([
  "upstream_busy",
  "rate_limited",
  "xy2api_unavailable",
]);
const RETRY_PROVIDER_CODES = new Set([
  "provider_rate_limited",
  "provider_unavailable",
]);

/** Waits before the 2nd, 3rd and 4th try. */
export const MODEL_RETRY_DELAYS_MS = [2_000, 6_000, 15_000];

/** Why a failed model call may be sent again; undefined = it may not. */
export function retryableModelFailure(error: unknown): string | undefined {
  const gateway = findCause(
    error,
    (c): c is GatewayError => c instanceof GatewayError,
  );
  if (gateway)
    return RETRY_GATEWAY_CODES.has(gateway.failure.code) && !gateway.afterOutput
      ? gateway.failure.code
      : undefined;
  const provider = findChatProviderError(error);
  if (provider) {
    // provider_unavailable also covers a 400 the provider refused (an
    // option it does not take): resending that never helps.
    const status = provider.upstreamStatus;
    if (status !== undefined && status < 500 && status !== 429) return undefined;
    return RETRY_PROVIDER_CODES.has(provider.code) ? provider.code : undefined;
  }
  const connect = findCause(
    error,
    (c): c is ChatConnectError => c instanceof ChatConnectError,
  );
  return connect ? `connect (${connect.detail})` : undefined;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error("aborted"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function createModelRetryMiddleware(
  options: {
    delaysMs?: readonly number[];
    wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
  } = {},
) {
  const delays = options.delaysMs ?? MODEL_RETRY_DELAYS_MS;
  const wait = options.wait ?? sleep;
  return createMiddleware({
    name: "LoomicModelRetry",
    wrapModelCall: async (request, handler) => {
      const signal = (request.runtime as { signal?: AbortSignal } | undefined)
        ?.signal;
      for (let attempt = 0; ; attempt++) {
        try {
          const result = await handler(request);
          if (attempt > 0)
            console.log(
              `[agent-model] call succeeded on try ${attempt + 1}`,
            );
          return result;
        } catch (error) {
          const reason = retryableModelFailure(error);
          const delay = delays[attempt];
          if (!reason || delay === undefined || signal?.aborted) {
            if (reason)
              console.warn(
                `[agent-model] call failed (${reason}) after ${attempt + 1} tries; giving up`,
              );
            throw error;
          }
          console.warn(
            `[agent-model] call failed (${reason}); try ${attempt + 2}/${delays.length + 1} in ${delay}ms: ${describeErrorForLog(error)}`,
          );
          await wait(delay, signal);
        }
      }
    },
  });
}
