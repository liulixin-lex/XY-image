import { createHash } from "node:crypto";
import type { Database } from "@loomic/shared";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import type { FastifyRequest } from "fastify";
import { decodeJwt, importJWK, jwtVerify } from "jose";
import type { ServerEnv } from "../config/env.js";
import { createSupabaseFetch } from "./transport.js";

export type UserSupabaseClient = SupabaseClient<Database>;
export type AuthenticatedUser = {
  accessToken: string;
  email: string;
  id: string;
  userMetadata: Record<string, unknown>;
  appMetadata?: Record<string, unknown>;
};
export type RequestAuthenticator = {
  authenticate(
    request: Pick<FastifyRequest, "headers">,
  ): Promise<AuthenticatedUser | null>;
};
type AuthEnv = Pick<
  ServerEnv,
  | "supabaseAnonKey"
  | "supabaseJwtSecret"
  | "supabaseUrl"
  | "supabaseInternalUrl"
  | "supabaseJwtIssuer"
>;

export function createSupabaseRequestAuthenticator(
  env: AuthEnv,
  options: {
    now?: () => number;
    createUserClient?: (token: string) => UserSupabaseClient;
  } = {},
): RequestAuthenticator {
  const now = options.now ?? Date.now;
  // Keys and cache must belong to this instance: multiple projects/tests cannot share trust.
  const issuer =
    env.supabaseJwtIssuer ??
    (env.supabaseUrl
      ? `${env.supabaseUrl.replace(/\/$/, "")}/auth/v1`
      : undefined);
  let key:
    | Promise<Awaited<ReturnType<typeof importJWK>> | Uint8Array>
    | undefined;
  let algorithm: string | undefined;
  if (env.supabaseJwtSecret) {
    if (env.supabaseJwtSecret.trimStart().startsWith("{")) {
      let jwk: Record<string, string>;
      try {
        jwk = JSON.parse(env.supabaseJwtSecret);
      } catch {
        throw new Error("Invalid SUPABASE_JWT_SECRET JWK");
      }
      algorithm = jwk.alg ?? (jwk.kty === "EC" ? "ES256" : "RS256");
      if (!["ES256", "RS256"].includes(algorithm ?? ""))
        throw new Error("Invalid SUPABASE_JWT_SECRET algorithm");
      key = importJWK(jwk, algorithm);
      void key.catch(() => {});
    } else {
      algorithm = "HS256";
      key = Promise.resolve(new TextEncoder().encode(env.supabaseJwtSecret));
    }
  }
  const createUserClient =
    options.createUserClient ?? createUserSupabaseClientFactory(env);
  const cache = new Map<string, { user: AuthenticatedUser; until: number }>();
  // Why a bearer token was refused (jose error code / claim name, never token
  // contents), at most once a minute per reason: a misconfigured issuer or
  // secret otherwise shows up only as unexplained 401s.
  const rejected = new Map<string, number>();
  const reject = (reason: string) => {
    if ((rejected.get(reason) ?? 0) <= now()) {
      rejected.set(reason, now() + 60_000);
      console.warn(`[auth] bearer token rejected: ${reason}`);
    }
    return null;
  };
  return {
    async authenticate(request) {
      const token = readBearerToken(request.headers.authorization);
      if (!token) return null;
      try {
        const claims = key
          ? (
              await jwtVerify(token, await key, {
                audience: "authenticated",
                ...(issuer ? { issuer } : {}),
                algorithms: [algorithm ?? "HS256"],
                requiredClaims: ["exp", "sub", "iat", "role"],
                currentDate: new Date(now()),
              })
            ).payload
          : decodeJwt(token);
        if (typeof claims.exp !== "number" || claims.exp * 1000 <= now())
          return reject("expired");
        if (key) {
          if (
            claims.role !== "authenticated" ||
            !claims.sub ||
            typeof claims.email !== "string" ||
            !claims.email
          )
            return reject("not an authenticated user token");
          return {
            accessToken: token,
            id: claims.sub,
            email: claims.email,
            appMetadata: isRecord(claims.app_metadata)
              ? claims.app_metadata
              : {},
            userMetadata: isRecord(claims.user_metadata)
              ? claims.user_metadata
              : {},
          };
        }
        // Unverified claims only bound the cache; trust comes from Auth.getUser().
        const hash = createHash("sha256").update(token).digest("hex");
        const hit = cache.get(hash);
        if (hit && hit.until > now()) return hit.user;
        cache.delete(hash);
        const { data, error } = await createUserClient(token).auth.getUser();
        if (error || !data.user?.email || claims.exp * 1000 <= now())
          return reject("auth server refused the session");
        const user: AuthenticatedUser = {
          accessToken: token,
          id: data.user.id,
          email: data.user.email,
          appMetadata: data.user.app_metadata ?? {},
          userMetadata: isRecord(data.user.user_metadata)
            ? data.user.user_metadata
            : {},
        };
        // Hard cap: remove oldest, never let a valid token outlive its expiry.
        if (cache.size >= 1000) {
          const oldest = cache.keys().next().value;
          if (oldest) cache.delete(oldest);
        }
        cache.set(hash, {
          user,
          until: Math.min(now() + 60_000, claims.exp * 1000),
        });
        return user;
      } catch (error) {
        // No token or upstream error contents in logs: code and claim only.
        const { code, claim } = (error ?? {}) as {
          code?: unknown;
          claim?: unknown;
        };
        return reject(
          typeof code === "string"
            ? `${code}${typeof claim === "string" ? ` claim=${claim}` : ""}`
            : "verification error",
        );
      }
    },
  };
}

export function createUserSupabaseClientFactory(
  env: Pick<
    ServerEnv,
    "supabaseAnonKey" | "supabaseUrl" | "supabaseInternalUrl"
  >,
) {
  return (accessToken: string): UserSupabaseClient => {
    if (!env.supabaseUrl || !env.supabaseAnonKey)
      throw new Error(
        "SUPABASE_URL and SUPABASE_ANON_KEY are required for user-scoped Supabase access.",
      );
    return createClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        fetch: createSupabaseFetch(env),
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    });
  };
}
function readBearerToken(value: string | string[] | undefined): string | null {
  if (typeof value !== "string" || value.length > 16_384) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(value.trim());
  return match?.[1] ?? null;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
