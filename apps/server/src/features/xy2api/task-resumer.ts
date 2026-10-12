import pg from "pg";

/**
 * Hands async image tasks that nobody polls back to the worker (FINDINGS G7
 * step 2).
 *
 * A worker job resumes by itself: its PGMQ message comes back once the dead
 * worker's visibility timeout ends, and image-runner.ts polls the stored
 * task. A job sent from the API process (POST /api/agent/generate-image,
 * enqueue: false) has no message, so when that process stops mid-poll the
 * job would stay `running` for good while the picture is ready (and billed)
 * at the main site. Every minute this queues such jobs: billing still
 * pending, a task id, the poller's lease (xy2api_task_polled_at) older than
 * two minutes, and no message of their own. The worker then polls the same
 * task; nothing is sent again. Duplicate messages are harmless: the runner's
 * lease lets one poller through and parks the other.
 */
export type TaskResumer = { start(): void; stop(): Promise<void> };

const SWEEP_INTERVAL_MS = 60_000;
const SWEEP_BATCH = 20;

export function createTaskResumer(
  databaseUrl: string,
  options: { intervalMs?: number } = {},
): TaskResumer {
  let pool: pg.Pool | undefined;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;
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
        console.error("[task-resumer] Idle database connection failed");
      });
    }
    return pool;
  };
  const sweep = async () => {
    try {
      const { rows } = await db().query<{ id: string; msg_id: string }>(
        `WITH orphan AS (
           SELECT j.id, j.queue_name, j.job_type, j.workspace_id, j.canvas_id, j.session_id
             FROM public.background_jobs j
            WHERE j.job_type = 'image_generation'
              AND j.status = 'running'
              AND j.billing_status = 'pending'
              AND j.xy2api_task_id IS NOT NULL
              AND j.xy2api_task_polled_at < now() - interval '2 minutes'
              AND NOT EXISTS (
                SELECT 1 FROM pgmq.q_image_generation_jobs q
                 WHERE q.message->>'job_id' = j.id::text)
            ORDER BY j.xy2api_task_polled_at
            LIMIT $1
            FOR UPDATE OF j SKIP LOCKED)
         SELECT o.id,
                pgmq.send(o.queue_name, jsonb_strip_nulls(jsonb_build_object(
                  'job_id', o.id, 'job_type', o.job_type,
                  'workspace_id', o.workspace_id, 'canvas_id', o.canvas_id,
                  'session_id', o.session_id)))::text AS msg_id
           FROM orphan o`,
        [SWEEP_BATCH],
      );
      for (const row of rows)
        console.warn(
          `[task-resumer] job ${row.id}: async task had no poller for 2 minutes; queued for the worker (message ${row.msg_id})`,
        );
    } catch {
      // No details: a connection error may carry the database URL.
      console.error("[task-resumer] sweep failed");
    }
  };
  return {
    start() {
      if (timer) return;
      timer = setInterval(() => {
        if (running) return;
        running = sweep().finally(() => {
          running = undefined;
        });
      }, options.intervalMs ?? SWEEP_INTERVAL_MS);
      timer.unref();
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
      await running;
      await pool?.end();
      pool = undefined;
    },
  };
}
