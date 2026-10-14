import { decodeEntities, stripTags } from "./html.js";

/**
 * Search sources for the free web search tool (第 68 条), tried in order by
 * service.ts. Keyed ones first when the operator configured them (they are
 * the dependable ones), then key-less pages.
 *
 * Key-less search from a datacenter address is best effort. Measured from
 * the production box on 2026-10-14:
 * - Yahoo! JAPAN (Google's index, server-rendered, direct links): results,
 *   good ones for Chinese queries too.
 * - DuckDuckGo html: results at first, then a "confirm you are human"
 *   challenge (HTTP 202) after a few dozen probes from any of our hosts.
 * - Wikipedia API: always (encyclopedic pages only).
 * - Bing (RSS and HTML): empty pages for this address; its RSS is also
 *   licensed for personal, non-commercial use only, so it is not used.
 * - Google, Baidu, Sogou, 360, Brave html, Startpage, Qwant, Ecosia,
 *   Mojeek: blocked or empty.
 * A source that blocks us rests for a while (service.ts); configure
 * LOOMIC_WEB_SEARCH_TAVILY_KEY / _BRAVE_KEY / _SEARXNG_URL for a search
 * that does not depend on any of that (docs/XY_IMAGE_AGENT_CHAT.md).
 */

export type SearchResult = { title: string; url: string; snippet: string };

export type SearchFetchInit = {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};
export type SearchFetch = (
  url: string,
  init?: SearchFetchInit,
) => Promise<{ status: number; text: string }>;

export type SearchRequest = {
  query: string;
  count: number;
  fetch: SearchFetch;
  signal?: AbortSignal;
};

export type SearchProvider = {
  name: string;
  /** Uses an API key or the operator's own instance. */
  keyed: boolean;
  search(request: SearchRequest): Promise<SearchResult[]>;
};

/** The source refused us (challenge page, rate limit, bad key). */
export class SearchBlockedError extends Error {
  constructor(
    readonly provider: string,
    readonly reason: string,
  ) {
    super(`${provider} refused the search (${reason})`);
    this.name = "SearchBlockedError";
  }
}

const BROWSER_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.7",
};

function refusedStatus(provider: string, status: number) {
  if ([202, 401, 402, 403, 418, 429, 432, 503].includes(status))
    throw new SearchBlockedError(provider, `HTTP ${status}`);
  if (status >= 400) throw new Error(`${provider} answered HTTP ${status}`);
}

function json(provider: string, text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object")
      return parsed as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new Error(`${provider} answered something that is not JSON`);
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (v): v is Record<string, unknown> =>
          Boolean(v) && typeof v === "object",
      )
    : [];
}

function fromApi(
  items: Record<string, unknown>[],
  title: string,
  url: string,
  snippet: string,
): SearchResult[] {
  return items.flatMap((item) => {
    const href = httpUrl(item[url]);
    const name =
      typeof item[title] === "string" ? stripTags(item[title] as string) : "";
    if (!href || !name) return [];
    return [
      {
        title: name,
        url: href,
        snippet:
          typeof item[snippet] === "string"
            ? stripTags(item[snippet] as string)
            : "",
      },
    ];
  });
}

// --- keyed ---------------------------------------------------------------

export function tavilyProvider(apiKey: string): SearchProvider {
  return {
    name: "tavily",
    keyed: true,
    async search({ query, count, fetch, signal }) {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query,
          max_results: count,
          search_depth: "basic",
          include_answer: false,
        }),
        ...(signal ? { signal } : {}),
      });
      refusedStatus("tavily", res.status);
      return fromApi(
        list(json("tavily", res.text).results),
        "title",
        "url",
        "content",
      );
    },
  };
}

