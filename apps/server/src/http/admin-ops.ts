import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  type DiskSample,
  type OpsAlert,
  adminAlertsResponseSchema,
  adminSearchResponseSchema,
  adminStorageResponseSchema,
  applicationErrorResponseSchema,
  unauthenticatedErrorResponseSchema,
} from "@loomic/shared";

import type { ServerEnv } from "../config/env.js";
import { sharedWebSearchService } from "../features/web-search/service.js";
import type { AccountService } from "../features/xy2api/account-service.js";
import type { AdminSupabaseClient } from "../supabase/admin.js";
import type { RequestAuthenticator } from "../supabase/user.js";

// 管理 › 存储与告警 (第 59 条): what the worker's disk monitor recorded.
// Only for users whose main-site role is admin (stored at login,
// xy2api_accounts.role); everyone else gets 403 and the page is not shown to
// them. Read through the service role: ops tables have no client grants.

const SERIES_DAYS = 7;

type SampleRow = {
  sampled_at: string;
  fs_total_bytes: number | string;
  fs_used_bytes: number | string;
  fs_avail_bytes: number | string;
  db_bytes: number | string | null;
  storage_bytes: number | string | null;
  storage_by_kind: unknown;
  object_storage: string;
};

type AlertRow = {
  id: string;
  kind: string;
  level: string;
  message: string;
  value: number | string | null;
  threshold: number | string | null;
  opened_at: string;
  last_seen_at: string;
  resolved_at: string | null;
};

const num = (value: number | string | null) =>
  value === null ? null : Number(value);

function percentOf(used: number, avail: number) {
  return used + avail > 0
    ? Number(((used / (used + avail)) * 100).toFixed(2))
    : 0;
}

function toSample(row: SampleRow): DiskSample {
  const used = Number(row.fs_used_bytes);
  const avail = Number(row.fs_avail_bytes);
  return {
    sampledAt: row.sampled_at,
    totalBytes: Number(row.fs_total_bytes),
    usedBytes: used,
    availBytes: avail,
    percent: percentOf(used, avail),
    dbBytes: num(row.db_bytes),
    storageBytes: num(row.storage_bytes),
    storageByKind: (row.storage_by_kind ?? {}) as Record<string, number>,
    objectStorage: row.object_storage === "s3" ? "s3" : "local",
  };
}

function toAlert(row: AlertRow): OpsAlert {
  return {
    id: row.id,
    kind: row.kind,
    level: row.level === "critical" ? "critical" : "warning",
    message: row.message,
    value: num(row.value),
    threshold: num(row.threshold),
    openedAt: row.opened_at,
    lastSeenAt: row.last_seen_at,
    resolvedAt: row.resolved_at,
  };
}

/** Hourly peaks: the 管理 chart shows the worst moment of each hour. */
export function hourlyPeaks(rows: Array<{ at: string; percent: number }>) {
  const byHour = new Map<string, number>();
  for (const row of rows) {
    const hour = `${row.at.slice(0, 13)}:00:00Z`;
    byHour.set(hour, Math.max(byHour.get(hour) ?? 0, row.percent));
  }
  return [...byHour.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([at, percent]) => ({ at, percent }));
}

