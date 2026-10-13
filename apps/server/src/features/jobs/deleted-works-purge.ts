import pg from "pg";
import type { RemoveObjects } from "../canvas/canvas-files-sweeper.js";

// Removes the pictures of 作品 the user deleted (第 58 条).
//
// POST /api/jobs/delete only stamps background_jobs.deleted_at: the picture
// leaves 作品 and 生成记录 at once and 撤销 can bring it back. Once
// PURGE_AFTER_MS has passed, the worker handles each deleted job once:
//   - its picture and thumbnail (result.object_path / thumb_path, always
//     under <workspace>/generated/) are removed through the Storage API, and
//     the asset_objects row goes with them;
//   - unless a canvas or a chat message of that workspace still uses the
//     picture: a canvas image or an assistant reply must not turn into a
//     broken image because the picture left the 作品 list. Those files stay,
//     the job gets purge_checked_at, and it is checked again RECHECK_MS
//     later, until nothing uses it any more.
// Once the files are gone purged_at is stamped: the job is never looked at
// again and the delete can no longer be undone. The job row itself stays: it
// is the billing record (request id, billing_status) and the reconciler
// still settles a 待核对 one.
//
// A job whose files could not be removed keeps purged_at null and is retried
// on the next run.

const BUCKET = "project-assets";
export const PURGE_AFTER_MS = 24 * 60 * 60 * 1000;
/** A picture kept because something still used it is looked at again after this. */
export const RECHECK_MS = 7 * 24 * 60 * 60 * 1000;
const PURGE_INTERVAL_MS = 60 * 60 * 1000;
const MAX_JOBS_PER_RUN = 200;

export type DueWork = {
  jobId: string;
  workspaceId: string;
  /** project-assets object names: the picture and its thumbnail. */
  paths: string[];
  /** A canvas or chat message of the workspace still uses the picture. */
  inUse: boolean;
};

export type WorksPurgeStore = {
  /**
   * Deleted before `before`, not purged, and not kept since `recheckBefore`
   * (kept pictures come back once a week).
   */
  due(before: Date, recheckBefore: Date, limit: number): Promise<DueWork[]>;
  /**
   * Stamps purged_at (and drops the asset row when the files went) if the
   * job is still deleted; false when the user restored it meanwhile.
   */
  finish(
    jobId: string,
    before: Date,
    removed: string[],
  ): Promise<boolean>;
  /** Stamps purge_checked_at on a picture kept because something uses it. */
  keep(jobId: string, before: Date): Promise<boolean>;
  close(): Promise<void>;
};

export type WorksPurgeCounts = {
  due: number;
  removed: number;
  kept: number;
  files: number;
  failed: number;
};