export function braveProvider(apiKey: string): SearchProvider {
  return {
    name: "brave",
    keyed: true,
    async search({ query, count, fetch, signal }) {
      const res = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`,
        {
          headers: {
            accept: "application/json",
            "x-subscription-token": apiKey,
          },
          ...(signal ? { signal } : {}),
        },
      );
      refusedStatus("brave", res.status);
      const web = json("brave", res.text).web as
        | Record<string, unknown>
        | undefined;
      return fromApi(list(web?.results), "title", "url", "description");
    },
  };
}

/** A SearXNG instance with the JSON format enabled (settings.yml formats). */
export function searxngProvider(baseUrl: string): SearchProvider {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    name: "searxng",
    keyed: true,
    async search({ query, fetch, signal }) {
      const res = await fetch(
        `${base}/search?q=${encodeURIComponent(query)}&format=json&safesearch=1`,
        {
          headers: { accept: "application/json" },
          ...(signal ? { signal } : {}),
        },
      );
      refusedStatus("searxng", res.status);
      return fromApi(
        list(json("searxng", res.text).results),
        "title",
        "url",
        "content",
      );
    },
  };
}

// --- key-less ------------------------------------------------------------

export function parseYahooJapan(html: string): SearchResult[] {
  const out: SearchResult[] = [];
  // Cards are `sw-Card Algo`, sometimes with more classes (seen on
  // 2026-10-14: "sw-Card Algo Algo-anotherSuggest Algo--visualWebImageGallery").
  for (const card of html.split(/class="sw-Card Algo(?:\s[^"]*)?"/).slice(1)) {
    const href =
      /<a href="(https?:\/\/[^"]+)"[^>]*class="sw-Card__titleInner"/.exec(
        card,
      )?.[1];
    const title = /<h3 class="sw-Card__titleMain[^"]*">([\s\S]*?)<\/h3>/.exec(
      card,
    )?.[1];
    const snippet = /<p class="sw-Card__summary">([\s\S]*?)<\/p>/.exec(
      card,
    )?.[1];
    const url = href ? httpUrl(decodeEntities(href)) : null;
    if (!url || !title) continue;
    out.push({
      title: stripTags(title),
      url,
      snippet: stripTags(snippet ?? ""),
    });
  }
  return out;
}

export const yahooJapanProvider: SearchProvider = {
  name: "yahoo-jp",
  keyed: false,
  async search({ query, fetch, signal }) {
    const res = await fetch(
      `https://search.yahoo.co.jp/search?p=${encodeURIComponent(query)}&ei=UTF-8`,
      { headers: BROWSER_HEADERS, ...(signal ? { signal } : {}) },
    );
    refusedStatus("yahoo-jp", res.status);
    return parseYahooJapan(res.text);
  },
};

function duckDuckGoTarget(href: string): string | null {
  const full = href.startsWith("//") ? `https:${href}` : href;
  try {
    const url = new URL(full);
    if (url.hostname.endsWith("duckduckgo.com"))
      return httpUrl(url.searchParams.get("uddg")); // y.js ad links have none
    return httpUrl(url.href);
  } catch {
    return null;
  }
}

export function parseDuckDuckGo(html: string): SearchResult[] {
  if (/anomaly-modal|id="challenge-form"|anomaly\.js/.test(html))
    throw new SearchBlockedError("duckduckgo", "challenge page");
  const out: SearchResult[] = [];
  for (const block of html.split(/<div class="result results_links/).slice(1)) {
    if (/^[^>]*result--ad/.test(block)) continue;
    const anchor = /<a\b([^>]*class="result__a"[^>]*)>([\s\S]*?)<\/a>/.exec(
      block,
    );
    const href = anchor?.[1]
      ? /href="([^"]+)"/.exec(anchor[1])?.[1]
      : undefined;
    const url = href ? duckDuckGoTarget(decodeEntities(href)) : null;
    if (!url || !anchor?.[2]) continue;
    const snippet =
      /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/.exec(
        block,
      )?.[1];
    out.push({
      title: stripTags(anchor[2]),
      url,
      snippet: stripTags(snippet ?? ""),
    });
  }
  return out;
}

export const duckDuckGoProvider: SearchProvider = {
  name: "duckduckgo",
  keyed: false,
  async search({ query, fetch, signal }) {
    const res = await fetch("https://html.duckduckgo.com/html/", {
      method: "POST",
      headers: {
        ...BROWSER_HEADERS,
        "content-type": "application/x-www-form-urlencoded",
        referer: "https://html.duckduckgo.com/",
      },
      body: `q=${encodeURIComponent(query)}&b=`,
      ...(signal ? { signal } : {}),
    });
    refusedStatus("duckduckgo", res.status);
    return parseDuckDuckGo(res.text);
  },
};

const CJK = /[぀-ヿ㐀-鿿豈-﫿]/;

export function parseWikipedia(text: string, lang: string): SearchResult[] {
  const query = json("wikipedia", text).query as
    | Record<string, unknown>
    | undefined;
  return list(query?.search).flatMap((item) => {
    const title = typeof item.title === "string" ? item.title : "";
    if (!title) return [];
    return [
      {
        title,
        url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
        snippet:
          typeof item.snippet === "string" ? stripTags(item.snippet) : "",
      },
    ];
  });
}

/** Encyclopedic pages only; the last resort, Chinese wiki for CJK queries. */
export const wikipediaProvider: SearchProvider = {
  name: "wikipedia",
  keyed: false,
  async search({ query, count, fetch, signal }) {
    const lang = CJK.test(query) ? "zh" : "en";
    const res = await fetch(
      `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&utf8=1&srlimit=${Math.min(count, 5)}&srsearch=${encodeURIComponent(query)}`,
      {
        headers: {
          "user-agent": "GGUUImageServer/1.0 (https://image.gguuai.com)",
          accept: "application/json",
        },
        ...(signal ? { signal } : {}),
      },
    );
    refusedStatus("wikipedia", res.status);
    return parseWikipedia(res.text, lang);
  },
};

export const KEYLESS_PROVIDERS: readonly SearchProvider[] = [
  yahooJapanProvider,
  duckDuckGoProvider,
  wikipediaProvider,
];
