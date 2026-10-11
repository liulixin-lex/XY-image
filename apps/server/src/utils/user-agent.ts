import { readFileSync } from "node:fs";

/**
 * User-Agent of every call this site makes to the main site (xy2api API,
 * gateway and chat). xy2api records it in usage_logs.user_agent, so main-site
 * operators can tell this site's traffic apart, and the 待核对 reconciler
 * (billing-reconciler.ts) only matches usage rows that carry it.
 */
export const XY2API_USER_AGENT_PREFIX = "GGUU-AI-Image/";

function serverVersion(): string {
  try {
    // src/utils → apps/server/package.json; the image runs from source (tsx).
    const pkg = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "0";
  } catch {
    return "0";
  }
}

export const XY2API_USER_AGENT = `${XY2API_USER_AGENT_PREFIX}${serverVersion()}`;

/** Agents this site has sent; LoomicServer/1.0 before 0.0.5. */
export function isOwnUserAgent(value: string): boolean {
  return (
    value.startsWith(XY2API_USER_AGENT_PREFIX) ||
    value.startsWith("LoomicServer/")
  );
}
