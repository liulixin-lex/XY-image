import pg from "pg";

/**
 * Per-user dispatch gate for image jobs (worker side).
 *
 * The API admits up to LOOMIC_MAX_PENDING_IMAGE_JOBS queued or running jobs
 * per user (a studio batch of 4 is 4 jobs). This gate decides how many of
 * them are actually sent to the main site at once: LOOMIC_MAX_CONCURRENT_JOBS.
 * The rest stay `queued` with nothing sent, so the user can still cancel them
 * at no cost, and the worker looks at them again a few seconds later.
 *
 * One transaction per check, over SUPABASE_DB_URL (PostgREST has no
 * transactions):
 *   1. lock the job row; give up unless it is still queued,
 *   2. take a transaction advisory lock per user, so two workers (or two
 *      slots of one worker) cannot both see "1 running" and both start,
 *   3. count the user's other jobs that may be at the main site right now,
 *   4. below the limit: mark this job running (the worker's markRunning then
 *      changes nothing) and let it go.
 *
 * TODO(agent01): the sync /api/agent/generate-image route sends from the API
 * process and only checks the admission count (see BillingGuard sendsNow);
 * if that route stays, move it onto this gate as well.
 */
export type DispatchDecision =
  /** Marked running here; send it now. */
  | "claimed"
  /** The user already has `limit` jobs in flight; leave it queued. */
  | "busy"
  /** No longer queued (canceled, already running, done); let the worker decide. */
  | "not_queued";

export type DispatchGate = {
  claim(jobId: string, limit: number): Promise<DispatchDecision>;
  close(): Promise<void>;
};

/** Seconds a waiting job stays invisible before the worker checks it again. */
export const DISPATCH_RETRY_SECONDS = 3;

/**
 * A running job older than this is not in flight at the main site any more
 * (the provider gives up after ten minutes); it must not block the user's
 * queue for good if its process died before recording an outcome. The
 * reconciler and redelivery settle such jobs separately.
 */
export const STALE_RUNNING_MINUTES = 15;

export function createDispatchGate(databaseUrl: string): DispatchGate {
  let pool: pg.Pool | undefined;
  const db = () => {
    if (!pool) {
      pool = new pg.Pool({
        connectionString: databaseUrl,
        max: 3,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
        allowExitOnIdle: true,
      });
      pool.on("error", () => {
        console.error("[dispatch-gate] Idle database connection failed");
      });
    }
    return pool;
  };

  return {
    async claim(jobId, limit) {
      const client = await db().connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query<{
          created_by: string;
          status: string;
        }>(
          `SELECT created_by, status FROM public.background_jobs
            WHERE id = $1 FOR UPDATE`,
          [jobId],
        );
        const job = rows[0];
        if (!job || job.status !== "queued") {
          await client.query("ROLLBACK");
          return "not_queued";
        }
        await client.query(
          `SELECT pg_advisory_xact_lock(hashtextextended('xy-image-dispatch:' || $1::text, 0))`,
          [job.created_by],
        );
        const { rows: counted } = await client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM public.background_jobs
            WHERE created_by = $1
              AND job_type = 'image_generation'
              AND status = 'running'
              AND billing_status IN ('none', 'pending')
              AND id <> $2
              AND coalesce(started_at, created_at) > now() - make_interval(mins => $3)`,
          [job.created_by, jobId, STALE_RUNNING_MINUTES],
        );
        const inFlight = counted[0]?.n ?? 0;
        if (inFlight >= limit) {
          await client.query("ROLLBACK");
          return "busy";
        }
        await client.query(
          `UPDATE public.background_jobs
              SET status = 'running', started_at = now()
            WHERE id = $1`,
          [jobId],
        );
        await client.query("COMMIT");
        return "claimed";
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool?.end();
      pool = undefined;
    },
  };
}
