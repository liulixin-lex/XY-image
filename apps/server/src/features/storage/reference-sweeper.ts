import pg from "pg";
import type { RemoveObjects } from "../canvas/canvas-files-sweeper.js";

// Deletes uploaded reference pictures nothing uses any more (第 59 条).
//
// POST /api/uploads stores 参考图, 局部重绘 masks and canvas-chat attachments
// in project-assets as <workspace>/<time>-<name> (studio) or
// <workspace>/<project>/<time>-<name> (canvas chat), with an asset_objects
// row. They pile up: a reference removed from the composer, a mask from an
// edit that was never sent, a chat attachment of a deleted message, a
// reference whose jobs were all deleted and purged. Nothing else ever
// removes them.
//
// The worker looks at such objects older than SWEEP_GRACE_MS and removes
// those that no live job (purged_at is null: deleted jobs keep theirs until
// the deleted-works purge), no canvas and no chat message mentions by object
// path. Upload names are sanitised to [A-Za-z0-9._-] (upload-service.ts), so
// every path in the job payloads (input_images, edit.mask),
// canvases.content and chat_messages (content, content_blocks,
// tool_activities) is pulled out with one regex pass per table and the
// uploads are anti-joined against that set. A per-candidate text search
// would rescan every payload for each candidate, and a candidate window
// taken before the check would stall once its oldest uploads are all still
// in use. A mention in any workspace keeps the file (paths start with their
// own workspace, so that only ever keeps more). Generated pictures
// (generated/), canvas images (canvas-files/) and project thumbnails are
// other folders and never match the upload name pattern.
//
// Deleting goes through the Storage API so the bytes go too; the asset rows
// are deleted after. A batch the Storage API refuses is retried next run.

const BUCKET = "project-assets";
export const SWEEP_GRACE_MS = 3 * 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MAX_REMOVALS_PER_SWEEP = 500;
const REMOVE_BATCH = 100;

/** <workspace>/<time>-<name> or <workspace>/<project>/<time>-<name>. */
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const UPLOAD_NAME = new RegExp(`^${UUID}/(${UUID}/)?[0-9]+-[^/]+$`);
/** An upload path inside stored text (JSON, markdown, URLs), for Postgres. */
export const UPLOAD_MENTION = `(${UUID}/(?:${UUID}/)?[0-9]+-[A-Za-z0-9._-]+)`;

export type ReferenceSweepStore = {
  /** Upload objects created before `before` that nothing references, oldest first. */
  orphans(before: Date, limit: number): Promise<string[]>;
  /** Drops the asset rows of removed objects. */
  forget(paths: string[]): Promise<void>;
  close(): Promise<void>;
};

export type ReferenceSweepCounts = {
  orphaned: number;
  removed: number;
  failed: number;
};

export function createReferenceSweepStore(
  databaseUrl: string,
): ReferenceSweepStore {
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
        console.error("[reference-sweep] Idle database connection failed");
      });
    }
    return pool;
  };
  return {
    async orphans(before, limit) {
      // The name pattern is applied again in JS (UPLOAD_NAME) before any delete.
      // rtrim: a path at the end of a sentence picks up the full stop.
      const { rows } = await db().query(
        `WITH mentions AS (
           SELECT regexp_matches(j.payload::text, $5, 'g') AS m
             FROM public.background_jobs j
            WHERE j.purged_at IS NULL
           UNION ALL
           SELECT regexp_matches(cv.content::text, $5, 'g') FROM public.canvases cv
           UNION ALL
           SELECT regexp_matches(
                    concat_ws(' ', cm.content, cm.content_blocks::text, cm.tool_activities::text),
                    $5, 'g')
             FROM public.chat_messages cm
         ),
         used AS (
           SELECT m[1] AS name FROM mentions
           UNION
           SELECT rtrim(m[1], '._-') FROM mentions
         )
         SELECT o.name
           FROM storage.objects o
          WHERE o.bucket_id = $1
            AND o.created_at < $2
            AND o.name ~ $4
            AND NOT EXISTS (SELECT 1 FROM used u WHERE u.name = o.name)
          ORDER BY o.created_at
          LIMIT $3`,
        [BUCKET, before, limit, UPLOAD_NAME.source, UPLOAD_MENTION],
      );
      return rows.map((row) => String(row.name));
    },
    async forget(paths) {
      if (!paths.length) return;
      await db().query(
        `DELETE FROM public.asset_objects WHERE bucket = $1 AND object_path = ANY($2::text[])`,
        [BUCKET, paths],
      );
    },
    async close() {
      await pool?.end();
      pool = undefined;
    },
  };
}

export async function sweepUnusedReferences(deps: {
  store: Pick<ReferenceSweepStore, "orphans" | "forget">;
  remove: RemoveObjects;
  dryRun?: boolean;
  now?: () => number;
}): Promise<ReferenceSweepCounts> {
  const before = new Date((deps.now?.() ?? Date.now()) - SWEEP_GRACE_MS);
  // Only names of the upload pattern, whatever the query returned.
  const orphans = (
    await deps.store.orphans(before, MAX_REMOVALS_PER_SWEEP)
  ).filter((name) => UPLOAD_NAME.test(name));
  const counts: ReferenceSweepCounts = {
    orphaned: orphans.length,
    removed: 0,
    failed: 0,
  };
  if (deps.dryRun) {
    if (orphans.length)
      console.info(
        `[reference-sweep] dry run: would remove ${orphans.length} unused upload(s), e.g. ${orphans[0]}`,
      );
    return counts;
  }
  for (let index = 0; index < orphans.length; index += REMOVE_BATCH) {
    const batch = orphans.slice(index, index + REMOVE_BATCH);
    const { error } = await deps.remove(batch).catch((cause: unknown) => ({
      error: { message: String((cause as Error)?.message ?? cause) },
    }));
    if (error) {
      counts.failed += batch.length;
      console.warn(
        `[reference-sweep] ${batch.length} upload(s) not removed, retrying next run: ${error.message.slice(0, 200)}`,
      );
      continue;
    }
    await deps.store.forget(batch);
    counts.removed += batch.length;
  }
  return counts;
}

export function createReferenceSweeper(deps: {
  store: ReferenceSweepStore;
  remove: RemoveObjects;
  dryRun?: boolean;
}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<unknown> | undefined;
  let stopped = false;

  async function run() {
    const started = Date.now();
    const counts = await sweepUnusedReferences(deps);
    // Quiet when there is nothing to do.
    if (counts.orphaned)
      console.info(
        `[reference-sweep] ${deps.dryRun ? "dry run: " : ""}orphaned=${counts.orphaned} removed=${counts.removed} failed=${counts.failed} ms=${Date.now() - started}`,
      );
    return counts;
  }

  function schedule(ms: number) {
    if (stopped) return;
    timer = setTimeout(() => {
      running = run()
        .catch((error: unknown) =>
          console.error(
            `[reference-sweep] run failed: ${error instanceof Error ? error.message.slice(0, 200) : "unknown"}`,
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
    run,
    /** First run 5–10 minutes after start, then every six hours. */
    start() {
      schedule(300_000 + Math.floor(Math.random() * 300_000));
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await running;
      await deps.store.close();
    },
  };
}
