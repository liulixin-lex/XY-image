import pg from "pg";

/**
 * A charged image whose storage write failed (M6). xy2api has already billed
 * it, so the bytes are kept in public.xy2api_pending_deliveries and the
 * worker retries the upload later. Nothing here ever calls xy2api again.
 */
export type HeldImage = {
  jobId: string;
  objectPath: string;
  mimeType: string;
  width: number;
  height: number;
  bytes: Buffer;
  /** Storage deliveries tried so far, including the one that led to the hold. */
  attempts: number;
};

export type PendingDeliveryStore = {
  /** Keeps the bytes of a first failed delivery (attempts = 1). Keeps an existing row as is. */
  hold(image: Omit<HeldImage, "attempts">, error: string): Promise<void>;
  get(jobId: string): Promise<HeldImage | null>;
  /** Counts one more failed delivery and returns the new total. */
  recordFailure(jobId: string, error: string): Promise<number>;
  /** Call only after the job's success is recorded. */
  remove(jobId: string): Promise<void>;
  close(): Promise<void>;
};

/** After this many failed deliveries the job fails as storage_failed; the row stays for manual recovery. */
export const MAX_DELIVERY_ATTEMPTS = 12;

/** Wait after the n-th failed delivery: 30 s, 1, 2, 4, 8 min, then 10 min (about 75 min in all). */
export function deliveryRetrySeconds(attempts: number) {
  return Math.min(600, 30 * 2 ** Math.max(0, attempts - 1));
}

/**
 * Talks to Postgres over SUPABASE_DB_URL: bytea would be hex-doubled through
 * PostgREST JSON, and the storage outage this covers may be the API gateway.
 */
export function createPendingDeliveryStore(
  databaseUrl: string,
): PendingDeliveryStore {
  let pool: pg.Pool | undefined;
  const db = () => {
    if (!pool) {
      pool = new pg.Pool({
        connectionString: databaseUrl,
        max: 2,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
        allowExitOnIdle: true,
      });
      pool.on("error", () => {
        console.error("[pending-delivery] Idle database connection failed");
      });
    }
    return pool;
  };
  return {
    async hold(image, error) {
      await db().query(
        `INSERT INTO public.xy2api_pending_deliveries
           (job_id, object_path, mime_type, width, height, bytes, last_error)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (job_id) DO NOTHING`,
        [
          image.jobId,
          image.objectPath,
          image.mimeType,
          image.width,
          image.height,
          image.bytes,
          error.slice(0, 500),
        ],
      );
    },
    async get(jobId) {
      const { rows } = await db().query(
        `SELECT object_path, mime_type, width, height, bytes, attempts
           FROM public.xy2api_pending_deliveries WHERE job_id = $1`,
        [jobId],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        jobId,
        objectPath: row.object_path,
        mimeType: row.mime_type,
        width: row.width,
        height: row.height,
        bytes: row.bytes,
        attempts: row.attempts,
      };
    },
    async recordFailure(jobId, error) {
      const { rows } = await db().query(
        `UPDATE public.xy2api_pending_deliveries
            SET attempts = attempts + 1, last_error = $2, updated_at = now()
          WHERE job_id = $1 RETURNING attempts`,
        [jobId, error.slice(0, 500)],
      );
      return rows[0]?.attempts ?? MAX_DELIVERY_ATTEMPTS;
    },
    async remove(jobId) {
      await db().query(
        "DELETE FROM public.xy2api_pending_deliveries WHERE job_id = $1",
        [jobId],
      );
    },
    async close() {
      await pool?.end();
      pool = undefined;
    },
  };
}
