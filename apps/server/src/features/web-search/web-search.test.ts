import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createWebTools } from "../../agent/tools/web-search.js";
import {
  geminiGroundedSearch,
  parseGroundedResponse,
  resolveGroundingLinks,
} from "./gemini-grounded.js";
import { htmlToText, stripTags } from "./html.js";
import {
  SearchBlockedError,
  type SearchProvider,
  parseDuckDuckGo,
  parseWikipedia,
  parseYahooJapan,
} from "./providers.js";
import { ReadPageError, checkPageUrl, readWebPage } from "./read-page.js";
import {
  BLOCK_REST_MS,
  CACHE_TTL_MS,
  createWebSearchService,
  webSearchProviders,
} from "./service.js";

const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");

afterEach(() => vi.restoreAllMocks());
const quiet = () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
};

describe("search result pages (第 68 条)", () => {
  it("reads Yahoo! JAPAN results (captured from the production box)", () => {
    const results = parseYahooJapan(fixture("yahoo-jp.html"));
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0]?.url).toBe(
      "https://www.gaoding.com/features/spring-festival-posters",
    );
    for (const r of results) {
      expect(r.url).toMatch(/^https:\/\//);
      expect(r.title).not.toMatch(/[<>]/);
      expect(r.title.length).toBeGreaterThan(2);
    }
    expect(results.some((r) => r.snippet.length > 10)).toBe(true);
  });

  it("reads Yahoo! JAPAN cards that carry more classes", () => {
    const html = `<div class="sw-CardBase"><div class="sw-Card Algo Algo-anotherSuggest Algo--visualWebImageGallery"><section><div class="sw-Card__title"><a href="https://zhuanlan.zhihu.com/p/2083513631803813970" class="sw-Card__titleInner"   data-a11y-main-content="1"><br/><h3 class="sw-Card__titleMain sw-Card__titleMain--siteName util-Clamps--2"><span><b>流行</b>色彩| <b>2027</b>春夏色彩分析--香瓜色 - 知乎专栏</span></h3></a></div><p class="sw-Card__summary">香瓜色是 <b>2027</b> 春夏的流行色。</p></section></div></div>`;
    expect(parseYahooJapan(html)).toEqual([
      {
        title: "流行色彩| 2027春夏色彩分析--香瓜色 - 知乎专栏",
        url: "https://zhuanlan.zhihu.com/p/2083513631803813970",
        snippet: "香瓜色是 2027 春夏的流行色。",
      },
    ]);
  });

  it("knows DuckDuckGo's challenge page for a refusal", () => {
    expect(() => parseDuckDuckGo(fixture("duckduckgo-challenge.html"))).toThrow(
      SearchBlockedError,
    );
  });

  it("reads DuckDuckGo results, skipping ads and unwrapping its redirect links", () => {
    const html = `
<div class="result results_links results_links_deep result--ad "><a class="result__a" href="https://duckduckgo.com/y.js?ad_domain=x.com">Ad</a></div>
<div class="result results_links results_links_deep web-result "><div class="links_main links_deep result__body">
<h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnodejs.org%2Fen%2Fabout%2Freleases&amp;rut=abc">Node.js &mdash; <b>Releases</b></a></h2>
<a class="result__snippet" href="//duckduckgo.com/l/?uddg=x">Major Node.js versions enter <b>LTS</b> &amp; stay there.</a></div></div>
<div class="result results_links results_links_deep web-result "><h2 class="result__title"><a rel="nofollow" href="https://example.com/direct" class="result__a">Direct</a></h2></div>`;
    expect(parseDuckDuckGo(html)).toEqual([
      {
        title: "Node.js — Releases",
        url: "https://nodejs.org/en/about/releases",
        snippet: "Major Node.js versions enter LTS & stay there.",
      },
      { title: "Direct", url: "https://example.com/direct", snippet: "" },
    ]);
  });

  it("reads Wikipedia search results into page links", () => {
    const results = parseWikipedia(fixture("wikipedia-zh.json"), "zh");
    expect(results[0]).toMatchObject({
      title: "春節",
      url: "https://zh.wikipedia.org/wiki/%E6%98%A5%E7%AF%80",
    });
    expect(results[0]?.snippet).toContain("春节");
    expect(results[0]?.snippet).not.toContain("searchmatch");
  });
});

