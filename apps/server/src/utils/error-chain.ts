/**
 * An error and its causes, outermost first.
 *
 * LangChain wraps a model error once for every middleware that has a
 * `wrapModelCall` hook (MiddlewareError, cause = the inner error), so the
 * chain grows with the agent's middleware stack. The walks used to stop
 * after 8 levels. Adding one more middleware (PR #45, 2026-10-11) pushed the
 * main site's GatewayError to level 9, and a moderation refusal showed as
 * the generic 「请求处理失败」 (caught by the lab regression 06-chat).
 *
 * Stops at a cycle or after 64 levels.
 */
export function* causeChain(error: unknown): Generator<object> {
  const seen = new Set<object>();
  let current = error;
  while (
    current &&
    typeof current === "object" &&
    !seen.has(current) &&
    seen.size < 64
  ) {
    seen.add(current);
    yield current;
    current = "cause" in current ? current.cause : undefined;
  }
}

/** The first error in the chain that matches. */
export function findCause<T extends object>(
  error: unknown,
  match: (candidate: object) => candidate is T,
): T | undefined {
  for (const candidate of causeChain(error))
    if (match(candidate)) return candidate;
  return undefined;
}
