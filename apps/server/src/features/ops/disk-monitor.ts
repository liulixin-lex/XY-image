import { statfs } from "node:fs/promises";
import pg from "pg";

// 磁盘用量告警 (第 59 条).
//
// Every SAMPLE_INTERVAL_MS the worker records how full the disk is and what
// fills it, and keeps one open alert per kind:
//   - disk: the filesystem the containers run on (statfs on DISK_MONITOR_PATH,
//     "/" by default; inside a container that is the overlay on the host's
//     Docker disk, which on the production box is also where the database,
//     local Storage files and backups live);
//   - the database size and what Storage holds by kind, from SQL (so the page
//     can say what to clean up, and how much moved to R2 / S3).
// A warning opens at warnPercent, becomes critical at criticalPercent, and
// resolves once use is RESOLVE_MARGIN points below warnPercent (no flapping
// around the line). Opening, escalating and resolving are sent to
// OPS_ALERT_WEBHOOK_URL when one is set (plain JSON POST, never retried).
// Samples older than KEEP_SAMPLES_MS are deleted.

const SAMPLE_INTERVAL_MS = 10 * 60 * 1000;
const KEEP_SAMPLES_MS = 30 * 24 * 60 * 60 * 1000;
export const RESOLVE_MARGIN = 2;

export type DiskReading = {
  totalBytes: number;
  usedBytes: number;
  availBytes: number;
};

export type DiskSample = DiskReading & {
  dbBytes: number | null;
  storageBytes: number | null;
  storageByKind: Record<string, number>;
  objectStorage: "local" | "s3";
};

export type AlertLevel = "warning" | "critical";

export type OpenAlert = {
  id: string;
  level: AlertLevel;
  notifiedLevel: AlertLevel | null;
};

export type DiskMonitorStore = {
  measure(): Promise<
    Pick<DiskSample, "dbBytes" | "storageBytes" | "storageByKind">
  >;
  record(sample: DiskSample): Promise<void>;
  openAlert(kind: string): Promise<OpenAlert | null>;
  /** Opens or updates the kind's alert; returns its id. */
  raise(
    kind: string,
    level: AlertLevel,
    message: string,
    value: number,
    threshold: number,
  ): Promise<string>;
  resolve(kind: string): Promise<boolean>;
  markNotified(id: string, level: AlertLevel | "resolved"): Promise<void>;
  prune(before: Date): Promise<void>;
  close(): Promise<void>;
};

export function percentUsed(reading: DiskReading) {
  // As df reports it: used / (used + available); root's reserve is not usable.
  const usable = reading.usedBytes + reading.availBytes;
  return usable > 0 ? (reading.usedBytes / usable) * 100 : 0;
}

/** The level the reading calls for, given the level already open (hysteresis). */
export function levelFor(
  percent: number,
  thresholds: { warnPercent: number; criticalPercent: number },
  open: AlertLevel | null,
): AlertLevel | null {
  if (percent >= thresholds.criticalPercent) return "critical";
  if (percent >= thresholds.warnPercent) return "warning";
  // Stay open until clearly below the line.
  if (open && percent > thresholds.warnPercent - RESOLVE_MARGIN)
    return "warning";
  return null;
}

