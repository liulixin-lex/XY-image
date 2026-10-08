import pg from "pg";
import type { ServerEnv } from "../config/env.js";
import { createSupabaseFetch } from "./transport.js";
export type ReadinessResult = { ok: boolean; checks: Record<string, boolean> };
export function createReadinessProbe(env: ServerEnv) {
  const pool = env.supabaseDbUrl
    ? new pg.Pool({
        connectionString: env.supabaseDbUrl,
        max: 1,
        connectionTimeoutMillis: 3000,
        query_timeout: 3000,
        statement_timeout: 3000,
        idleTimeoutMillis: 10_000,
      })
    : undefined;
  pool?.on("error", () => {}); // Probe returns false; never log connection strings.
  const request = createSupabaseFetch(env);
  let pending: Promise<ReadinessResult> | undefined;
  let last: { result: ReadinessResult; until: number } | undefined;
  const http = async (path: string, init?: RequestInit) => {
    if (!env.supabaseUrl || !env.supabaseServiceRoleKey)
      throw new Error("unconfigured");
    const response = await request(
      `${env.supabaseUrl.replace(/\/$/, "")}${path}`,
      {
        ...init,
        signal: AbortSignal.timeout(3000),
        headers: {
          apikey: env.supabaseServiceRoleKey,
          Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
          "Content-Type": "application/json",
        },
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("unavailable");
    }
    return response;
  };
  async function check(): Promise<ReadinessResult> {
    const checks: Record<string, boolean> = {
      database: false,
      schema: false,
      queue: false,
      storage: false,
      realtime: false,
      permissions: false,
      auth: false,
      storageApi: false,
    };
    await Promise.all([
      (async () => {
        try {
          if (pool) {
            await pool.query("SELECT 1");
            checks.database = true;
          }
        } catch {}
      })(),
      (async () => {
        try {
          const result = await (
            await http("/rest/v1/rpc/xy_runtime_readiness", {
              method: "POST",
              body: "{}",
            })
          ).json();
          for (const key of [
            "schema",
            "queue",
            "storage",
            "realtime",
            "permissions",
          ])
            checks[key] =
              !!result &&
              typeof result === "object" &&
              (result as Record<string, unknown>)[key] === true;
        } catch {}
      })(),
      (async () => {
        try {
          const response = await http("/auth/v1/health");
          await response.body?.cancel();
          checks.auth = true;
        } catch {}
      })(),
      (async () => {
        try {
          const response = await http("/storage/v1/status");
          await response.body?.cancel();
          checks.storageApi = true;
        } catch {}
      })(),
    ]);
    return { ok: Object.values(checks).every(Boolean), checks };
  }
  return {
    async check() {
      if (last && last.until > Date.now()) return last.result;
      pending ??= check()
        .then((result) => {
          last = { result, until: Date.now() + 5000 };
          return result;
        })
        .finally(() => {
          pending = undefined;
        });
      return pending;
    },
    async close() {
      await pool?.end();
    },
  };
}