describe("free web search chain", () => {
  const provider = (
    name: string,
    impl: SearchProvider["search"],
    keyed = false,
  ): SearchProvider & { calls: number } => {
    const p = {
      name,
      keyed,
      calls: 0,
      search: async (req: Parameters<SearchProvider["search"]>[0]) => {
        p.calls++;
        return impl(req);
      },
    };
    return p;
  };
  const hit = (url: string) => ({ title: url, url, snippet: "s" });

  it("answers from the first source with results and remembers the answer", async () => {
    quiet();
    const empty = provider("a", async () => []);
    const good = provider("b", async () => [
      hit("https://x.com/1"),
      hit("https://www.x.com/1/"),
      hit("https://y.com"),
    ]);
    const never = provider("c", async () => [hit("https://z.com")]);
    let now = 1_000;
    const service = createWebSearchService({
      providers: [empty, good, never],
      fetch: vi.fn(),
      now: () => now,
    });
    const first = await service.search("春节 海报");
    expect(first).toMatchObject({
      provider: "b",
      cached: false,
      skipped: ["a: no results"],
    });
    // Same address with and without www / trailing slash counts once.
    expect(first.results.map((r) => r.url)).toEqual([
      "https://x.com/1",
      "https://y.com",
    ]);
    expect(never.calls).toBe(0);
    now += 60_000;
    expect(await service.search("  春节   海报 ")).toMatchObject({
      provider: "b",
      cached: true,
    });
    expect(good.calls).toBe(1);
    now += CACHE_TTL_MS;
    await service.search("春节 海报");
    expect(good.calls).toBe(2);
  });

  it("rests a source that refused us and comes back to it later", async () => {
    quiet();
    const blocked = provider("ddg", async () => {
      throw new SearchBlockedError("ddg", "challenge page");
    });
    const backup = provider("wiki", async () => [
      hit("https://zh.wikipedia.org/wiki/A"),
    ]);
    let now = 0;
    const service = createWebSearchService({
      providers: [blocked, backup],
      fetch: vi.fn(),
      now: () => now,
    });
    expect((await service.search("q1")).provider).toBe("wiki");
    expect((await service.search("q2")).skipped).toEqual(["ddg: resting"]);
    expect(blocked.calls).toBe(1);
    now += BLOCK_REST_MS + 1;
    await service.search("q3");
    expect(blocked.calls).toBe(2);
  });

  it("says so when no source has anything, without throwing", async () => {
    quiet();
    const failing = provider("a", async () => {
      throw new Error("socket hang up");
    });
    const service = createWebSearchService({
      providers: [failing],
      fetch: vi.fn(),
    });
    expect(await service.search("q")).toMatchObject({
      provider: "none",
      results: [],
    });
  });

  it("orders keyed sources before the key-less ones", () => {
    expect(
      webSearchProviders({
        webSearchSearxngUrl: "http://searxng:8080",
        webSearchTavilyKey: "tvly-test",
        webSearchKeyless: "on",
      }).map((p) => p.name),
    ).toEqual(["searxng", "tavily", "yahoo-jp", "duckduckgo", "wikipedia"]);
    expect(webSearchProviders({ webSearchKeyless: "off" })).toEqual([]);
  });

  it("sends keyed requests with the key and reads their results", async () => {
    quiet();
    const fetch = vi.fn(async (url: string) => ({
      status: 200,
      text: url.includes("tavily")
        ? JSON.stringify({
            results: [{ title: "T", url: "https://t.com", content: "c" }],
          })
        : "{}",
    }));
    const [tavily] = webSearchProviders({
      webSearchTavilyKey: "tvly-test",
      webSearchKeyless: "off",
    });
    if (!tavily) throw new Error("tavily missing");
    const service = createWebSearchService({ providers: [tavily], fetch });
    expect((await service.search("q", { count: 3 })).results).toEqual([
      { title: "T", url: "https://t.com/", snippet: "c" },
    ]);
    const [, init] = fetch.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(init.headers.authorization).toBe("Bearer tvly-test");
    expect(JSON.parse(init.body)).toMatchObject({ query: "q", max_results: 3 });
  });
});

