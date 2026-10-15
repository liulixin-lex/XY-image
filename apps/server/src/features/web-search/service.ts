import { Agent, fetch as httpFetch } from "undici";

import type { ServerEnv } from "../../config/env.js";
import { describeErrorForLog } from "../../utils/error-sanitizer.js";
import {
  KEYLESS_PROVIDERS,
  SearchBlockedError,
  type SearchFetch,
  type SearchProvider,
  type SearchResult,
  anysearchProvider,
  braveProvider,
  searxngProvider,
  tavilyProvider,
} from "./providers.js";

/**
 * The free web search behind the assistant's search_web tool (第 68 条),
 * used when the chat model has no built-in search the main site can run
 * (agent/tools/web-search.ts). Sources are tried in order until one gives
 * results:
 * - a source that refuses us (challenge page, 403/429, bad key) rests for
 *   BLOCK_REST_MS, one that fails otherwise (timeout, network) for
 *   ERROR_REST_MS, so a blocked source costs nothing on the next search;
 * - answers are kept for CACHE_TTL_MS (the same question in one run, or a
 *   retry, does not search twice);
 * - logs never carry the query, only its length: `[web-search] …`.
 */

export const CACHE_TTL_MS = 15 * 60 * 1000;
export const BLOCK_REST_MS = 15 * 60 * 1000;
export const ERROR_REST_MS = 2 * 60 * 1000;
/** 第 70 条: rests by why a keyed source refused (providers.ts SearchRefusal). */
export const RATE_REST_MS = 60 * 1000;
export const QUOTA_REST_MS = 60 * 60 * 1000;
export const QUOTA_REST_MAX_MS = 6 * 60 * 60 * 1000;
export const AUTH_REST_MS = 6 * 60 * 60 * 1000;
const ATTEMPT_TIMEOUT_MS = 12_000;
const EXTRACT_TIMEOUT_MS = 20_000;
const CACHE_ENTRIES = 300;
const BODY_LIMIT = 3 * 1024 * 1024;

export type WebSearchOutcome = {
  /** The source that answered, or "none". */
  provider: string;
  results: SearchResult[];
  cached: boolean;
  /** Sources tried before it, with why they gave nothing. */
  skipped: string[];
};

export type WebSearchService = {
  search(
    query: string,
    options?: { count?: number; signal?: AbortSignal },
  ): Promise<WebSearchOutcome>;
  providers: string[];
  /** Present when a source reads pages (AnySearch). */
  extract?(
    url: string,
    signal?: AbortSignal,
  ): Promise<{ title: string; text: string; provider: string }>;
  /** 第 70 条: each source's state, for the admin page. */
  status(): SourceStatus[];
};

/** One source as the admin page shows it (no keys, no queries). */
export type SourceStatus = {
  name: string;
  keyed: boolean;
  /** ok, resting after a refusal or failure, or its daily budget is used. */
  state: "ok" | "resting" | "budget";
  restUntil?: string;
  today?: { used: number; budget: number };
  lastRefusal?: {
    kind: "rate" | "quota" | "auth" | "blocked" | "error";
    reason: string;
    at: string;
  };
  lastOkAt?: string;
};

type SourceState = {
  restUntil: number;
  /** Quota refusals in a row (each doubles the rest). */
  quotaHits: number;
  /** UTC day the count is for, and requests sent that day. */
  day: string;
  used: number;
  lastRefusal?: {
    kind: NonNullable<SourceStatus["lastRefusal"]>["kind"];
    reason: string;
    at: number;
  };
  lastOkAt?: number;
};

const dispatcher = new Agent({
  connect: { timeout: 8_000 },
  headersTimeout: ATTEMPT_TIMEOUT_MS,
  bodyTimeout: ATTEMPT_TIMEOUT_MS,
  connections: 8,
});

/** Fixed, well-known hosts (and the operator's SearXNG): plain fetch. */
export const defaultSearchFetch: SearchFetch = async (url, init = {}) => {
  const res = await httpFetch(url, {
    method: init.method ?? "GET",
    ...(init.headers ? { headers: init.headers } : {}),
    ...(init.body !== undefined ? { body: init.body } : {}),
    ...(init.signal ? { signal: init.signal } : {}),
    dispatcher,
    redirect: "follow",
  });
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > BODY_LIMIT) break; // a results page never gets here
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
  return { status: res.status, text: Buffer.concat(chunks).toString("utf8") };
};

function normalizeQuery(query: string) {
  return query.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function dedupe(results: SearchResult[], count: number): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const r of results) {
    const key = r.url.replace(/^https?:\/\/(www\.)?/, "").replace(/[#/]+$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title: r.title.slice(0, 200),
      url: r.url.slice(0, 500),
      snippet: r.snippet.slice(0, 400),
    });
    if (out.length >= count) break;
  }
  return out;
}

