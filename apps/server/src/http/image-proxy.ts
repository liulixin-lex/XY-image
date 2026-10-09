import type { FastifyInstance, FastifyReply } from "fastify";
import type { ServerEnv } from "../config/env.js";
import { createSupabaseFetch } from "../supabase/transport.js";
import { RequestLimiter } from "../utils/request-limiter.js";

/**
 * GET /api/proxy-image?url=… — reads an image from this site's own Supabase
 * Storage so the canvas can embed it (`fetchAsDataURL` in apps/web: generated
 * images placed by the image panel or by the agent on the client).
 *
 * Until 10-09 it fetched any host ending in `supabase.co` or `replicate.*`
 * (suffix match, so `evilsupabase.co` passed too), followed redirects and
 * passed the upstream content type through: an open proxy, an SSRF (any
 * Supabase project can answer with a redirect to an internal address) and a
 * way to serve arbitrary HTML from the API origin.
 *
 * Now only public or signed object URLs under SUPABASE_URL are read, through
 * the internal Supabase transport, without redirects; only raster images up
 * to MAX_BYTES come back, with nosniff. No sign-in: everything it serves is
 * already readable at that URL, so the per-IP limit only guards bandwidth.
 */
const OBJECT_PATHS = ["/storage/v1/object/public/", "/storage/v1/object/sign/"];
const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const MAX_BYTES = 25 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

type ProxyFailure = { status: number; code: string; message: string };
const fail = (status: number, code: string, message: string): ProxyFailure => ({
  status,
  code,
  message,
});

export function registerImageProxyRoute(
  app: FastifyInstance,
  options: { env: ServerEnv; fetch?: typeof fetch },
) {
  const base = parseBase(options.env.supabaseUrl);
  const fetcher = options.fetch ?? createSupabaseFetch(options.env);
  const limiter = new RequestLimiter(240);

  app.get<{ Querystring: { url?: unknown } }>(
    "/api/proxy-image",
    async (request, reply) => {
      const retryAfter = limiter.take(request.ip);
      if (retryAfter)
        return reply
          .code(429)
          .header("Retry-After", retryAfter)
          .send({
            error: {
              code: "rate_limited",
              message: "图片请求过于频繁，请稍后再试",
            },
          });

      const target = checkTarget(request.query.url, base);
      if ("status" in target) {
        console.warn(`[image-proxy] refused: ${target.code}`);
        return sendFailure(reply, target);
      }

      const result = await readImage(fetcher, target);
      if ("status" in result) {
        // Path only: signed URLs carry a token in the query.
        console.warn(
          `[image-proxy] ${shortPath(target)} not served: ${result.code}`,
        );
        return sendFailure(reply, result);
      }
      return reply
        .header("content-type", result.mimeType)
        .header("x-content-type-options", "nosniff")
        .header("content-security-policy", "default-src 'none'; sandbox")
        .header("cache-control", "private, max-age=86400")
        .send(result.bytes);
    },
  );
}

function parseBase(supabaseUrl: string | undefined) {
  if (!supabaseUrl) return null;
  try {
    const url = new URL(supabaseUrl);
    return { origin: url.origin, path: url.pathname.replace(/\/$/, "") };
  } catch {
    return null;
  }
}

function checkTarget(
  raw: unknown,
  base: ReturnType<typeof parseBase>,
): URL | ProxyFailure {
  if (typeof raw !== "string" || !raw)
    return fail(400, "invalid_url", "缺少图片地址");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail(400, "invalid_url", "图片地址无效");
  }
  if (!base) return fail(403, "url_not_allowed", "图片服务未配置");
  const objectPath = url.pathname.slice(base.path.length);
  if (
    url.origin !== base.origin ||
    url.username ||
    url.password ||
    !url.pathname.startsWith(`${base.path}/`) ||
    !OBJECT_PATHS.some((prefix) => objectPath.startsWith(prefix)) ||
    // Encoded dots, slashes and backslashes could step out of the object
    // route once a proxy in front of Storage decodes them.
    /%2e|%2f|%5c|\\/i.test(url.pathname)
  )
    return fail(403, "url_not_allowed", "只能读取本站存储里的图片");
  return url;
}

async function readImage(
  fetcher: typeof fetch,
  url: URL,
): Promise<{ bytes: Buffer; mimeType: string } | ProxyFailure> {
  let response: Response;
  try {
    response = await fetcher(url, {
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return fail(502, "upstream_unreachable", "图片读取失败，请稍后重试");
  }
  const mimeType =
    response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ??
    "";
  if (!response.ok || !IMAGE_TYPES.has(mimeType)) {
    await response.body?.cancel().catch(() => {});
    if (!response.ok)
      return response.status === 400 || response.status === 404
        ? fail(404, "image_not_found", "图片不存在或已过期")
        : fail(502, `upstream_${response.status}`, "图片读取失败，请稍后重试");
    return fail(415, "not_an_image", "这个地址不是图片");
  }
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) {
    await response.body?.cancel().catch(() => {});
    return fail(413, "image_too_large", "图片太大");
  }
  try {
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = response.body?.getReader();
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel().catch(() => {});
        return fail(413, "image_too_large", "图片太大");
      }
      chunks.push(value);
    }
    return { bytes: Buffer.concat(chunks), mimeType };
  } catch {
    return fail(502, "upstream_unreachable", "图片读取失败，请稍后重试");
  }
}

function sendFailure(reply: FastifyReply, failure: ProxyFailure) {
  return reply
    .code(failure.status)
    .send({ error: { code: failure.code, message: failure.message } });
}

// `/storage/v1/object/public/<bucket>/…`: enough to find the object family in
// logs without the full path or any query.
function shortPath(url: URL) {
  return `${url.pathname.split("/").slice(0, 7).join("/")}/…`;
}