describe("reading a web page", () => {
  it("turns HTML into readable text", () => {
    const page =
      htmlToText(`<html><head><title>春节 &amp; 海报</title><meta name="description" content="配色指南"><style>.a{}</style></head>
<body><nav>首页 | 关于</nav><article><h1>2027 春节海报配色</h1><p>主色：<b>朱红</b>&nbsp;与金色。</p><ul><li>背景：米白</li><li>点缀：墨绿</li></ul>${"<p>更多内容。</p>".repeat(60)}</article><script>alert(1)</script><footer>版权</footer></body></html>`);
    expect(page.title).toBe("春节 & 海报");
    expect(page.description).toBe("配色指南");
    expect(page.text).toContain("# 2027 春节海报配色");
    expect(page.text).toContain("主色：朱红 与金色。");
    expect(page.text).toContain("- 背景：米白");
    expect(page.text).not.toMatch(/alert|首页|版权|\.a\{/);
    expect(stripTags("<b>a</b> &lt;b&gt; &#x4e2d;&#25991;")).toBe("a <b> 中文");
  });

  it("starts a MediaWiki page at the article body", () => {
    const page = htmlToText(
      `<html><head><title>Node.js - Wikipedia</title></head><body><main><div id="p-lang-btn"><ul><li>English</li><li>العربية</li></ul></div><div id="mw-content-text" class="mw-body-content"><p>Node.js is a cross-platform JavaScript runtime.</p></div></main></body></html>`,
    );
    expect(page.text).toBe("Node.js is a cross-platform JavaScript runtime.");
  });

  it("refuses addresses that are not public web pages", () => {
    for (const bad of [
      "http://localhost/",
      "http://127.0.0.1/",
      "http://10.0.0.8/admin",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://intranet/",
      "http://printer.local/",
      "https://user:pass@example.com/",
      "https://example.com:8443/",
      "file:///etc/passwd",
      "ftp://example.com/",
    ])
      expect(() => checkPageUrl(bad), bad).toThrow(ReadPageError);
    expect(checkPageUrl("https://www.zcool.com.cn/article/1").host).toBe(
      "www.zcool.com.cn",
    );
  });

  it("checks every redirect target again", async () => {
    quiet();
    const fetch = vi.fn(async (url: URL) =>
      url.host === "example.com"
        ? {
            status: 302,
            headers: new Headers(),
            body: Buffer.alloc(0),
            location: "http://127.0.0.1:80/secret",
          }
        : {
            status: 200,
            headers: new Headers({ "content-type": "text/html" }),
            body: Buffer.from("secret"),
          },
    );
    await expect(
      readWebPage("https://example.com/", { fetch }),
    ).rejects.toThrow("内网或本机地址");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reads a page in slices and decodes its charset", async () => {
    quiet();
    const gbk = Buffer.from([0xd6, 0xd0, 0xce, 0xc4]); // 中文 in GBK
    const body = Buffer.concat([
      Buffer.from(
        '<html><head><meta charset="gbk"><title>t</title></head><body><p>',
      ),
      gbk,
      Buffer.from(`</p><p>${"x".repeat(1200)}</p></body></html>`),
    ]);
    const fetch = vi.fn(async () => ({
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      body,
    }));
    const first = await readWebPage("https://example.com/a", {
      fetch,
      maxChars: 500,
    });
    expect(first.text.startsWith("中文")).toBe(true);
    expect(first.nextOffset).toBe(500);
    const second = await readWebPage("https://example.com/a", {
      fetch,
      maxChars: 500,
      offset: 1000,
    });
    expect(second.offset).toBe(1000);
    expect(second.nextOffset).toBeNull();
  });

  it("says what it cannot read", async () => {
    quiet();
    const pdf = vi.fn(async () => ({
      status: 200,
      headers: new Headers({ "content-type": "application/pdf" }),
      body: Buffer.from("%PDF"),
    }));
    await expect(
      readWebPage("https://example.com/a.pdf", { fetch: pdf }),
    ).rejects.toThrow("PDF");
    const gone = vi.fn(async () => ({
      status: 404,
      headers: new Headers(),
      body: Buffer.alloc(0),
    }));
    await expect(
      readWebPage("https://example.com/x", { fetch: gone }),
    ).rejects.toThrow("HTTP 404");
  });
});

describe("Gemini's Google Search as a tool", () => {
  const grounded = {
    candidates: [
      {
        content: {
          parts: [
            { text: "先想想", thought: true },
            { text: "Node.js 最新 LTS 是 24。" },
          ],
        },
        groundingMetadata: {
          webSearchQueries: ["node.js lts"],
          groundingChunks: [
            {
              web: {
                uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc",
                title: "nodejs.org",
              },
            },
            {
              web: {
                uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc",
                title: "dup",
              },
            },
          ],
        },
      },
    ],
  };

  it("reads the answer, its searches and sources", () => {
    expect(parseGroundedResponse(grounded)).toEqual({
      answer: "Node.js 最新 LTS 是 24。",
      queries: ["node.js lts"],
      sources: [
        {
          title: "nodejs.org",
          url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc",
        },
      ],
      grounded: true,
    });
    expect(
      parseGroundedResponse({
        candidates: [{ content: { parts: [{ text: "凭记忆" }] } }],
      }).grounded,
    ).toBe(false);
  });

  it("turns Google's redirect links into the pages they point to", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/ok"))
        return new Response(null, {
          status: 302,
          headers: {
            location: "https://nodejs.org/en/about/previous-releases",
          },
        });
      if (url.endsWith("/bad"))
        return new Response(null, {
          status: 302,
          headers: { location: "javascript:alert(1)" },
        });
      throw new Error("timeout");
    });
    const g = "https://vertexaisearch.cloud.google.com/grounding-api-redirect";
    expect(
      await resolveGroundingLinks(
        [
          { title: "nodejs.org", url: `${g}/ok` },
          { title: "x.com", url: `${g}/bad` },
          { title: "y.com", url: `${g}/slow` },
          { title: "plain", url: "https://example.com/" },
        ],
        fetch as never,
      ),
    ).toEqual([
      {
        title: "nodejs.org",
        url: "https://nodejs.org/en/about/previous-releases",
      },
      { title: "x.com", url: `${g}/bad` },
      { title: "y.com", url: `${g}/slow` },
      { title: "plain", url: "https://example.com/" },
    ]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("calls generateContent with Google Search as the only tool", async () => {
    quiet();
    const fetch = vi.fn(
      async () => new Response(JSON.stringify(grounded), { status: 200 }),
    );
    await geminiGroundedSearch({
      baseUrl: "https://main.example/",
      apiKey: "sk-test",
      model: "gemini-3.8-flash",
      query: "node.js lts",
      fetch: fetch as never,
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toBe(
      "https://main.example/v1beta/models/gemini-3.8-flash:generateContent",
    );
    expect(init.headers.authorization).toBe("Bearer sk-test");
    const body = JSON.parse(init.body);
    expect(body.tools).toEqual([{ googleSearch: {} }]);
    expect(body.generationConfig).toEqual({
      thinkingConfig: { thinkingLevel: "low" },
    });
    expect(body.contents[0].parts[0].text).toContain("node.js lts");
  });
});

describe("search_web / read_webpage tools", () => {
  const service = (
    results: Array<{ title: string; url: string; snippet: string }>,
  ) => ({
    providers: ["fake"],
    search: vi.fn(async () => ({
      provider: results.length ? "fake" : "none",
      results,
      cached: false,
      skipped: [],
    })),
  });
  const run = async (
    tools: ReturnType<typeof createWebTools>,
    name: string,
    input: object,
  ) =>
    JSON.parse(String(await tools.find((t) => t.name === name)?.invoke(input)));

  it("uses Gemini's grounded answer when it has sources", async () => {
    quiet();
    const free = service([{ title: "F", url: "https://f.com", snippet: "" }]);
    const tools = createWebTools({
      mode: "gemini",
      service: free,
      gemini: {
        baseUrl: "https://main.example",
        apiKey: "k",
        model: "gemini-3.8-flash",
      },
      geminiSearch: async () => ({
        answer: "答",
        queries: ["q"],
        sources: [{ title: "s", url: "https://s.com" }],
        grounded: true,
      }),
    });
    expect(await run(tools, "search_web", { query: "q" })).toMatchObject({
      via: "gemini",
      answer: "答",
      searches: ["q"],
    });
    expect(free.search).not.toHaveBeenCalled();
  });

  it("falls back to the free search when Gemini fails or does not ground", async () => {
    quiet();
    const free = service([{ title: "F", url: "https://f.com", snippet: "" }]);
    const failing = createWebTools({
      mode: "gemini",
      service: free,
      gemini: {
        baseUrl: "https://main.example",
        apiKey: "k",
        model: "gemini-3.8-flash",
      },
      geminiSearch: async () => {
        throw new Error("HTTP 503");
      },
    });
    expect(await run(failing, "search_web", { query: "q" })).toMatchObject({
      via: "fake",
      results: [{ url: "https://f.com" }],
    });
    const ungrounded = createWebTools({
      mode: "gemini",
      service: service([]),
      gemini: {
        baseUrl: "https://main.example",
        apiKey: "k",
        model: "gemini-3.8-flash",
      },
      geminiSearch: async () => ({
        answer: "凭记忆",
        queries: [],
        sources: [],
        grounded: false,
      }),
    });
    expect(await run(ungrounded, "search_web", { query: "q" })).toMatchObject({
      answer: "凭记忆",
      note: expect.stringContaining("未经核实"),
    });
  });

  it("tells the model when nothing was found, and stops after the run's limit", async () => {
    quiet();
    const tools = createWebTools({ mode: "free", service: service([]) });
    const none = await run(tools, "search_web", { query: "q" });
    expect(none.results).toEqual([]);
    expect(none.note).toContain("不要编造");
    for (let i = 0; i < 11; i++)
      await run(tools, "search_web", { query: `q${i}` });
    expect((await run(tools, "search_web", { query: "more" })).summary).toBe(
      "这一轮搜索次数已用完",
    );
  });

  it("returns a page's text, or why it could not be read", async () => {
    quiet();
    const tools = createWebTools({
      mode: "free",
      service: service([]),
      readPage: async (url) => {
        if (url.includes("127.0.0.1"))
          throw new ReadPageError("这个地址不能访问（内网或本机地址）");
        return {
          url,
          title: "T",
          description: "",
          text: "正文",
          offset: 0,
          nextOffset: 6000,
          totalChars: 9000,
        };
      },
    });
    expect(
      await run(tools, "read_webpage", { url: "https://example.com/" }),
    ).toMatchObject({
      title: "T",
      text: "正文",
      next_offset: 6000,
    });
    expect(
      await run(tools, "read_webpage", { url: "http://127.0.0.1/" }),
    ).toMatchObject({
      error: "这个地址不能访问（内网或本机地址）",
    });
  });
});