export function formatBytes(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export async function readDisk(path: string): Promise<DiskReading> {
  const stats = await statfs(path);
  const block = Number(stats.bsize);
  const total = Number(stats.blocks) * block;
  const free = Number(stats.bfree) * block;
  const avail = Number(stats.bavail) * block;
  return { totalBytes: total, usedBytes: total - free, availBytes: avail };
}

export function createDiskMonitorStore(databaseUrl: string): DiskMonitorStore {
  let pool: pg.Pool | undefined;
  const db = () => {
    if (!pool) {
      pool = new pg.Pool({
        connectionString: databaseUrl,
        max: 1,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
        allowExitOnIdle: true,
      });
      pool.on("error", () => {
        console.error("[disk-monitor] Idle database connection failed");
      });
    }
    return pool;
  };
  return {
    async measure() {
      const size = await db().query(
        `SELECT pg_database_size(current_database()) AS bytes`,
      );
      // What Storage holds, by kind. storage.objects keeps each object's size
      // in metadata; it is the same whether the bytes are local or in R2.
      const kinds = await db().query(
        `SELECT CASE
                  WHEN bucket_id = 'brand-kit-assets' THEN 'brand'
                  WHEN bucket_id <> 'project-assets' THEN 'other'
                  WHEN split_part(name, '/', 2) = 'generated' THEN 'generated'
                  WHEN split_part(name, '/', 2) = 'canvas-files' THEN 'canvas'
                  WHEN name ~ '/thumbnail\\.[a-z]+$' THEN 'other'
                  ELSE 'uploads'
                END AS kind,
                coalesce(sum((metadata ->> 'size')::bigint), 0) AS bytes
           FROM storage.objects
          GROUP BY 1`,
      );
      const storageByKind: Record<string, number> = {};
      let storageBytes = 0;
      for (const row of kinds.rows) {
        storageByKind[String(row.kind)] = Number(row.bytes);
        storageBytes += Number(row.bytes);
      }
      return {
        dbBytes: Number(size.rows[0]?.bytes ?? 0),
        storageBytes,
        storageByKind,
      };
    },
    async record(sample) {
      await db().query(
        `INSERT INTO public.ops_disk_samples
           (fs_total_bytes, fs_used_bytes, fs_avail_bytes, db_bytes, storage_bytes, storage_by_kind, object_storage)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          sample.totalBytes,
          sample.usedBytes,
          sample.availBytes,
          sample.dbBytes,
          sample.storageBytes,
          JSON.stringify(sample.storageByKind),
          sample.objectStorage,
        ],
      );
    },
    async openAlert(kind) {
      const { rows } = await db().query(
        `SELECT id, level, notified_level FROM public.ops_alerts WHERE kind = $1 AND resolved_at IS NULL`,
        [kind],
      );
      const row = rows[0];
      return row
        ? {
            id: String(row.id),
            level: row.level as AlertLevel,
            notifiedLevel: (row.notified_level as AlertLevel | null) ?? null,
          }
        : null;
    },
    async raise(kind, level, message, value, threshold) {
      const { rows } = await db().query(
        `INSERT INTO public.ops_alerts (kind, level, message, value, threshold)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (kind) WHERE resolved_at IS NULL DO UPDATE
           SET level = EXCLUDED.level, message = EXCLUDED.message,
               value = EXCLUDED.value, threshold = EXCLUDED.threshold,
               last_seen_at = now()
         RETURNING id`,
        [kind, level, message, value, threshold],
      );
      return String(rows[0]?.id);
    },
    async resolve(kind) {
      const { rowCount } = await db().query(
        `UPDATE public.ops_alerts SET resolved_at = now(), last_seen_at = now()
          WHERE kind = $1 AND resolved_at IS NULL`,
        [kind],
      );
      return (rowCount ?? 0) > 0;
    },
    async markNotified(id, level) {
      await db().query(
        `UPDATE public.ops_alerts SET notified_level = $2 WHERE id = $1`,
        [id, level],
      );
    },
    async prune(before) {
      await db().query(
        `DELETE FROM public.ops_disk_samples WHERE sampled_at < $1`,
        [before],
      );
    },
    async close() {
      await pool?.end();
      pool = undefined;
    },
  };
}

export type DiskMonitorDeps = {
  store: DiskMonitorStore;
  read: () => Promise<DiskReading>;
  warnPercent: number;
  criticalPercent: number;
  objectStorage: "local" | "s3";
  /** POSTs an alert change; absent when no webhook is configured. */
  notify?: (event: Record<string, unknown>) => Promise<void>;
  now?: () => number;
};

/** One sample: record it, then open, escalate or resolve the disk alert. */
export async function sampleDisk(deps: DiskMonitorDeps) {
  const reading = await deps.read();
  const measured = await deps.store.measure();
  const sample: DiskSample = {
    ...reading,
    ...measured,
    objectStorage: deps.objectStorage,
  };
  await deps.store.record(sample);
  await deps.store.prune(
    new Date((deps.now?.() ?? Date.now()) - KEEP_SAMPLES_MS),
  );

  const percent = percentUsed(reading);
  const open = await deps.store.openAlert("disk");
  const level = levelFor(percent, deps, open?.level ?? null);
  const used = `${percent.toFixed(1)}%（${formatBytes(reading.usedBytes)} / ${formatBytes(reading.usedBytes + reading.availBytes)}）`;
  if (level) {
    const threshold =
      level === "critical" ? deps.criticalPercent : deps.warnPercent;
    const message =
      level === "critical"
        ? `磁盘已用 ${used}，超过 ${threshold}%，剩余 ${formatBytes(reading.availBytes)}，请尽快清理或扩容。`
        : `磁盘已用 ${used}，超过 ${threshold}%，剩余 ${formatBytes(reading.availBytes)}。`;
    const id = await deps.store.raise(
      "disk",
      level,
      message,
      Number(percent.toFixed(2)),
      threshold,
    );
    if (open?.notifiedLevel !== level) {
      console.warn(`[disk-monitor] ${level}: ${message}`);
      // Without a webhook the log line and 管理 are the notice: mark it
      // so the next samples stay quiet. With one, only a delivered POST
      // counts; a failed one is retried at the next sample.
      if (!deps.notify) await deps.store.markNotified(id, level);
      else
        await deps
          .notify({
            kind: "disk",
            level,
            message,
            percent: Number(percent.toFixed(2)),
            availBytes: reading.availBytes,
          })
          .then(() => deps.store.markNotified(id, level))
          .catch((error: unknown) =>
            console.warn(
              `[disk-monitor] webhook failed: ${error instanceof Error ? error.message.slice(0, 160) : "unknown"}`,
            ),
          );
    }
  } else if (open && (await deps.store.resolve("disk"))) {
    console.info(`[disk-monitor] resolved: disk ${percent.toFixed(1)}%`);
    await deps
      .notify?.({
        kind: "disk",
        level: "resolved",
        message: `磁盘已回到 ${percent.toFixed(1)}%。`,
        percent: Number(percent.toFixed(2)),
      })
      .catch(() => {});
  }
  return { percent, level, sample };
}

export function createDiskMonitor(deps: DiskMonitorDeps) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<unknown> | undefined;
  let stopped = false;

  function schedule(ms: number) {
    if (stopped) return;
    timer = setTimeout(() => {
      running = sampleDisk(deps)
        .catch((error: unknown) =>
          console.error(
            `[disk-monitor] sample failed: ${error instanceof Error ? error.message.slice(0, 200) : "unknown"}`,
          ),
        )
        .finally(() => {
          running = undefined;
          schedule(SAMPLE_INTERVAL_MS);
        });
    }, ms);
    timer.unref?.();
  }

  return {
    run: () => sampleDisk(deps),
    /** First sample 30–60 s after start (the 管理 page has data soon), then every 10 minutes. */
    start() {
      schedule(30_000 + Math.floor(Math.random() * 30_000));
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await running;
      await deps.store.close();
    },
  };
}

/** A JSON POST to the configured webhook, 5 s timeout. */
export function webhookNotifier(url: string) {
  return async (event: Record<string, unknown>) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "xy-image",
        at: new Date().toISOString(),
        ...event,
      }),
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
    if (!response.ok) throw new Error(`webhook answered ${response.status}`);
  };
}