export function createWebSearchService(options: {
  providers: readonly SearchProvider[];
  fetch?: SearchFetch;
  now?: () => number;
}): WebSearchService {
  const fetch = options.fetch ?? defaultSearchFetch;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { at: number; value: WebSearchOutcome }>();
  const states = new Map<string, SourceState>(
    options.providers.map((p) => [
      p.name,
      { restUntil: 0, quotaHits: 0, day: "", used: 0 },
    ]),
  );
  const state = (name: string) => states.get(name) as SourceState;
  const today = () => new Date(now()).toISOString().slice(0, 10);

  /** Why a source cannot be asked now, or null when it can. */
  function unavailable(provider: SearchProvider): string | null {
    const s = state(provider.name);
    if (s.restUntil > now()) return "resting";
    if (provider.dailyBudget !== undefined) {
      if (s.day !== today()) {
        s.day = today();
        s.used = 0;
      }
      if (s.used >= provider.dailyBudget)
        return `daily budget used (${s.used}/${provider.dailyBudget})`;
    }
    return null;
  }

  function counted(provider: SearchProvider) {
    if (provider.dailyBudget === undefined) return;
    const s = state(provider.name);
    s.used++;
    if (s.used === provider.dailyBudget)
      console.warn(
        `[web-search] ${provider.name} used its daily budget (${provider.dailyBudget}); the other sources answer until 00:00 UTC`,
      );
  }

  function succeeded(provider: SearchProvider) {
    const s = state(provider.name);
    s.quotaHits = 0;
    s.lastOkAt = now();
  }

  /** Rests a source after a refusal or failure; returns the log text. */
  function rest(provider: SearchProvider, error: unknown): string {
    const s = state(provider.name);
    let ms = ERROR_REST_MS;
    let why = describeErrorForLog(error);
    let kind: NonNullable<SourceStatus["lastRefusal"]>["kind"] = "error";
    if (error instanceof SearchBlockedError) {
      why = error.reason;
      kind = error.kind;
      if (error.kind === "quota") {
        // Used up: an hour, then two, … up to QUOTA_REST_MAX_MS, so a plan
        // that resets at an unknown hour is tried a few times a day only.
        ms = Math.min(QUOTA_REST_MAX_MS, QUOTA_REST_MS * 2 ** s.quotaHits);
        s.quotaHits++;
      } else if (error.kind === "auth") ms = AUTH_REST_MS;
      else if (error.kind === "rate") ms = error.restMs ?? RATE_REST_MS;
      else ms = error.restMs ?? BLOCK_REST_MS;
    }
    s.restUntil = now() + ms;
    s.lastRefusal = { kind, reason: why.slice(0, 160), at: now() };
    const log = `[web-search] ${provider.name} ${kind === "error" ? "failed" : `refused us (${kind})`}: ${why}; resting ${ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1000)} s`}`;
    if (kind === "auth" || kind === "quota") console.error(log);
    else console.warn(log);
    return why;
  }

  async function search(
    query: string,
    { count = 6, signal }: { count?: number; signal?: AbortSignal } = {},
  ): Promise<WebSearchOutcome> {
    const wanted = Math.max(1, Math.min(10, Math.round(count)));
    const key = `${wanted}:${normalizeQuery(query)}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < CACHE_TTL_MS) {
      console.info(
        `[web-search] q(len=${query.length}) → ${hit.value.provider} ${hit.value.results.length} result(s), cached`,
      );
      return { ...hit.value, cached: true };
    }
    const skipped: string[] = [];
    const started = now();
    for (const provider of options.providers) {
      const why = unavailable(provider);
      if (why) {
        skipped.push(`${provider.name}: ${why}`);
        continue;
      }
      if (signal?.aborted) break;
      const attempt = AbortSignal.timeout(ATTEMPT_TIMEOUT_MS);
      counted(provider);
      try {
        const results = dedupe(
          await provider.search({
            query,
            count: wanted,
            fetch,
            signal: signal ? AbortSignal.any([signal, attempt]) : attempt,
          }),
          wanted,
        );
        succeeded(provider);
        if (!results.length) {
          skipped.push(`${provider.name}: no results`);
          continue;
        }
        const value: WebSearchOutcome = {
          provider: provider.name,
          results,
          cached: false,
          skipped,
        };
        if (cache.size >= CACHE_ENTRIES) {
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }
        cache.set(key, { at: now(), value });
        console.info(
          `[web-search] q(len=${query.length}) → ${provider.name} ${results.length} result(s) in ${now() - started}ms${skipped.length ? ` (${skipped.join("; ")})` : ""}`,
        );
        return value;
      } catch (error) {
        if (signal?.aborted) throw error;
        skipped.push(`${provider.name}: ${rest(provider, error)}`);
      }
    }
    console.warn(
      `[web-search] q(len=${query.length}) → no results from any source in ${now() - started}ms (${skipped.join("; ") || "no sources"})`,
    );
    return { provider: "none", results: [], cached: false, skipped };
  }

  const extractors = options.providers.filter((p) => p.extract);

  /**
   * 第 70 条: a page through a page-reading source (AnySearch extract), with
   * the same rests and daily budget as its searches. Throws when none can.
   */
  async function extract(
    url: string,
    signal?: AbortSignal,
  ): Promise<{ title: string; text: string; provider: string }> {
    const skipped: string[] = [];
    for (const provider of extractors) {
      const why = unavailable(provider);
      if (why) {
        skipped.push(`${provider.name}: ${why}`);
        continue;
      }
      counted(provider);
      const attempt = AbortSignal.timeout(EXTRACT_TIMEOUT_MS);
      try {
        const page = await (
          provider.extract as NonNullable<SearchProvider["extract"]>
        )({
          url,
          fetch,
          signal: signal ? AbortSignal.any([signal, attempt]) : attempt,
        });
        succeeded(provider);
        return { ...page, provider: provider.name };
      } catch (error) {
        if (signal?.aborted) throw error;
        // A page the source cannot read is not the source's fault.
        if (error instanceof SearchBlockedError)
          skipped.push(`${provider.name}: ${rest(provider, error)}`);
        else skipped.push(`${provider.name}: ${describeErrorForLog(error)}`);
      }
    }
    throw new Error(
      `no page-reading source could read it (${skipped.join("; ") || "none configured"})`,
    );
  }

  function status(): SourceStatus[] {
    return options.providers.map((p) => {
      const s = state(p.name);
      const why = unavailable(p);
      return {
        name: p.name,
        keyed: p.keyed,
        state: !why ? "ok" : why === "resting" ? "resting" : "budget",
        ...(s.restUntil > now()
          ? { restUntil: new Date(s.restUntil).toISOString() }
          : {}),
        ...(p.dailyBudget !== undefined
          ? {
              today: {
                used: s.day === today() ? s.used : 0,
                budget: p.dailyBudget,
              },
            }
          : {}),
        ...(s.lastRefusal
          ? {
              lastRefusal: {
                ...s.lastRefusal,
                at: new Date(s.lastRefusal.at).toISOString(),
              },
            }
          : {}),
        ...(s.lastOkAt ? { lastOkAt: new Date(s.lastOkAt).toISOString() } : {}),
      };
    });
  }

  return {
    search,
    providers: options.providers.map((p) => p.name),
    ...(extractors.length ? { extract } : {}),
    status,
  };
}

