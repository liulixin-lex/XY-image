import { Readable } from "node:stream";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { readLimitedBody } from "../../utils/limited-body.js";

type Font = { family: string; category: string; variants: string[] };
type Entry = { body: Buffer; contentType: string; expires: number };
const DAY = 86_400_000;
const FILE_MAX = 10 * 1024 * 1024;
const MODERN_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export class FontProxyError extends Error {
  constructor(readonly status: number) {
    super("字体服务暂时不可用");
  }
}

export function fontFileUrl(path: string, query: URLSearchParams): URL {
  if (path === "subset.woff2") {
    const names = [...query.keys()];
    const kit = query.get("kit");
    const skey = query.get("skey");
    const version = query.get("v");
    if (
      names.length !== 3 ||
      new Set(names).size !== 3 ||
      !kit ||
      !/^[A-Za-z0-9_-]{1,4000}$/.test(kit) ||
      !skey ||
      !/^[a-f0-9]{1,64}$/.test(skey) ||
      !version ||
      !/^v[0-9]{1,10}$/.test(version)
    )
      throw new FontProxyError(400);
    return new URL(`https://fonts.gstatic.com/l/font?${query}`);
  }
  if (
    [...query].length ||
    path.length > 1024 ||
    !/^[A-Za-z0-9/_-]+(?:\.[A-Za-z0-9_-]+)*\.(woff2|woff|ttf)$/.test(path) ||
    path.startsWith("/") ||
    path.includes("//") ||
    path.split("/").some((p) => p === "." || p === "..")
  )
    throw new FontProxyError(400);
  return new URL(`https://fonts.gstatic.com/${path}`);
}

