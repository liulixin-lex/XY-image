import type { GatewayFailure } from "../xy2api/errors.js";

// 第 67 条: image jobs the main site turned away as busy, with nothing
// charged, are sent again by the worker instead of failing.
//
// Why: on the old prod (2026-10-10..14) 58 of ~300 image jobs failed as
// upstream_busy or rate_limited. They came in bursts while many 4K jobs ran
// at once: quick 503 "No available compatible accounts", 429 "Concurrency
// limit exceeded for account", and 502 "Upstream request failed" when an
// upstream account cut a call at ~130 s. xy2api answered every one with its
// own request id, so none was billed (errors.ts mapGatewayError), and the
// same request a minute later usually lands on a free account.
//
// Only definite "not charged" failures qualify. Anything 待核对 (a cut in
// between, a 2xx without an image, a task that failed after generating) is
// never sent again: it may have been billed.

/** Codes sent again; all are "xy2api answered, nothing charged". */
const RETRY_CODES = new Set<GatewayFailure["code"]>([
  "upstream_busy",
  "rate_limited",
  "xy2api_unavailable",
]);

/** Waits before the 2nd, 3rd, … send, in seconds (jitter is added). */
const BASE_DELAYS = [20, 60, 120, 180, 240];

/** A job older than this is not sent again; the user has likely moved on. */
export const AUTO_RETRY_MAX_AGE_MS = 20 * 60 * 1000;

export const AUTO_RETRY_CODE = "upstream_retrying";

export type AutoRetryDecision = {
  /** Seconds until the message comes back to a worker. */
  delaySeconds: number;
  /** The send this retry will be (2 = first retry). */
  nextSend: number;
  /** What the job shows meanwhile. */
  message: string;
  /** A wait for the main site's task limit, not a failed send. */
  throttled?: boolean;
};

/**
 * Whether a failed send is retried, and when. `sends` counts the sends so
 * far, this one included (the job's attempt_count after incrementAttempt).
 */
export function autoRetryDecision(input: {
  failure: Pick<GatewayFailure, "code" | "billing" | "retryable" | "throttleSeconds">;
  sends: number;
  maxRetries: number;
  createdAt: string;
  now?: number;
  random?: () => number;
}): AutoRetryDecision | undefined {
  const { failure, sends, maxRetries } = input;
  if (maxRetries <= 0) return undefined;
  if (failure.billing !== "not_charged" || !failure.retryable) return undefined;
  if (!RETRY_CODES.has(failure.code)) return undefined;
  const age = (input.now ?? Date.now()) - Date.parse(input.createdAt);
  if (!Number.isFinite(age) || age > AUTO_RETRY_MAX_AGE_MS) return undefined;
  // The main site's task limit for the key (async too_many_tasks): nothing
  // was created, so it is a wait, not a send; only the age limit applies.
  if (failure.throttleSeconds) {
    const delaySeconds = Math.round(
      failure.throttleSeconds * (1 + 0.5 * (input.random ?? Math.random)()),
    );
    return {
      delaySeconds,
      nextSend: sends,
      message: `主站正在处理的任务较多，约 ${delaySeconds} 秒后自动发送`,
      throttled: true,
    };
  }
  if (sends > maxRetries) return undefined;
  const base = BASE_DELAYS[Math.min(sends - 1, BASE_DELAYS.length - 1)] ?? 60;
  // Up to +50 %, so a burst of refused jobs does not come back all at once.
  const delaySeconds = Math.round(base * (1 + 0.5 * (input.random ?? Math.random)()));
  return {
    delaySeconds,
    nextSend: sends + 1,
    message: `主站繁忙，约 ${delaySeconds} 秒后自动重试（第 ${sends + 1} 次）`,
  };
}
