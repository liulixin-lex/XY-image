import { randomBytes } from "node:crypto";
import Fastify from "fastify";
import { Response, type fetch as undiciFetch } from "undici";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import type { ServerEnv } from "../config/env.js";
import {
  createFontProxy,
  fontFileUrl,
  rewriteFontCss,
} from "../features/fonts/font-proxy.js";
import { registerFontsRoutes } from "./fonts.js";

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});
const css =
  "@font-face{src:url(https://fonts.gstatic.com/s/roboto/v51/AbC-d_E.woff2)}";
function fixture(fetcher: typeof undiciFetch, apiKey = "") {
  const proxy = createFontProxy({ apiKey, fetch: fetcher });
  const app = Fastify();
  registerFontsRoutes(app, { env: {} as ServerEnv, proxy });
  apps.push(app);
  return app;
}

describe("restricted font proxy", () => {
  it("rewrites real mixed-case font names and text subsets to relative API URLs", () => {
    expect(rewriteFontCss(css)).toContain(
      "url(/api/fonts/files/s/roboto/v51/AbC-d_E.woff2)",
    );
    expect(
      rewriteFontCss(
        "src:url(https://fonts.gstatic.com/l/font?kit=Ab_C-d&skey=abc123&v=v51)",
      ),
    ).toContain("/api/fonts/files/subset.woff2?kit=Ab_C-d&skey=abc123&v=v51");
  });
  it.each([
    "../a.woff2",
    "s/../a.woff2",
    "/a.woff2",
    "https://evil.test/a.woff2",
    "s/a.js",
    "s//a.ttf",
    "s/%2e%2e/a.woff2",
  ])("rejects unsafe file path %s", (path) => {
    expect(() => fontFileUrl(path, new URLSearchParams())).toThrow();
  });
  it("rejects extra parameters, redirects embedded in CSS, and imports", () => {
    expect(() =>
      fontFileUrl("a.woff2", new URLSearchParams("url=https://evil.test")),
    ).toThrow();
    expect(() =>
      fontFileUrl(
        "subset.woff2",
        new URLSearchParams("kit=abc&skey=a&v=v1&x=1"),
      ),
    ).toThrow();
    expect(() =>
      rewriteFontCss("src:url(https://evil.test/a.woff2)"),
    ).toThrow();
    expect(() => rewriteFontCss("@import 'https://evil.test';")).toThrow();
  });
  it("keeps an empty catalogue without a key and validates family/text before fetching", async () => {
    const fetcher = vi.fn();
    const app = fixture(fetcher);
    expect((await app.inject("/api/fonts")).json()).toEqual({ fonts: [] });
    for (const query of [
      "family=Roboto:ital",
      "family=Roboto&url=evil",
      "family=a&family=b",
      `family=Roboto&text=${"x".repeat(201)}`,
    ]) {
      expect((await app.inject(`/api/fonts/css2?${query}`)).statusCode).toBe(
        400,
      );
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("caches CSS and streams/cache fonts with correct media and cache headers", async () => {
    const fetcher = vi
      .fn<typeof undiciFetch>()
      .mockResolvedValueOnce(
        new Response(css, { headers: { "content-type": "text/css" } }),
      )
      .mockResolvedValueOnce(new Response(Buffer.from("wOF2fake")));
    const app = fixture(fetcher);
    for (let i = 0; i < 2; i++) {
      const result = await app.inject("/api/fonts/css2?family=Roboto&text=Hi");
      expect(result.statusCode).toBe(200);
      expect(result.headers["cache-control"]).toBe("public, max-age=86400");
      expect(result.body).toContain("/api/fonts/files/");
    }
    for (let i = 0; i < 2; i++) {
      const result = await app.inject(
        "/api/fonts/files/s/roboto/v51/AbC-d_E.woff2",
      );
      expect(result.body).toBe("wOF2fake");
      expect(result.headers["content-type"]).toBe("font/woff2");
      expect(result.headers["cache-control"]).toContain("immutable");
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe("error");
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("text=Hi");
  });
  it("enforces catalogue membership and bounds upstream response size", async () => {
    const fetcher = vi.fn<typeof undiciFetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            { family: "Roboto", category: "sans-serif", variants: ["regular"] },
          ],
        }),
      ),
    );
    const app = fixture(fetcher, "synthetic-key");
    expect(
      (await app.inject("/api/fonts/css2?family=Unknown")).statusCode,
    ).toBe(400);
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValueOnce(
      new Response("too big", {
        headers: { "content-length": "999999999", "content-type": "text/css" },
      }),
    );
    expect((await app.inject("/api/fonts/css2?family=Roboto")).statusCode).toBe(
      502,
    );
  });
  it("public font routes inherit the production CORS gate, including error responses", async () => {
    const app = buildApp({
      env: {
        xy2apiBaseUrl: "https://example.com",
        secretKey: randomBytes(32).toString("base64"),
        ssoEmailDomain: "sso.example.com",
        webOrigin: "https://draw.example.com",
      },
    });
    apps.push(app);
    for (const url of [
      "/api/fonts/css2?family=bad:family",
      "/api/fonts/files/a.js",
    ]) {
      const result = await app.inject({
        url,
        headers: { origin: "https://draw.example.com" },
      });
      expect(result.statusCode).toBe(400);
      expect(result.headers["access-control-allow-origin"]).toBe(
        "https://draw.example.com",
      );
      expect(
        (await app.inject({ url, headers: { origin: "https://evil.test" } }))
          .statusCode,
      ).toBe(403);
    }
  });
  it("rate limits anonymous callers without contacting upstream", async () => {
    const app = fixture(vi.fn());
    for (let i = 0; i < 240; i++)
      expect((await app.inject("/api/fonts")).statusCode).toBe(200);
    const result = await app.inject("/api/fonts");
    expect(result.statusCode).toBe(429);
    expect(Number(result.headers["retry-after"])).toBeGreaterThan(0);
  });
});
