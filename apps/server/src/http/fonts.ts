import type { FastifyInstance } from "fastify";
import type { ServerEnv } from "../config/env.js";
import {
  FontProxyError,
  createFontProxy,
} from "../features/fonts/font-proxy.js";
import { RequestLimiter } from "../utils/request-limiter.js";

export function registerFontsRoutes(
  app: FastifyInstance,
  options: { env: ServerEnv; proxy?: ReturnType<typeof createFontProxy> },
) {
  const proxy =
    options.proxy ??
    createFontProxy({ apiKey: options.env.googleFontsApiKey ?? "" });
  const limiter = new RequestLimiter(240);
  app.addHook("onClose", async () => proxy.close());

  app.register(async (fontsApp) => {
    fontsApp.addHook("onRequest", async (request, reply) => {
      const retryAfter = limiter.take(request.ip);
      if (retryAfter)
        return reply
          .code(429)
          .header("Retry-After", retryAfter)
          .send({
            error: {
              code: "rate_limited",
              message: "字体请求过于频繁，请稍后再试",
            },
          });
    });
    fontsApp.setErrorHandler((error, request, reply) => {
      const status = error instanceof FontProxyError ? error.status : 502;
      request.log.warn(
        { code: "fonts_unavailable", status },
        "[fonts] Request failed",
      );
      return reply.code(status).send({
        error: {
          code: status === 400 ? "invalid_request" : "fonts_unavailable",
          message: status === 400 ? "字体请求参数无效" : "字体服务暂时不可用",
        },
      });
    });
    fontsApp.get("/api/fonts", async (request, reply) => {
      const query = new URL(request.url, "http://local").searchParams;
      const search = query.get("search")?.toLowerCase();
      const category = query.get("category");
      let fonts = await proxy.list();
      if (search)
        fonts = fonts.filter((f) => f.family.toLowerCase().includes(search));
      if (category) fonts = fonts.filter((f) => f.category === category);
      return reply.send({ fonts });
    });
    fontsApp.get("/api/fonts/css2", async (request, reply) => {
      const query = new URL(request.url, "http://local").searchParams;
      if (
        [...query.keys()].some((k) => k !== "family" && k !== "text") ||
        query.getAll("family").length !== 1 ||
        query.getAll("text").length > 1
      )
        throw new FontProxyError(400);
      const entry = await proxy.css(
        query.get("family") ?? "",
        query.get("text") ?? undefined,
      );
      return reply
        .type(entry.contentType)
        .header("Cache-Control", "public, max-age=86400")
        .header("X-Content-Type-Options", "nosniff")
        .send(entry.body);
    });
    fontsApp.get<{ Params: { "*": string } }>(
      "/api/fonts/files/*",
      async (request, reply) => {
        const query = new URL(request.url, "http://local").searchParams;
        const file = await proxy.file(request.params["*"], query);
        return reply
          .type(file.contentType)
          .header("Cache-Control", "public, max-age=31536000, immutable")
          .header("X-Content-Type-Options", "nosniff")
          .send(file.body);
      },
    );
  });
}