export async function registerAdminOpsRoutes(
  app: FastifyInstance,
  options: {
    auth: RequestAuthenticator;
    accounts: Pick<AccountService, "requireAccount">;
    getAdminClient: () => AdminSupabaseClient;
    env: Pick<
      ServerEnv,
      "diskAlertWarnPercent" | "diskAlertCriticalPercent" | "opsAlertWebhookUrl"
    > &
      Partial<Parameters<typeof sharedWebSearchService>[0]> &
      Pick<Partial<ServerEnv>, "webSearchGeminiFallback">;
  },
) {
  /** The signed-in admin, or a reply already sent. */
  async function admin(request: FastifyRequest, reply: FastifyReply) {
    const user = await options.auth.authenticate(request);
    if (!user) {
      await reply.code(401).send(
        unauthenticatedErrorResponseSchema.parse({
          error: {
            code: "unauthorized",
            message: "Missing or invalid bearer token.",
          },
        }),
      );
      return null;
    }
    const account = await options.accounts
      .requireAccount(user.id)
      .catch(() => null);
    if (account?.role !== "admin") {
      request.log.warn({ user: user.id }, "admin ops refused: not an admin");
      await reply.code(403).send(
        applicationErrorResponseSchema.parse({
          error: { code: "admin_only", message: "只有管理员可以查看。" },
        }),
      );
      return null;
    }
    return user;
  }

  const failed = (reply: FastifyReply) =>
    reply.code(500).send(
      applicationErrorResponseSchema.parse({
        error: { code: "ops_query_failed", message: "读取失败，稍后再试。" },
      }),
    );

  const openAlerts = async () => {
    const { data, error } = await options
      .getAdminClient()
      .from("ops_alerts")
      .select("*")
      .is("resolved_at", null)
      .order("opened_at", { ascending: false });
    if (error) throw error;
    return ((data ?? []) as AlertRow[]).map(toAlert);
  };

  // GET /api/admin/ops/alerts — open alerts, for the banner.
  app.get("/api/admin/ops/alerts", async (request, reply) => {
    if (!(await admin(request, reply))) return reply;
    try {
      reply.header("Cache-Control", "no-store");
      return adminAlertsResponseSchema.parse({ open: await openAlerts() });
    } catch (error) {
      request.log.error({ err: error }, "admin ops alerts failed");
      return failed(reply);
    }
  });

  // GET /api/admin/ops/search — the free web search's sources (第 70 条):
  // AnySearch's daily count and rests, the key-less engines' state.
  app.get("/api/admin/ops/search", async (request, reply) => {
    if (!(await admin(request, reply))) return reply;
    reply.header("Cache-Control", "no-store");
    return adminSearchResponseSchema.parse({
      sources: sharedWebSearchService(options.env).status(),
      geminiFallback: options.env.webSearchGeminiFallback !== "off",
    });
  });

  // GET /api/admin/ops/storage — the latest sample, a week of hourly peaks, alerts.
  app.get("/api/admin/ops/storage", async (request, reply) => {
    if (!(await admin(request, reply))) return reply;
    try {
      reply.header("Cache-Control", "no-store");
      const client = options.getAdminClient();
      const since = new Date(
        Date.now() - SERIES_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();
      const [latest, week, recent, open] = await Promise.all([
        client
          .from("ops_disk_samples")
          .select("*")
          .order("sampled_at", { ascending: false })
          .limit(1),
        client
          .from("ops_disk_samples")
          .select("sampled_at, fs_used_bytes, fs_avail_bytes")
          .gte("sampled_at", since)
          .order("sampled_at", { ascending: true })
          .limit(2000),
        client
          .from("ops_alerts")
          .select("*")
          .not("resolved_at", "is", null)
          .order("opened_at", { ascending: false })
          .limit(20),
        openAlerts(),
      ]);
      for (const result of [latest, week, recent])
        if (result.error) throw result.error;
      const latestRow = ((latest.data ?? []) as SampleRow[])[0];
      return adminStorageResponseSchema.parse({
        latest: latestRow ? toSample(latestRow) : null,
        series: hourlyPeaks(
          ((week.data ?? []) as SampleRow[]).map((row) => ({
            at: row.sampled_at,
            percent: percentOf(
              Number(row.fs_used_bytes),
              Number(row.fs_avail_bytes),
            ),
          })),
        ),
        alerts: {
          open,
          recent: ((recent.data ?? []) as AlertRow[]).map(toAlert),
        },
        thresholds: {
          warnPercent: options.env.diskAlertWarnPercent ?? 80,
          criticalPercent: options.env.diskAlertCriticalPercent ?? 90,
        },
        webhook: Boolean(options.env.opsAlertWebhookUrl),
      });
    } catch (error) {
      request.log.error({ err: error }, "admin ops storage failed");
      return failed(reply);
    }
  });
}
