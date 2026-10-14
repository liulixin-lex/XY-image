import { Agent, fetch as httpFetch } from "undici";

import type { ServerEnv } from "../../config/env.js";
import { describeErrorForLog } from "../../utils/error-sanitizer.js";
import {
  KEYLESS_PROVIDERS,
  SearchBlockedError,
  type SearchFetch,
  type SearchProvider,
  type SearchResult,
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
const ATTEMPT_TIMEOUT_MS = 12_000;
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
  const restUntil = new Map<string, number>();

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
      const until = restUntil.get(provider.name) ?? 0;
      if (until > now()) {
        skipped.push(`${provider.name}: resting`);
        continue;
      }
      if (signal?.aborted) break;
      const attempt = AbortSignal.timeout(ATTEMPT_TIMEOUT_MS);
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
        const blocked = error instanceof SearchBlockedError;
        restUntil.set(
          provider.name,
          now() + (blocked ? BLOCK_REST_MS : ERROR_REST_MS),
        );
        const why = blocked ? error.reason : describeErrorForLog(error);
        skipped.push(`${provider.name}: ${why}`);
        console.warn(
          `[web-search] ${provider.name} ${blocked ? "refused us" : "failed"} (${why}); resting ${Math.round((blocked ? BLOCK_REST_MS : ERROR_REST_MS) / 60000)} min`,
        );
      }
    }
    console.warn(
      `[web-search] q(len=${query.length}) → no results from any source in ${now() - started}ms (${skipped.join("; ") || "no sources"})`,
    );
    return { provider: "none", results: [], cached: false, skipped };
  }

  return { search, providers: options.providers.map((p) => p.name) };
}

export function webSearchProviders(
  env: Pick<
    ServerEnv,
    | "webSearchTavilyKey"
    | "webSearchBraveKey"
    | "webSearchSearxngUrl"
    | "webSearchKeyless"
  >,
): SearchProvider[] {
  return [
    ...(env.webSearchSearxngUrl
      ? [searxngProvider(env.webSearchSearxngUrl)]
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