export function createWorksPurgeStore(databaseUrl: string): WorksPurgeStore {
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
        console.error("[works-purge] Idle database connection failed");
      });
    }
    return pool;
  };
  return {
    async due(before, recheckBefore, limit) {
      // The reference check is a text search of the workspace's canvases
      // (oss://project-assets/<path> markers) and chat messages (image URLs
      // in replies and tool results). Run on a handful of jobs an hour, so
      // the scans stay cheap.
      const { rows } = await db().query(
        `SELECT j.id, j.workspace_id,
                j.result->>'object_path' AS object_path,
                j.result->>'thumb_path' AS thumb_path,
                (j.result->>'object_path') IS NOT NULL AND (
                  EXISTS (
                    SELECT 1 FROM public.canvases c
                      JOIN public.projects p ON p.id = c.project_id
                     WHERE p.workspace_id = j.workspace_id
                       AND strpos(c.content::text, j.result->>'object_path') > 0)
                  OR EXISTS (
                    SELECT 1 FROM public.chat_messages m
                      JOIN public.chat_sessions s ON s.id = m.session_id
                      JOIN public.canvases c ON c.id = s.canvas_id
                      JOIN public.projects p ON p.id = c.project_id
                     WHERE p.workspace_id = j.workspace_id
                       AND (strpos(m.content, j.result->>'object_path') > 0
                            OR strpos(coalesce(m.tool_activities::text, ''), j.result->>'object_path') > 0))
                ) AS in_use
           FROM public.background_jobs j
          WHERE j.deleted_at IS NOT NULL AND j.purged_at IS NULL
            AND j.deleted_at < $1
            AND (j.purge_checked_at IS NULL OR j.purge_checked_at < $2)
          ORDER BY j.deleted_at
          LIMIT $3`,
        [before, recheckBefore, limit],
      );
      return rows.map((row) => ({
        jobId: String(row.id),
        workspaceId: String(row.workspace_id),
        paths: [row.object_path, row.thumb_path]
          .filter((path): path is string => typeof path === "string" && path.length > 0),
        inUse: row.in_use === true,
      }));
    },
    async finish(jobId, before, removed) {
      const client = await db().connect();
      try {
        await client.query("BEGIN");
        const { rowCount } = await client.query(
          `UPDATE public.background_jobs SET purged_at = now()
            WHERE id = $1 AND deleted_at IS NOT NULL AND deleted_at < $2
              AND purged_at IS NULL`,
          [jobId, before],
        );
        if ((rowCount ?? 0) > 0 && removed.length > 0)
          await client.query(
            `DELETE FROM public.asset_objects
              WHERE bucket = $1 AND object_path = ANY($2::text[])`,
            [BUCKET, removed],
          );
        await client.query("COMMIT");
        return (rowCount ?? 0) > 0;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    async keep(jobId, before) {
      const { rowCount } = await db().query(
        `UPDATE public.background_jobs SET purge_checked_at = now()
          WHERE id = $1 AND deleted_at IS NOT NULL AND deleted_at < $2
            AND purged_at IS NULL`,
        [jobId, before],
      );
      return (rowCount ?? 0) > 0;
    },
    async close() {
      await pool?.end();
      pool = undefined;
    },
  };
}

export async function purgeDeletedWorks(deps: {
  store: Pick<WorksPurgeStore, "due" | "finish" | "keep">;
  remove: RemoveObjects;
  dryRun?: boolean;
  now?: () => number;
}): Promise<WorksPurgeCounts> {
  const now = deps.now?.() ?? Date.now();
  const before = new Date(now - PURGE_AFTER_MS);
  const works = await deps.store.due(before, new Date(now - RECHECK_MS), MAX_JOBS_PER_RUN);
  const counts: WorksPurgeCounts = {
    due: works.length,
    removed: 0,
    kept: 0,
    files: 0,
    failed: 0,
  };
  for (const work of works) {
    // Only this workspace's generated pictures, whatever a result says.
    const paths = [...new Set(work.paths)].filter((name) =>
      name.startsWith(`${work.workspaceId}/generated/`),
    );
    if (deps.dryRun) {
      console.info(
        `[works-purge] dry run: job ${work.jobId} would ${work.inUse ? "keep" : "remove"} ${paths.length} file(s)`,
      );
      continue;
    }
    if (work.inUse) {
      if (await deps.store.keep(work.jobId, before)) counts.kept += 1;
      continue;
    }
    if (paths.length === 0) {
      // Nothing stored under generated/ (an old or failed result): done.
      await deps.store.finish(work.jobId, before, []);
      continue;
    }
    const { error } = await deps.remove(paths).catch((cause: unknown) => ({
      error: { message: String((cause as Error)?.message ?? cause) },
    }));
    if (error) {
      counts.failed += 1;
      console.warn(
        `[works-purge] job ${work.jobId}: ${paths.length} file(s) not removed, retrying next run: ${error.message.slice(0, 200)}`,
      );
      continue;
    }
    counts.files += paths.length;
    if (await deps.store.finish(work.jobId, before, paths)) counts.removed += 1;
  }
  return counts;
}

export function createWorksPurger(deps: {
  store: WorksPurgeStore;
  remove: RemoveObjects;
  dryRun?: boolean;
}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<unknown> | undefined;
  let stopped = false;

  async function run() {
    const started = Date.now();
    const counts = await purgeDeletedWorks(deps);
    // Quiet when there is nothing to do; the hourly run is not news.
    if (counts.due)
      console.info(
        `[works-purge] ${deps.dryRun ? "dry run: " : ""}due=${counts.due} removed=${counts.removed} kept=${counts.kept} files=${counts.files} failed=${counts.failed} ms=${Date.now() - started}`,
      );
    return counts;
  }

  function schedule(ms: number) {
    if (stopped) return;
    timer = setTimeout(() => {
      running = run()
        .catch((error: unknown) =>
          console.error(
            `[works-purge] run failed: ${error instanceof Error ? error.message.slice(0, 200) : "unknown"}`,
          ),
        )
        .finally(() => {
          running = undefined;
          schedule(PURGE_INTERVAL_MS);
        });
    }, ms);
    timer.unref?.();
  }

  return {
    run,
    /** First run 4–8 minutes after start, then hourly. */
    start() {
      schedule(240_000 + Math.floor(Math.random() * 240_000));
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await running;
      await deps.store.close();
    },
  };
}
