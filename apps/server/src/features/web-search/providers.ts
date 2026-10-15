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
 * LOOMIC_WEB_SEARCH_ANYSEARCH_KEY (production since 第 69 条) or
 * _TAVILY_KEY / _BRAVE_KEY / _SEARXNG_URL for a search that does not depend
 * on any of that (docs/XY_IMAGE_AGENT_CHAT.md).
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
  /**
   * 第 70 条: requests a day this source may take (a plan quota, e.g.
   * AnySearch's free plan); the service stops using it for the rest of the
   * UTC day once that many went out, and counts extract calls too.
   */
  dailyBudget?: number;
  /** Reads one page through the source (AnySearch extract). */
  extract?(request: {
    url: string;
    fetch: SearchFetch;
    signal?: AbortSignal;
  }): Promise<{ title: string; text: string }>;
};

/**
 * Why a source refused us (第 70 条), which decides how long it rests:
 * - "rate": too many requests just now (a "retry after N seconds" is kept);
 * - "quota": the plan's requests are used up (rests for hours, see
 *   service.ts), e.g. AnySearch's 1000 a day;
 * - "auth": the key is wrong or revoked (an operator has to fix it);
 * - "blocked": a challenge page or a refusal without a reason.
 */
export type SearchRefusal = "rate" | "quota" | "auth" | "blocked";

/** The source refused us (challenge page, rate limit, bad key). */
export class SearchBlockedError extends Error {
  constructor(
    readonly provider: string,
    readonly reason: string,
    readonly kind: SearchRefusal = "blocked",
    /** How long the source asked us to wait, when it said. */
    readonly restMs?: number,
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

/**
 * AnySearch (anysearch.com, 第 69 条): search built for agents, a key from
 * LOOMIC_WEB_SEARCH_ANYSEARCH_KEY (free plan: 1,000 requests a day). One
 * `POST /v1/search` per query; Chinese queries ask for the China zone and
 * Chinese results (measured from the production box 2026-10-15: relevant
 * Chinese design sources, 1.5–5 s). Errors come back as an envelope with a
 * non-zero `code` (HTTP 200 included); a rate limit says "Rate limited".
 */
export const ANYSEARCH_BASE_URL = "https://api.anysearch.com";

/**
 * What an AnySearch refusal means (第 70 条). Its docs only spell out
 * "Rate limited, retry after N seconds."; a used-up plan is recognised by
 * HTTP 402 or the usual quota words (English or Chinese).
 */
export function anysearchRefusal(
  status: number,
  message: string,
): { kind: SearchRefusal; restMs?: number } | null {
  const after = /retry after (\d+)\s*s/i.exec(message);
  if (after)
    return {
      kind: "rate",
      restMs: Math.min(3_600_000, Math.max(30_000, Number(after[1]) * 1000)),
    };
  if (
    status === 402 ||
    /quota|credit|exceed|insufficient|balance|daily limit|limit reached|usage limit|额度|余额|次数|用完|超出/i.test(
      message,
    )
  )
    return { kind: "quota" };
  if (
    status === 401 ||
    status === 403 ||
    /unauthor|invalid (api )?key|forbidden|api key/i.test(message)
  )
    return { kind: "auth" };
  if (status === 429 || /rate limit|too many/i.test(message))
    return { kind: "rate" };
  return null;
}

function anysearchEnvelope(res: { status: number; text: string }): Record<
  string,
  unknown
> {
  let body: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(res.text);
    if (parsed && typeof parsed === "object")
      body = parsed as Record<string, unknown>;
  } catch {
    body = null;
  }
  const message =
    typeof body?.message === "string" ? body.message.slice(0, 120) : "";
  if (
    res.status >= 400 ||
    !body ||
    (body.code !== undefined && body.code !== 0)
  ) {
    const refusal = anysearchRefusal(res.status, message);
    if (refusal)
      throw new SearchBlockedError(
        "anysearch",
        `HTTP ${res.status}${message ? ` ${message}` : ""}`,
        refusal.kind,
        refusal.restMs,
      );
    throw new Error(
      `anysearch answered HTTP ${res.status}${message ? `: ${message}` : ""}`,
    );
  }
  return (body.data as Record<string, unknown> | undefined) ?? {};
}

/** Windows-1252 characters for bytes 0x80–0x9F (the rest map to themselves). */
const CP1252_BYTES = new Map<number, number>(
  [
    0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
    0x0160, 0x2039, 0x0152, 0, 0x017d, 0, 0, 0x2018, 0x2019, 0x201c, 0x201d,
    0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0, 0x017e,
    0x0178,
  ].flatMap((code, i) => (code ? [[code, 0x80 + i] as [number, number]] : [])),
);
/** A UTF-8 lead byte read as Windows-1252, followed by a continuation byte. */
const MOJIBAKE =
  /[\u00c2-\u00f4][\u0080-\u00bf\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2013-\u2122\ufffd]/g;
const REPLACEMENT = /\ufffd/g;
const utf8 = new TextDecoder("utf-8");
const utf8Bytes = new TextEncoder();
/** One lost byte breaks a whole character into two or three of these. */
const REPLACEMENT_RUN = new RegExp(`${REPLACEMENT.source}+`, "g");

/**
 * AnySearch reads pages that declare no charset as Windows-1252, so UTF-8
 * text comes back garbled: "â€”" for "—", "ä¸­æ–‡" for "中文" (第 69 条,
 * seen on nodejs.org 2026-10-15; pages with a <meta charset> are fine). Put
 * the bytes back and read them as UTF-8. Bytes Windows-1252 leaves undefined
 * (0x81, 0x8D, 0x8F, 0x90, 0x9D) arrive as U+FFFD and stay lost, so a few
 * characters become "�". Text without the pattern, or that would come out
 * worse, is returned as it was (correct Latin-1 text like "café" included).
 */
export function repairMojibake(text: string): string {
  const signs = text.match(MOJIBAKE)?.length ?? 0;
  if (signs === 0) return text;
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const byte = code < 0x100 ? code : CP1252_BYTES.get(code);
    if (byte !== undefined) bytes.push(byte);
    else bytes.push(...utf8Bytes.encode(char));
  }
  const repaired = utf8
    .decode(Uint8Array.from(bytes))
    .replace(REPLACEMENT_RUN, String.fromCharCode(0xfffd));
  const lost =
    (repaired.match(REPLACEMENT)?.length ?? 0) -
    (text.match(REPLACEMENT)?.length ?? 0);
  const left = repaired.match(MOJIBAKE)?.length ?? 0;
  return left < signs && lost <= signs / 2 ? repaired : text;
}

