import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ServerEnv } from "../config/env.js";
import {
  MEDIA_COOKIE,
  MEDIA_EXPIRY_COOKIE,
  MEDIA_TOKEN_TTL_S,
  type MediaDecision,
  type MemberCheck,
  authorizeMedia,
  mintMediaToken,
} from "../features/media/media-access.js";
import type { RequestAuthenticator } from "../supabase/user.js";

/**
 * Media cookie routes (features/media/media-access.ts, FINDINGS S2):
 *   POST   /api/media/session    page trades its access token for the cookie
 *   DELETE /api/media/session    sign-out clears it
 *   GET    /api/media/authorize  the edge asks before serving an image
 * With LOOMIC_MEDIA_ACCESS=open (local dev) they answer 204 and set nothing.
 */
export function registerMediaAccessRoutes(
  app: FastifyInstance,
  options: {
    env: Pick<ServerEnv, "mediaAccess" | "secretKey">;
    auth: RequestAuthenticator;
    isMember: MemberCheck;
  },
) {
  const enforced = options.env.mediaAccess === "cookie";
  const logDenied = limitedLog(30);

  app.post("/api/media/session", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!enforced) return reply.code(204).send();
    const user = await options.auth.authenticate(request);
    if (!user)
      return reply.code(401).send({
        error: { code: "unauthorized", message: "登录已过期，请重新登录" },
      });
    const { token, expiresAt } = mintMediaToken(options.env.secretKey, user.id);
    reply.header("Set-Cookie", [
      cookie(request, MEDIA_COOKIE, token, MEDIA_TOKEN_TTL_S, true),
      cookie(request, MEDIA_EXPIRY_COOKIE, String(expiresAt), MEDIA_TOKEN_TTL_S, false),
    ]);
    return reply.code(204).send();
  });

  app.delete("/api/media/session", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    clearMediaCookies(request, reply);
    return reply.code(204).send();
  });

  app.get("/api/media/authorize", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!enforced) return reply.code(204).send();
    // Caddy forward_auth sends X-Forwarded-Uri; the nginx template sets
    // X-Original-URI on its auth_request subrequest.
    const uri = header(request, "x-forwarded-uri") ?? header(request, "x-original-uri");
    let decision: MediaDecision;
    try {
      decision = await authorizeMedia({
        uri: uri ?? "",
        cookieHeader: header(request, "cookie"),
        secret: options.env.secretKey,
        isMember: options.isMember,
      });
    } catch (error) {
      console.error(
        `[media] authorize failed: ${error instanceof Error ? error.message : "unknown"}`,
      );
      return reply.code(503).send();
    }
    if (decision.allowed) return reply.code(204).send();
    // Path only, workspace shortened: enough to tell a leaked link from a
    // page that lost its cookie.
    logDenied(
      `[media] denied ${decision.reason} path=${(uri ?? "-").split("?")[0]?.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, (id) => `${id.slice(0, 8)}…`).slice(0, 160)}`,
    );
    return reply.code(decision.status).send();
  });
}

/** Clears the media cookies; also used by sign-out. */
export function clearMediaCookies(request: FastifyRequest, reply: FastifyReply) {
  reply.header("Set-Cookie", [
    cookie(request, MEDIA_COOKIE, "", 0, true),
    cookie(request, MEDIA_EXPIRY_COOKIE, "", 0, false),
  ]);
}

function cookie(
  request: FastifyRequest,
  name: string,
  value: string,
  maxAge: number,
  httpOnly: boolean,
): string {
  const secure =
    request.protocol === "https" ||
    header(request, "x-forwarded-proto") === "https";
  return [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "SameSite=Lax",
    ...(httpOnly ? ["HttpOnly"] : []),
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** At most `perMinute` lines a minute: a page of broken links is one story. */
function limitedLog(perMinute: number) {
  let windowStart = 0;
  let count = 0;
  let dropped = 0;
  return (line: string) => {
    const now = Date.now();
    if (now - windowStart > 60_000) {
      if (dropped)
        console.warn(`[media] ${dropped} more denials in the last minute`);
      windowStart = now;
      count = 0;
      dropped = 0;
    }
    if (count++ < perMinute) console.warn(line);
    else dropped++;
  };
}
