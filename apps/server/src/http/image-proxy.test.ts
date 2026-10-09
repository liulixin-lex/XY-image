import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerEnv } from "../config/env.js";
import { registerImageProxyRoute } from "./image-proxy.js";

// The proxy used to fetch any *supabase.co / *replicate.* URL and follow
// redirects (open proxy + SSRF). It now reads only this site's own Storage.
const BASE = "https://db.example.test";
const OBJECT = `${BASE}/storage/v1/object/public/project-assets/ws-1/generated/a.png`;
const PNG = Buffer.from("89504e470d0a1a0a", "hex");

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

function fixture(
  respond: (url: URL) => Response | Promise<Response>,
  env: Partial<ServerEnv> = { supabaseUrl: BASE },
) {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const calls: Array<{ url: string; init?: RequestInit | undefined }> = [];
  const fetcher = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return respond(new URL(String(input)));
    },
  ) as unknown as typeof fetch;
  const app = Fastify();
  registerImageProxyRoute(app, { env: env as ServerEnv, fetch: fetcher });
  apps.push(app);
  const get = (url?: string) =>
    app.inject({
      method: "GET",
      url: "/api/proxy-image",
      query: url === undefined ? {} : { url },
    });
  return { get, calls };
}
const image = (
  body: ConstructorParameters<typeof Response>[0] = PNG,
  type = "image/png",
  headers = {},
) => new Response(body, { headers: { "content-type": type, ...headers } });

describe("image proxy", () => {
  it("serves an image from the site's own storage without following redirects", async () => {
    const { get, calls } = fixture(() => image());
    const res = await get(OBJECT);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.rawPayload).toEqual(PNG);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(OBJECT);
    expect(calls[0]?.init?.redirect).toBe("error");
  });

  it("reads signed URLs with their token", async () => {
    const signed = `${BASE}/storage/v1/object/sign/brand-kit-assets/k/a.webp?token=abc`;
    const { get, calls } = fixture(() => image(PNG, "image/webp"));
    expect((await get(signed)).statusCode).toBe(200);
    expect(calls[0]?.url).toBe(signed);
  });

  it.each([
    "https://evil.supabase.co/storage/v1/object/public/a/b.png",
    "https://evilsupabase.co/storage/v1/object/public/a/b.png",
    "https://replicate.delivery/a.png",
    "https://db.example.test.evil.test/storage/v1/object/public/a/b.png",
    "https://xdb.example.test/storage/v1/object/public/a/b.png",
    "http://db.example.test/storage/v1/object/public/a/b.png",
    "https://db.example.test:8443/storage/v1/object/public/a/b.png",
    "https://user:pw@db.example.test/storage/v1/object/public/a/b.png",
    "https://db.example.test/rest/v1/canvases?select=*",
    "https://db.example.test/storage/v1/object/authenticated/a/b.png",
    "https://db.example.test/storage/v1/object/public/../../../rest/v1/x",
    "https://db.example.test/storage/v1/object/public/%2e%2e/%2e%2e/rest/v1/x",
    "https://db.example.test/storage/v1/object/public/a%2f..%2f..%2fx",
    "http://127.0.0.1:3101/api/ready",
    "http://169.254.169.254/latest/meta-data/",
    "file:///etc/passwd",
  ])("refuses %s without fetching", async (url) => {
    const { get, calls } = fixture(() => image());
    const res = await get(url);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("url_not_allowed");
    expect(calls).toEqual([]);
  });

  it("refuses everything when SUPABASE_URL is not set, and a missing or bad url", async () => {
    const unconfigured = fixture(() => image(), {});
    expect((await unconfigured.get(OBJECT)).statusCode).toBe(403);
    const { get, calls } = fixture(() => image());
    expect((await get()).statusCode).toBe(400);
    expect((await get("not a url")).statusCode).toBe(400);
    expect(unconfigured.calls).toEqual([]);
    expect(calls).toEqual([]);
  });

  it.each([
    ["text/html", "<script>alert(1)</script>"],
    ["image/svg+xml", "<svg onload=alert(1)>"],
    ["application/octet-stream", "x"],
  ])("does not pass through %s", async (type, body) => {
    const { get } = fixture(() => image(body, type));
    const res = await get(OBJECT);
    expect(res.statusCode).toBe(415);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.body).not.toContain("<");
  });

  it("maps upstream failures", async () => {
    const status = (code: number) =>
      fixture(() => new Response("{}", { status: code })).get(OBJECT);
    expect((await status(400)).statusCode).toBe(404);
    expect((await status(404)).statusCode).toBe(404);
    expect((await status(500)).statusCode).toBe(502);
    const redirected = fixture(() => {
      throw new TypeError("fetch failed: unexpected redirect");
    });
    expect((await redirected.get(OBJECT)).statusCode).toBe(502);
  });

  it("refuses images over 25 MB, declared or streamed", async () => {
    const declared = fixture(() =>
      image(PNG, "image/png", { "content-length": String(26 * 1024 * 1024) }),
    );
    expect((await declared.get(OBJECT)).statusCode).toBe(413);
    const megabyte = new Uint8Array(1024 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ < 30) controller.enqueue(megabyte);
        else controller.close();
      },
    });
    const streamed = fixture(() => image(stream));
    expect((await streamed.get(OBJECT)).statusCode).toBe(413);
    expect(sent).toBeLessThan(30);
  });
});