export function rewriteFontCss(css: string): string {
  if (/@import/i.test(css)) throw new FontProxyError(502);
  return css.replace(
    /url\(\s*(['"]?)(.*?)\1\s*\)/gi,
    (_all, _quote, value: string) => {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        throw new FontProxyError(502);
      }
      if (
        url.origin !== "https://fonts.gstatic.com" ||
        url.username ||
        url.password ||
        url.hash
      )
        throw new FontProxyError(502);
      const path =
        url.pathname === "/l/font" ? "subset.woff2" : url.pathname.slice(1);
      try {
        fontFileUrl(path, url.searchParams);
      } catch {
        throw new FontProxyError(502);
      }
      return `url(/api/fonts/files/${path}${url.search})`;
    },
  );
}

export function createFontProxy(options: {
  apiKey: string;
  fetch?: typeof undiciFetch;
  maxCacheBytes?: number;
}) {
  const fetcher = options.fetch ?? undiciFetch;
  const proxyUrl =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.GLOBAL_AGENT_HTTP_PROXY;
  const dispatcher =
    !options.fetch && proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
  const cache = new Map<string, Entry>();
  const maxCache = options.maxCacheBytes ?? 50 * 1024 * 1024;
  let bytes = 0;
  let active = 0;
  let fonts: Font[] = [];
  let catalogueExpires = 0;
  let cataloguePending: Promise<Font[]> | undefined;

  function cached(key: string) {
    const entry = cache.get(key);
    if (!entry) return;
    cache.delete(key);
    if (entry.expires <= Date.now()) {
      bytes -= entry.body.length;
      return;
    }
    cache.set(key, entry);
    return entry;
  }
  function save(key: string, entry: Entry) {
    const previous = cache.get(key);
    if (previous) {
      bytes -= previous.body.length;
      cache.delete(key);
    }
    if (entry.body.length > maxCache) return;
    while (
      cache.size &&
      (bytes + entry.body.length > maxCache || cache.size >= 2048)
    ) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      bytes -= cache.get(oldest)?.body.length ?? 0;
      cache.delete(oldest);
    }
    cache.set(key, entry);
    bytes += entry.body.length;
  }
  async function request(url: URL) {
    if (active >= 8) throw new FontProxyError(503);
    active++;
    try {
      const response = await fetcher(url, {
        headers: { "user-agent": MODERN_UA },
        signal: AbortSignal.timeout(10_000),
        redirect: "error",
        ...(dispatcher ? { dispatcher } : {}),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new FontProxyError(
          response.status === 400 || response.status === 404 ? 400 : 502,
        );
      }
      return response;
    } catch (error) {
      active--;
      throw error;
    }
  }
  async function list(): Promise<Font[]> {
    if (!options.apiKey) return []; // Preserve the documented manual-entry UI.
    if (Date.now() < catalogueExpires) return fonts;
    if (cataloguePending) return cataloguePending;
    cataloguePending = (async () => {
      const url = new URL("https://www.googleapis.com/webfonts/v1/webfonts");
      url.searchParams.set("key", options.apiKey);
      url.searchParams.set("sort", "popularity");
      const response = await request(url);
      try {
        const data = JSON.parse(
          (await readLimitedBody(response, 4 * 1024 * 1024)).toString(),
        );
        if (!Array.isArray(data.items)) throw new FontProxyError(502);
        fonts = data.items
          .filter(
            (f: Font) =>
              typeof f.family === "string" &&
              typeof f.category === "string" &&
              Array.isArray(f.variants) &&
              f.variants.every((v) => typeof v === "string"),
          )
          .map((f: Font) => ({
            family: f.family,
            category: f.category,
            variants: f.variants,
          }));
        catalogueExpires = Date.now() + DAY;
        return fonts;
      } finally {
        active--;
      }
    })().finally(() => {
      cataloguePending = undefined;
    });
    return cataloguePending;
  }
  async function css(family: string, text?: string) {
    if (
      !/^[A-Za-z0-9 ]{1,64}$/.test(family) ||
      !family.trim() ||
      (text !== undefined && [...text].length > 200)
    )
      throw new FontProxyError(400);
    // A stale catalogue is still authoritative; without one use the restricted family syntax.
    const catalogue = await list().catch(() => fonts);
    if (catalogue.length && !catalogue.some((f) => f.family === family))
      throw new FontProxyError(400);
    const url = new URL("https://fonts.googleapis.com/css2");
    url.searchParams.set("family", family);
    url.searchParams.set("display", "swap");
    if (text) url.searchParams.set("text", text);
    const key = url.href;
    const hit = cached(key);
    if (hit) return hit;
    const response = await request(url);
    try {
      if (!response.headers.get("content-type")?.startsWith("text/css"))
        throw new FontProxyError(502);
      const body = Buffer.from(
        rewriteFontCss(
          (await readLimitedBody(response, 512 * 1024)).toString(),
        ),
      );
      const entry = {
        body,
        contentType: "text/css; charset=utf-8",
        expires: Date.now() + DAY,
      };
      save(key, entry);
      return entry;
    } finally {
      active--;
    }
  }
  async function file(path: string, query: URLSearchParams) {
    const url = fontFileUrl(path, query);
    const hit = cached(url.href);
    const contentType = path.endsWith(".woff2")
      ? "font/woff2"
      : path.endsWith(".woff")
        ? "font/woff"
        : "font/ttf";
    if (hit)
      return { body: Readable.from([hit.body]), contentType: hit.contentType };
    const response = await request(url);
    if (Number(response.headers.get("content-length")) > FILE_MAX) {
      active--;
      await response.body?.cancel();
      throw new FontProxyError(502);
    }
    // Stream to the client with backpressure, cache only a complete bounded response.
    async function* chunks() {
      const reader = response.body?.getReader();
      const data: Uint8Array[] = [];
      let size = 0;
      try {
        if (!reader) throw new FontProxyError(502);
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > FILE_MAX) throw new FontProxyError(502);
          data.push(chunk.value);
          yield chunk.value;
        }
        save(url.href, {
          body: Buffer.concat(data, size),
          contentType,
          expires: Date.now() + 365 * DAY,
        });
      } finally {
        active--;
        await reader?.cancel().catch(() => {});
        reader?.releaseLock();
      }
    }
    return { body: Readable.from(chunks()), contentType };
  }
  return {
    list,
    css,
    file,
    close: async () => {
      await dispatcher?.close();
    },
  };
}