export function parseAnysearch(text: string): SearchResult[] {
  const data = anysearchEnvelope({ status: 200, text });
  return list(data.results).flatMap((item) => {
    const url = httpUrl(item.url);
    const title =
      typeof item.title === "string"
        ? stripTags(repairMojibake(item.title))
        : "";
    if (!url || !title) return [];
    // `content` is the longer, query-focused excerpt; `snippet` the short one.
    const body =
      typeof item.content === "string" && item.content.trim()
        ? item.content
        : typeof item.snippet === "string"
          ? item.snippet
          : "";
    return [{ title, url, snippet: stripTags(repairMojibake(body)) }];
  });
}

/** AnySearch's free plan: 1000 requests a day (第 69 条). */
export const ANYSEARCH_DAILY_DEFAULT = 1000;

export function anysearchProvider(
  apiKey: string,
  baseUrl = ANYSEARCH_BASE_URL,
  dailyBudget = ANYSEARCH_DAILY_DEFAULT,
): SearchProvider {
  return {
    name: "anysearch",
    keyed: true,
    dailyBudget,
    extract: ({ url, fetch, signal }) =>
      anysearchExtract(apiKey, url, fetch, signal, baseUrl),
    async search({ query, count, fetch, signal }) {
      const chinese = CJK.test(query);
      const res = await fetch(`${baseUrl}/v1/search`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          "x-anysearch-client": "gguu-image-server/1.0",
        },
        body: JSON.stringify({
          query,
          max_results: Math.max(1, Math.min(10, count)),
          ...(chinese ? { zone: "cn", language: "zh-CN" } : {}),
        }),
        ...(signal ? { signal } : {}),
      });
      anysearchEnvelope(res);
      return parseAnysearch(res.text);
    },
  };
}

/**
 * A page's text through AnySearch's `/v1/extract` (Markdown), for pages that
 * refuse a direct read from our address (zhihu answered 403 on 2026-10-14).
 * The page is fetched by AnySearch, not by this server.
 */
export async function anysearchExtract(
  apiKey: string,
  url: string,
  fetch: SearchFetch,
  signal?: AbortSignal,
  baseUrl = ANYSEARCH_BASE_URL,
): Promise<{ title: string; text: string }> {
  const res = await fetch(`${baseUrl}/v1/extract`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "x-anysearch-client": "gguu-image-server/1.0",
    },
    body: JSON.stringify({ url }),
    ...(signal ? { signal } : {}),
  });
  const data = anysearchEnvelope(res);
  const raw = typeof data.content === "string" ? data.content.trim() : "";
  const text = repairMojibake(raw);
  const title =
    typeof data.title === "string" ? stripTags(repairMojibake(data.title)) : "";
  if (text !== raw)
    console.info(
      `[web-search] anysearch extract: repaired mis-decoded text (${text.length} chars)`,
    );
  return { title, text };
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
