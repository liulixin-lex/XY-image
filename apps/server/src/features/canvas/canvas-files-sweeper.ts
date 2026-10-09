import pg from "pg";

// Deletes canvas image objects that no canvas references any more.
//
// A save keeps only the files its images use and deletes the dropped ones
// from its own folder (canvas-service.ts, removeUnusedFiles). What is left
// behind: an upload whose save then failed, a delete that failed, and the
// files of canvases removed outright. The worker sweeps
// <workspace>/canvas-files/ for objects no canvas of that workspace
// references, once they are older than SWEEP_GRACE_MS (a save uploads before
// it writes the canvas). Archived projects keep their canvases, so their
// files stay referenced. generated/ (the user's history) is never looked at.
//
// Both sides come from SQL: storage.objects for what exists and
// canvases.content->files for what is referenced, so no listing is cut short
// by a page or row limit (a short reference list would make live images look
// orphaned). Deleting goes through the Storage API, so the bytes go too.

const BUCKET = "project-assets";
export const SWEEP_GRACE_MS = 3 * 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MAX_REMOVALS_PER_SWEEP = 1000;
const REMOVE_BATCH = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SweepStore = {
  /** Workspaces that have objects under <workspace>/canvas-files/. */
  workspaces(): Promise<string[]>;
  /**
   * Object names under <workspace>/canvas-files/ created before `before` that
   * no canvas of the workspace references, oldest first.
   */
  orphans(workspaceId: string, before: Date, limit: number): Promise<string[]>;
  close(): Promise<void>;
};

export type RemoveObjects = (
  paths: string[],
) => Promise<{ error: { message: string } | null }>;

export type SweepCounts = {
  workspaces: number;
  orphaned: number;
  removed: number;
  failed: number;
};

export function createSweepStore(databaseUrl: string): SweepStore {
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
        console.error("[canvas-files-sweep] Idle database connection failed");
      });
    }
    return pool;
  };
  return {
    async workspaces() {
      const { rows } = await db().query(
        `SELECT DISTINCT split_part(name, '/', 1) AS workspace_id
           FROM storage.objects
          WHERE bucket_id = $1 AND split_part(name, '/', 2) = 'canvas-files'`,
        [BUCKET],
      );
      return rows
        .map((row) => String(row.workspace_id))
        .filter((id) => UUID.test(id));
    },
    async orphans(workspaceId, before, limit) {
      if (!UUID.test(workspaceId)) return [];
      const { rows } = await db().query(
        `WITH referenced AS (
           SELECT DISTINCT f.value->>'dataURL' AS marker
             FROM public.canvases c
             JOIN public.projects p ON p.id = c.project_id
            CROSS JOIN LATERAL jsonb_each(
              CASE WHEN jsonb_typeof(c.content->'files') = 'object'
                   THEN c.content->'files' ELSE '{}'::jsonb END) f
            WHERE p.workspace_id::text = $2)
         SELECT o.name
           FROM storage.objects o
          WHERE o.bucket_id = $1
            AND split_part(o.name, '/', 1) = $2
            AND split_part(o.name, '/', 2) = 'canvas-files'
            AND o.created_at < $3
            AND NOT EXISTS (
              SELECT 1 FROM referenced r
               WHERE r.marker = 'oss://' || $1 || '/' || o.name)
          ORDER BY o.created_at
          LIMIT $4`,
        [BUCKET, workspaceId, before, limit],
      );
      return rows.map((row) => String(row.name));
    },
    async close() {
      await pool?.end();
      pool = undefined;
    },
  };
}

/** One pass over every workspace, at most `maxRemovals` objects deleted. */
export async function sweepCanvasFiles(deps: {
  store: Pick<SweepStore, "workspaces" | "orphans">;
  remove: RemoveObjects;
  dryRun?: boolean;
  now?: () => number;
  maxRemovals?: number;
}): Promise<SweepCounts> {
  const before = new Date((deps.now?.() ?? Date.now()) - SWEEP_GRACE_MS);
  const budget = deps.maxRemovals ?? MAX_REMOVALS_PER_SWEEP;
  const counts: SweepCounts = {
    workspaces: 0,
    orphaned: 0,
    removed: 0,
    failed: 0,
  };
  for (const workspaceId of await deps.store.workspaces()) {
    if (counts.orphaned >= budget) break;
    counts.workspaces += 1;
    const orphans = await deps.store.orphans(
      workspaceId,
      before,
      budget - counts.orphaned,
    );
    counts.orphaned += orphans.length;
    if (deps.dryRun) {
      if (orphans.length)
        console.info(
          `[canvas-files-sweep] dry run: would remove ${orphans.length} object(s) of workspace ${workspaceId}, e.g. ${orphans.slice(0, 3).join(", ")}`,
        );
      continue;
    }
    for (let index = 0; index < orphans.length; index += REMOVE_BATCH) {
      const batch = orphans.slice(index, index + REMOVE_BATCH);
      const { error } = await deps.remove(batch).catch((cause: unknown) => ({
        error: { message: String((cause as Error)?.message ?? cause) },
      }));
      if (error) {
        counts.failed += batch.length;
        console.warn(
          `[canvas-files-sweep] ${batch.length} object(s) of workspace ${workspaceId} not removed: ${error.message.slice(0, 200)}`,
        );
      } else counts.removed += batch.length;
    }
  }
  return counts;
}

export function createCanvasFilesSweeper(deps: {
  store: SweepStore;
  remove: RemoveObjects;
  dryRun?: boolean;
}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<unknown> | undefined;
  let stopped = false;

  // One line per sweep (every 6 hours), also when there was nothing to do,
  // so the log shows the sweeper is alive.
  async function sweep() {
    const started = Date.now();
    const counts = await sweepCanvasFiles(deps);
    console.info(
      `[canvas-files-sweep] ${deps.dryRun ? "dry run: " : ""}workspaces=${counts.workspaces} orphaned=${counts.orphaned} removed=${counts.removed} failed=${counts.failed} ms=${Date.now() - started}`,
    );
    return counts;
  }

  function schedule(ms: number) {
    if (stopped) return;
    timer = setTimeout(() => {
      running = sweep()
        .catch(() =>
          console.error(
            "[canvas-files-sweep] sweep failed (database or storage unavailable)",
          ),
        )
        .finally(() => {
          running = undefined;
          schedule(SWEEP_INTERVAL_MS);
        });
    }, ms);
    timer.unref?.();
  }

  return {
    sweep,
    /** First sweep 2–5 minutes after start, then every 6 hours. */
    start() {
      schedule(120_000 + Math.floor(Math.random() * 180_000));
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await running;
      await deps.store.close();
    },
  };
}
