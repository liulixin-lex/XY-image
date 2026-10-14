import { Agent, fetch as httpFetch } from "undici";

import { XY2API_USER_AGENT } from "../../utils/user-agent.js";

/**
 * Gemini's built-in Google Search, called on its own (第 68 条).
 *
 * The assistant always has function tools (canvas, images, files), and
 * measured through the main site on 2026-10-14 Gemini does not ground when
 * googleSearch sits next to function declarations (200, no grounding
 * chunks, answers from memory), nor reliably through Chat Completions. Alone
 * in a native generateContent call it searches and cites (grounding chunks,
 * current answers). So for a Gemini chat model the search_web tool sends
 * the query here: the same key and model, googleSearch the only tool, a
 * short sourced answer back. The main site bills it like any Gemini call.
 *
 * Google asks that grounded answers show their search suggestions; the chat
 * shows the queries Gemini ran (linked to Google Search) and the sources in
 * the 联网搜索 block (apps/web chat/utils.ts).
 */

const TIMEOUT_MS = 90_000;

export type GroundedSearch = {
  answer: string;
  /** The searches Gemini ran. */
  queries: string[];
  sources: Array<{ title: string; url: string }>;
  grounded: boolean;
};

const dispatcher = new Agent({
  connect: { timeout: 30_000 },
  headersTimeout: TIMEOUT_MS,
  bodyTimeout: TIMEOUT_MS,
});

export class GroundedSearchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GroundedSearchError";
  }
}

/** Gemini 3 and later take thinkingLevel; older ones would refuse it. */
function thinkingConfig(model: string) {
  const major = Number(/gemini-(\d+)/i.exec(model)?.[1] ?? 0);
  return major >= 3 ? { thinkingConfig: { thinkingLevel: "low" } } : undefined;
}

export function groundedSearchPrompt(query: string) {
  return `用 Google 搜索查下面的问题，再根据搜到的内容回答。
问题：${query}
要求：只写搜索结果里有的事实，保留具体的名称、数字、日期；不同来源说法不一时都列出来；不要编造；400 字以内；用问题的语言回答。`;
}

export function parseGroundedResponse(body: unknown): GroundedSearch {
  const candidate = (body as { candidates?: unknown[] } | undefined)
    ?.candidates?.[0] as
    | {
        content?: { parts?: Array<{ text?: unknown; thought?: unknown }> };
        groundingMetadata?: {
          webSearchQueries?: unknown[];
          groundingChunks?: Array<{ web?: { uri?: unknown; title?: unknown } }>;
        };
      }
    | undefined;
  const answer = (candidate?.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("")
    .trim();
  const meta = candidate?.groundingMetadata;
  const queries = (meta?.webSearchQueries ?? [])
    .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
    .slice(0, 8);
  const seen = new Set<string>();
  const sources = (meta?.groundingChunks ?? []).flatMap((chunk) => {
    const url = typeof chunk.web?.uri === "string" ? chunk.web.uri : "";
    if (!/^https?:\/\//.test(url) || seen.has(url)) return [];
    seen.add(url);
    const title = typeof chunk.web?.title === "string" ? chunk.web.title : "";
    return [
      {
        title: title.slice(0, 200) || new URL(url).host,
        url: url.slice(0, 1000),
      },
    ];
  });
  return {
    answer,
    queries,
    sources: sources.slice(0, 10),
    grounded: sources.length > 0,
  };
}

const REDIRECT_HOST = "vertexaisearch.cloud.google.com";

/**
 * Grounding sources come as Google redirect links (vertexaisearch…/
 * grounding-api-redirect/…, titled with the bare domain) that expire after
 * a while. The model wants a page it can cite and kept searching again for
 * one (4 searches for one question, measured 2026-10-14), and the chat
 * should show where the answer came from, so each link is resolved to the
 * page it points to: one request to Google's redirect host, redirects not
 * followed, 4 s, the original kept when that fails.
 */
export async function resolveGroundingLinks(
  sources: GroundedSearch["sources"],
  fetch: typeof httpFetch = httpFetch,
): Promise<GroundedSearch["sources"]> {
  return Promise.all(
    sources.map(async (source) => {
      try {
        if (new URL(source.url).host !== REDIRECT_HOST) return source;
        const res = await fetch(source.url, {
          method: "GET",
          redirect: "manual",
          signal: AbortSignal.timeout(4_000),
          dispatcher,
        });
        await res.body?.cancel().catch(() => {});
        const location = res.headers.get("location");
        const target = location ? new URL(location, source.url) : null;
        if (!target || !/^https?:$/.test(target.protocol)) return source;
        return { title: source.title, url: target.href.slice(0, 1000) };
      } catch {
        return source;
      }
    }),
  );
}

export async function geminiGroundedSearch(options: {
  baseUrl: string;
  apiKey: string;
  model: string;
  query: string;
  signal?: AbortSignal;
  fetch?: typeof httpFetch;
}): Promise<GroundedSearch> {
  const fetch = options.fetch ?? httpFetch;
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;
  const url = `${options.baseUrl.replace(/\/+$/, "")}/v1beta/models/${encodeURIComponent(options.model)}:generateContent`;
  const generationConfig = thinkingConfig(options.model);
  const started = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      "content-type": "application/json",
      "user-agent": XY2API_USER_AGENT,
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: groundedSearchPrompt(options.query) }],
        },
      ],
      tools: [{ googleSearch: {} }],
      ...(generationConfig ? { generationConfig } : {}),
    }),
    signal,
    dispatcher,
    redirect: "error",
  });
  const text = await res.text();
  if (!res.ok) {
    console.warn(
      `[web-search] gemini ${options.model} grounded search answered HTTP ${res.status} in ${Date.now() - started}ms`,
    );
    throw new GroundedSearchError(
      `Gemini search answered HTTP ${res.status}`,
      res.status,
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new GroundedSearchError(
      "Gemini search answered something that is not JSON",
    );
  }
  const parsed = parseGroundedResponse(body);
  const result = {
    ...parsed,
    sources: await resolveGroundingLinks(parsed.sources, fetch),
  };
  console.info(
    `[web-search] q(len=${options.query.length}) → gemini ${options.model} ${result.grounded ? `${result.sources.length} source(s), ${result.queries.length} search(es)` : "not grounded"} in ${Date.now() - started}ms`,
  );
  return result;
}
