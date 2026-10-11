import pg from "pg";
import type { RemoveObjects } from "../canvas/canvas-files-sweeper.js";

// Deletes projects the user deleted, for real (FINDINGS S2).
//
// DELETE /api/projects/:id only sets archived_at, while the dialog says
// 「画布和对话记录会一起删除，无法恢复」. Once PURGE_AFTER_MS has passed (a
// window in which ops can still undo a mistake by clearing archived_at), the
// worker removes:
//   - the files uploaded into the project (asset_objects.project_id) and its
//     thumbnail, through the Storage API so the bytes go too;
//   - the project row; canvases, chat sessions and messages, agent runs and
//     asset rows go with it (ON DELETE CASCADE), background_jobs keep their
//     billing record with project/canvas/session set to null.
// Canvas images (<workspace>/canvas-files/) are then unreferenced and the
// canvas files sweeper removes them. Generated pictures stay: they are the
// user's 生图 history, listed there whatever project they came from.
//
// A project whose files could not all be removed is kept and retried on the
// next run, so no row disappears with its files still public.

const BUCKET = "project-assets";
export const PURGE_AFTER_MS = 24 * 60 * 60 * 1000;
const PURGE_INTERVAL_MS = 60 * 60 * 1000;
const MAX_PROJECTS_PER_RUN = 50;
const REMOVE_BATCH = 100;

export type DueProject = {
  id: string;
  workspaceId: string;
  /** project-assets object names: uploads and the thumbnail */
  paths: string[];
};

export type PurgeStore = {
  due(before: Date, limit: number): Promise<DueProject[]>;
  /** Deletes the row if it is still deleted and due; false if restored. */
  remove(projectId: string, before: Date): Promise<boolean>;
  close(): Promise<void>;
};

export type PurgeCounts = {
  due: number;
  purged: number;
  files: number;
  failed: number;
};

export function createPurgeStore(databaseUrl: string): PurgeStore {
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
        console.error("[project-purge] Idle database connection failed");
      });
    }
    return pool;
  };
  return {
    async due(before, limit) {
      const { rows } = await db().query(
        `SELECT p.id, p.workspace_id, p.thumbnail_path,
                coalesce(array_agg(a.object_path) FILTER (WHERE a.bucket = $1), '{}') AS paths
           FROM public.projects p
           LEFT JOIN public.asset_objects a ON a.project_id = p.id
          WHERE p.archived_at IS NOT NULL AND p.archived_at < $2
          GROUP BY p.id
          ORDER BY min(p.archived_at)
          LIMIT $3`,
        [BUCKET, before, limit],
      );
      return rows.map((row) => ({
        id: String(row.id),
        workspaceId: String(row.workspace_id),
        paths: [
          ...(row.paths as string[]),
          ...(row.thumbnail_path ? [String(row.thumbnail_path)] : []),
        ],
      }));
    },
    async remove(projectId, before) {
      const { rowCount } = await db().query(
        `DELETE FROM public.projects
          WHERE id = $1 AND archived_at IS NOT NULL AND archived_at < $2`,
        [projectId, before],
      );
      return (rowCount ?? 0) > 0;
    },
    async close() {
      await pool?.end();
      pool = undefined;
    },
  };
}

export async function purgeDeletedProjects(deps: {
  store: Pick<PurgeStore, "due" | "remove">;
  remove: RemoveObjects;
  dryRun?: boolean;
  now?: () => number;
}): Promise<PurgeCounts> {
  const before = new Date((deps.now?.() ?? Date.now()) - PURGE_AFTER_MS);
  const projects = await deps.store.due(before, MAX_PROJECTS_PER_RUN);
  const counts: PurgeCounts = { due: projects.length, purged: 0, files: 0, failed: 0 };
  for (const project of projects) {
    // Only this workspace's own folder, whatever a row says.
    const paths = [...new Set(project.paths)].filter((name) =>
      name.startsWith(`${project.workspaceId}/`),
    );
    if (deps.dryRun) {
      console.info(
        `[project-purge] dry run: would delete project ${project.id} and ${paths.length} file(s)`,
      );
      continue;
    }
    let ok = true;
    for (let index = 0; index < paths.length; index += REMOVE_BATCH) {
      const batch = paths.slice(index, index + REMOVE_BATCH);
      const { error } = await deps.remove(batch).catch((cause: unknown) => ({
        error: { message: String((cause as Error)?.message ?? cause) },
      }));
      if (error) {
        ok = false;
        console.warn(
          `[project-purge] project ${project.id}: ${batch.length} file(s) not removed, retrying next run: ${error.message.slice(0, 200)}`,
        );
        break;
      }
      counts.files += batch.length;
    }
    if (!ok) {
      counts.failed += 1;
      continue;
    }
    if (await deps.store.remove(project.id, before)) counts.purged += 1;
  }
  return counts;
}

export function createProjectPurger(deps: {
  store: PurgeStore;
  remove: RemoveObjects;
  dryRun?: boolean;
}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<unknown> | undefined;
  let stopped = false;

  async function run() {
    const started = Date.now();
    const counts = await purgeDeletedProjects(deps);
    // Quiet when there is nothing to do; the hourly run is not news.
    if (counts.due)
      console.info(
        `[project-purge] ${deps.dryRun ? "dry run: " : ""}due=${counts.due} purged=${counts.purged} files=${counts.files} failed=${counts.failed} ms=${Date.now() - started}`,
      );
    return counts;
  }

  function schedule(ms: number) {
    if (stopped) return;
    timer = setTimeout(() => {
      running = run()
        .catch((error: unknown) =>
          console.error(
            `[project-purge] run failed: ${error instanceof Error ? error.message.slice(0, 200) : "unknown"}`,
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
    /** First run 3–6 minutes after start, then hourly. */
    start() {
      schedule(180_000 + Math.floor(Math.random() * 180_000));
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await running;
      await deps.store.close();
    },
  };
}
