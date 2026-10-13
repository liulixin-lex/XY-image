import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import type { AdminSupabaseClient } from "../supabase/admin.js";
import { hourlyPeaks, registerAdminOpsRoutes } from "./admin-ops.js";

const sample = {
  sampled_at: "2026-10-13T06:10:00Z",
  fs_total_bytes: 352_000_000_000,
  fs_used_bytes: 178_000_000_000,
  fs_avail_bytes: 160_000_000_000,
  db_bytes: 160_000_000,
  storage_bytes: 390_000_000,
  storage_by_kind: { generated: 300_000_000, uploads: 80_000_000 },
  object_storage: "local",
};
const alert = {
  id: "a1",
  kind: "disk",
  level: "warning",
  message: "磁盘已用 85%",
  value: "85.1",
  threshold: "80",
  opened_at: "2026-10-13T05:00:00Z",
  last_seen_at: "2026-10-13T06:00:00Z",
  resolved_at: null,
};

/** A PostgREST-like builder: every call chains, awaiting gives the table's rows. */
function fakeClient() {
  const rows: Record<string, unknown[]> = {
    "ops_disk_samples:latest": [sample],
    "ops_disk_samples:week": [
      sample,
      {
        ...sample,
        sampled_at: "2026-10-13T06:20:00Z",
        fs_used_bytes: 180_000_000_000,
      },
    ],
    "ops_alerts:open": [alert],
    "ops_alerts:recent": [
      { ...alert, id: "a0", resolved_at: "2026-10-12T01:00:00Z" },
    ],
  };
  return {
    from(table: string) {
      let key = table;
      const builder = {
        select: (columns: string) => {
          if (table === "ops_disk_samples")
            key = columns === "*" ? `${table}:latest` : `${table}:week`;
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        gte: () => builder,
        is: () => {
          key = `${table}:open`;
          return builder;
        },
        not: () => {
          key = `${table}:recent`;
          return builder;
        },
        // biome-ignore lint/suspicious/noThenProperty: mimics the awaitable query builder
        then: (resolve: (value: { data: unknown[]; error: null }) => void) =>
          resolve({ data: rows[key] ?? [], error: null }),
      };
      return builder;
    },
  } as unknown as AdminSupabaseClient;
}

async function route(role: string | null, signedIn = true) {
  const app = Fastify();
  await registerAdminOpsRoutes(app, {
    auth: {
      authenticate: async () =>
        signedIn
          ? { id: "u1", accessToken: "t", email: "", userMetadata: {} }
          : null,
    },
    accounts: { requireAccount: vi.fn(async () => ({ role }) as never) },
    getAdminClient: fakeClient,
    env: {
      diskAlertWarnPercent: 80,
      diskAlertCriticalPercent: 90,
      opsAlertWebhookUrl: "https://hooks.example/x",
    },
  });
  return app;
}

describe("管理 › 存储与告警 routes (第 59 条)", () => {
  it("refuses anyone who is not a main-site admin", async () => {
    expect(
      (
        await (
          await route(null, false)
        ).inject({ url: "/api/admin/ops/storage" })
      ).statusCode,
    ).toBe(401);
    const user = await (await route("user")).inject({
      url: "/api/admin/ops/storage",
    });
    expect(user.statusCode).toBe(403);
    expect(user.json().error.code).toBe("admin_only");
    expect(
      (await (await route("user")).inject({ url: "/api/admin/ops/alerts" }))
        .statusCode,
    ).toBe(403);
  });

  it("gives admins the latest sample, hourly peaks and alerts, without the webhook address", async () => {
    const response = await (await route("admin")).inject({
      url: "/api/admin/ops/storage",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.latest).toMatchObject({
      percent: 52.66,
      storageByKind: { generated: 300_000_000 },
      objectStorage: "local",
    });
    expect(body.series).toEqual([
      { at: "2026-10-13T06:00:00Z", percent: 52.94 },
    ]);
    expect(body.alerts.open[0]).toMatchObject({
      level: "warning",
      value: 85.1,
      threshold: 80,
    });
    expect(body.alerts.recent[0].resolvedAt).toBe("2026-10-12T01:00:00Z");
    expect(body.thresholds).toEqual({ warnPercent: 80, criticalPercent: 90 });
    expect(body.webhook).toBe(true);
    expect(JSON.stringify(body)).not.toContain("hooks.example");

    const banner = await (await route("admin")).inject({
      url: "/api/admin/ops/alerts",
    });
    expect(banner.json().open).toHaveLength(1);
  });

  it("keeps the worst moment of each hour", () => {
    expect(
      hourlyPeaks([
        { at: "2026-10-13T06:10:00Z", percent: 50 },
        { at: "2026-10-13T06:50:00Z", percent: 55 },
        { at: "2026-10-13T05:00:00Z", percent: 40 },
      ]),
    ).toEqual([
      { at: "2026-10-13T05:00:00Z", percent: 40 },
      { at: "2026-10-13T06:00:00Z", percent: 55 },
    ]);
  });
});
