// xy2api compatibility guard rails.
//
// xy2api ships releases every few days. Everything that knows xy2api wire
// formats lives in client.ts / errors.ts / the xy2api-* image providers; this
// module gives those adapters three shared tools:
//   1. VERIFIED versions: the releases whose recorded fixtures
//      (__fixtures__/<version>) pass the replay suite. Running against any other
//      version is allowed but logged, so an unannounced upgrade of the main site
//      is visible in our logs before users report breakage.
//   2. Drift reporting: tolerant readers call reportWireDrift() whenever they
//      had to default/skip something, instead of failing the whole request.
//   3. Version probe: reads settings.version at startup and every 30 minutes.
//
// Upgrade procedure (record fixtures, replay, bump the list below):
// docs/XY2API_COMPAT.md.

import type { Xy2apiClient } from "./client.js";

// Keep in sync with __fixtures__/<version> (enforced by contract.replay.test.ts).
// 0.2.2 = the release the adapters were first written against (commit 9717116f1);
// 0.2.5 = latest release when the compat layer landed. Exact versions only:
// pre-releases (0.2.6-rc1) must be recorded and added explicitly.
export const XY2API_VERIFIED_VERSIONS = ["0.2.2", "0.2.5"] as const;

const PROBE_INTERVAL_MS = 30 * 60 * 1000;
const DRIFT_LOG_INTERVAL_MS = 10 * 60 * 1000;

export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .replace(/^v/i, "")
      .split(/[.+-]/)
      .slice(0, 3)
      .map((part) => Number.parseInt(part, 10) || 0);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff) return Math.sign(diff);
  }
  return 0;
}

export type CompatStatus = {
  version: string | null;
  verified: boolean;
  /** newer than every verified version: most likely to carry wire changes */
  ahead: boolean;
  checkedAt: string;
};

export function classifyVersion(version: string | null | undefined) {
  const v =
    typeof version === "string" && version.trim() ? version.trim() : null;
  const normalized = v?.replace(/^v/i, "") ?? null;
  const verified = normalized
    ? (XY2API_VERIFIED_VERSIONS as readonly string[]).includes(normalized)
    : false;
  const newest =
    [...XY2API_VERIFIED_VERSIONS].sort(compareVersions).at(-1) ?? "0";
  return {
    version: normalized,
    verified,
    ahead: normalized ? compareVersions(normalized, newest) > 0 : false,
  };
}

const driftSeen = new Map<string, { last: number; count: number }>();

/**
 * Called by tolerant readers when xy2api sent something we had to repair
 * (missing optional field, unknown shape, skipped list item). Logs at most
 * once per scope+detail every 10 minutes, with a running count.
 */
export function reportWireDrift(scope: string, detail: string): void {
  const key = `${scope}:${detail}`;
  const now = Date.now();
  const seen = driftSeen.get(key) ?? { last: 0, count: 0 };
  seen.count += 1;
  if (now - seen.last >= DRIFT_LOG_INTERVAL_MS) {
    seen.last = now;
    console.warn(
      `[xy2api-compat] wire drift scope=${scope} detail=${detail} count=${seen.count} — record fixtures for the running xy2api version (docs/XY2API_COMPAT.md)`,
    );
  }
  driftSeen.set(key, seen);
}

export function wireDriftSnapshot(): Record<string, number> {
  return Object.fromEntries(
    [...driftSeen].map(([key, value]) => [key, value.count]),
  );
}

/** Masked keys ("sk-abc…wxyz", "sk-****") cannot be used to call the gateway. */
export function isMaskedKey(key: string): boolean {
  return /[*•…]|\.{3}/.test(key) || key.trim().length < 16;
}

export function createCompatProbe(client: Pick<Xy2apiClient, "getVersion">) {
  let status: CompatStatus | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function check(): Promise<CompatStatus> {
    let version: string | null = null;
    try {
      version = await client.getVersion();
    } catch {
      // Network trouble is reported by the request paths themselves.
    }
    const next: CompatStatus = {
      ...classifyVersion(version),
      checkedAt: new Date().toISOString(),
    };
    const changed = !status || status.version !== next.version;
    status = next;
    if (changed) {
      const fields = `version=${next.version ?? "unknown"} verified=${next.verified} verified_versions=${XY2API_VERIFIED_VERSIONS.join(",")}`;
      if (next.verified) console.info(`[xy2api-compat] main site ${fields}`);
      else
        console.warn(
          `[xy2api-compat] main site is running an unverified xy2api ${fields}${next.ahead ? " (newer than verified)" : ""} — run the contract job before relying on it`,
        );
    }
    return next;
  }

  return {
    check,
    status: () => status,
    start() {
      void check();
      timer ??= setInterval(() => void check(), PROBE_INTERVAL_MS);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}