export function webSearchProviders(
  env: Pick<
    ServerEnv,
    | "webSearchTavilyKey"
    | "webSearchBraveKey"
    | "webSearchSearxngUrl"
    | "webSearchKeyless"
    | "webSearchAnysearchKey"
    | "webSearchAnysearchDaily"
  >,
): SearchProvider[] {
  return [
    ...(env.webSearchSearxngUrl
      ? [searxngProvider(env.webSearchSearxngUrl)]
      : []),
    // 第 69 条: production's search (an agent-oriented API, good Chinese).
    ...(env.webSearchAnysearchKey
      ? [
          anysearchProvider(
            env.webSearchAnysearchKey,
            undefined,
            env.webSearchAnysearchDaily,
          ),
        ]
      : []),
    ...(env.webSearchTavilyKey ? [tavilyProvider(env.webSearchTavilyKey)] : []),
    ...(env.webSearchBraveKey ? [braveProvider(env.webSearchBraveKey)] : []),
    ...(env.webSearchKeyless === "off" ? [] : KEYLESS_PROVIDERS),
  ];
}

let shared: { config: string; service: WebSearchService } | undefined;

/** One service per process, so the cache and the rests are shared by runs. */
export function sharedWebSearchService(
  env: Parameters<typeof webSearchProviders>[0],
): WebSearchService {
  const config = JSON.stringify([
    env.webSearchSearxngUrl ?? "",
    Boolean(env.webSearchAnysearchKey),
    env.webSearchAnysearchDaily ?? 0,
    Boolean(env.webSearchTavilyKey),
    Boolean(env.webSearchBraveKey),
    env.webSearchKeyless ?? "on",
  ]);
  if (shared?.config !== config) {
    shared = {
      config,
      service: createWebSearchService({ providers: webSearchProviders(env) }),
    };
    console.info(
      `[web-search] sources: ${shared.service.providers.join(" → ") || "none"}`,
    );
  }
  return shared.service;
}
