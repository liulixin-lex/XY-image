import pg from "pg";
import type { AccountService } from "./account-service.js";
import type { UsageLookup, Xy2apiClient } from "./client.js";
import { BillingGuardError, Xy2apiError } from "./errors.js";

// 待核对 reconciliation. An image job whose billing outcome is unknown but
// which carries xy2api's X-Client-Request-ID can be settled from the user's
// own usage list: xy2api writes request_id "client:<id>" on every billed
// request (__fixtures__/0.2.5/billing.json). The worker sweeps such jobs:
//   - a matching usage row → charged (positive evidence, at any age);
//   - no row in a complete scan once the job is RECONCILE_SETTLE_MS old →
//     not_charged. xy2api retries usage writes every 5 s and raises an alarm
//     after 60 s (usage_billing_recovery.go), so a day without a row is
//     conclusive;
//   - anything else (no session, rate limit, page cap, wire drift) → retried
//     on a later sweep, and the job stays 待核对.
// Jobs without a request id (Cloudflare cut the call after ~125 s, or the
// worker died mid-call; FINDINGS G7/R1) are matched by shape instead:
// xy2api ignores request ids sent by clients, but its row records the key,
// the requested model, the 画质 and our User-Agent. Exactly one row of that
// shape written between enqueue and 30 minutes after the failure, and not
// tied to another job → charged, and its id is kept on the job. Several
// rows → no conclusion (stays 待核对). None in a complete scan a day later →
// not charged, as above.
// TODO(agent01): show the matched row's actual_cost on the job once the UI
// has a place for it; today it is only logged.
// TODO(agent01): two id-less jobs of one shape in one window stay 待核对
// (ambiguous); settle them together if that ever shows up in the logs.

export type UnsettledJob = {
  id: string;
  userId: string;
  keyId: number | null;
  /** null: xy2api's id never came back; matched by shape */
  requestId: string | null;
  /** payload model and 画质, for shape matching */
  model?: string | null;
  resolution?: string | null;
  /** dispatch time (background_jobs.started_at) */
  startedAt?: Date | null;
  createdAt: Date;
  endedAt: Date;
};

export type ReconcileStore = {
  /** Claims due 待核对 jobs and stamps billing_checked_at (safe across workers). */
  claim(limit: number): Promise<UnsettledJob[]>;
  /**
   * unknown → charged / not_charged; false when the job no longer is
   * unknown. `requestId` (a shape match) is kept when the job has none.
   */
  settle(
    jobId: string,
    status: "charged" | "not_charged",
    requestId?: string | null,
  ): Promise<boolean>;
  /** xy2api request ids already on the user's jobs created in the window. */
  attributedRequestIds(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<Set<string>>;
  close(): Promise<void>;
};

/** Usage rows of an id-less job: written from dispatch to this long after it failed. */
export const SHAPE_MATCH_AFTER_MS = 30 * 60 * 1000;
/** Clock difference allowed between this server and the main site. */
const CLOCK_SKEW_MS = 2 * 60 * 1000;

export const RECONCILE_SETTLE_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const SWEEP_BATCH = 20;

/**
 * Due = settled for 2 minutes, then checked every 10 minutes while the job is
 * under 2 hours old and every 2 hours after that, for up to 7 days. Claims use
 * SKIP LOCKED, so several workers never check the same job at once.
 */
export function createReconcileStore(databaseUrl: string): ReconcileStore {
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
        console.error("[xy2api-reconcile] Idle database connection failed");
      });
    }
    return pool;
  };
  return {
    async claim(limit) {
      const { rows } = await db().query(
        `WITH due AS (
           SELECT id FROM public.background_jobs
            WHERE billing_status = 'unknown'
              AND (xy2api_request_id IS NOT NULL OR started_at IS NOT NULL)
              AND job_type = 'image_generation'
              AND created_by IS NOT NULL
              AND created_at > now() - interval '7 days'
              AND updated_at < now() - interval '2 minutes'
              AND (billing_checked_at IS NULL
                   OR billing_checked_at < now() - CASE
                        WHEN created_at > now() - interval '2 hours'
                        THEN interval '10 minutes' ELSE interval '2 hours' END)
            ORDER BY billing_checked_at NULLS FIRST, created_at
            LIMIT $1
            FOR UPDATE SKIP LOCKED)
         UPDATE public.background_jobs j SET billing_checked_at = now()
           FROM due WHERE j.id = due.id
         RETURNING j.id, j.created_by, j.xy2api_key_id, j.xy2api_request_id,
                   j.payload->>'model' AS model, j.payload->>'resolution' AS resolution,
                   j.started_at, j.created_at,
                   coalesce(j.failed_at, j.completed_at, j.created_at) AS ended_at`,
        [limit],
      );
      return rows.map((row) => ({
        id: row.id,
        userId: row.created_by,
        // bigint arrives as a string
        keyId: row.xy2api_key_id == null ? null : Number(row.xy2api_key_id),
        requestId: row.xy2api_request_id ?? null,
        model: row.model ?? null,
        resolution: row.resolution ?? null,
        startedAt: row.started_at ?? null,
        createdAt: row.created_at,
        endedAt: row.ended_at,
      }));
    },
    async settle(jobId, status, requestId) {
      const { rowCount } = await db().query(
        `UPDATE public.background_jobs
            SET billing_status = $2,
                xy2api_request_id = coalesce(xy2api_request_id, $3)
          WHERE id = $1 AND billing_status = 'unknown'`,
        [jobId, status, requestId ?? null],
      );
      return rowCount === 1;
    },
    async attributedRequestIds(userId, from, to) {
      const { rows } = await db().query(
        `SELECT xy2api_request_id FROM public.background_jobs
          WHERE created_by = $1 AND xy2api_request_id IS NOT NULL
            AND created_at BETWEEN $2 AND $3`,
        [userId, from, to],
      );
      return new Set(rows.map((row) => String(row.xy2api_request_id)));
    },
    async close() {
      await pool?.end();
      pool = undefined;
    },
  };
}

type Deps = {
  store: Pick<ReconcileStore, "claim" | "settle"> &
    Partial<Pick<ReconcileStore, "attributedRequestIds">>;
  client: Pick<Xy2apiClient, "findUsage"> &
    Partial<Pick<Xy2apiClient, "findUsageByShape">>;
  accounts: Pick<AccountService, "withAccess">;
  now?: () => number;
};

export type ReconcileOutcome = "charged" | "not_charged" | "waiting";

export async function reconcileJob(
  job: UnsettledJob,
  deps: Deps,
): Promise<ReconcileOutcome> {
  if (!job.requestId) return reconcileByShape(job, deps);
  const requestId = job.requestId;
  const now = deps.now?.() ?? Date.now();
  // One day of margin on each side keeps the row inside the window even if
  // a release ignores timezone=UTC and cuts days in its own zone.
  const input = {
    requestId,
    from: new Date(job.createdAt.getTime() - DAY_MS),
    to: new Date(job.endedAt.getTime() + DAY_MS),
  };
  const lookup: UsageLookup = await deps.accounts.withAccess(
    job.userId,
    async (token) => {
      if (!job.keyId) return deps.client.findUsage(token, input);
      try {
        return await deps.client.findUsage(token, {
          ...input,
          apiKeyId: job.keyId,
        });
      } catch (error) {
        // The key was deleted on the main site; its rows still list for the user.
        if (error instanceof Xy2apiError && [403, 404].includes(error.status))
          return deps.client.findUsage(token, input);
        throw error;
      }
    },
  );
  if (lookup.kind === "found") {
    if (await deps.store.settle(job.id, "charged"))
      console.info(
        `[xy2api-reconcile] job ${job.id} charged: usage row ${lookup.usageId ?? "?"} actual_cost=${lookup.actualCost ?? "?"}`,
      );
    return "charged";
  }
  if (
    lookup.kind === "absent" &&
    now - job.endedAt.getTime() >= RECONCILE_SETTLE_MS
  ) {
    if (await deps.store.settle(job.id, "not_charged"))
      console.info(
        `[xy2api-reconcile] job ${job.id} not charged: no usage row after ${Math.round((now - job.endedAt.getTime()) / 3_600_000)}h`,
      );
    return "not_charged";
  }
  return "waiting";
}

/** R1: a 待核对 job without xy2api's request id, matched by shape. */
async function reconcileByShape(
  job: UnsettledJob,
  deps: Deps,
): Promise<ReconcileOutcome> {
  const now = deps.now?.() ?? Date.now();
  const findByShape = deps.client.findUsageByShape?.bind(deps.client);
  if (!job.model || !job.startedAt || !findByShape) return "waiting";
  const model = job.model;
  // From enqueue: a job picked up again after a worker crash gets a new
  // started_at, later than the call that was actually paid for.
  const after = new Date(
    Math.min(job.createdAt.getTime(), job.startedAt.getTime()) - CLOCK_SKEW_MS,
  );
  const before = new Date(job.endedAt.getTime() + SHAPE_MATCH_AFTER_MS);
  // Rows already tied to the user's other jobs (a twin that succeeded) are
  // not candidates.
  const exclude =
    (await deps.store.attributedRequestIds?.(
      job.userId,
      new Date(after.getTime() - DAY_MS),
      new Date(before.getTime() + DAY_MS),
    )) ?? new Set<string>();
  const input = {
    model,
    imageSize: job.resolution ?? undefined,
    after,
    before,
    exclude,
  };
  const match = await deps.accounts.withAccess(job.userId, async (token) => {
    if (!job.keyId) return findByShape(token, input);
    try {
      return await findByShape(token, { ...input, apiKeyId: job.keyId });
    } catch (error) {
      if (error instanceof Xy2apiError && [403, 404].includes(error.status))
        return findByShape(token, input);
      throw error;
    }
  });
  if (match.kind === "found") {
    if (await deps.store.settle(job.id, "charged", match.requestId))
      console.info(
        `[xy2api-reconcile] job ${job.id} charged (matched by key/model/size/time, no request id): usage row ${match.usageId ?? "?"} request ${match.requestId ?? "?"} actual_cost=${match.actualCost ?? "?"}`,
      );
    return "charged";
  }
  if (match.kind === "ambiguous") {
    console.warn(
      `[xy2api-reconcile] job ${job.id} has ${match.candidates} usage rows of its shape (${model} ${job.resolution ?? "?"}, key ${job.keyId ?? "?"}); stays 待核对`,
    );
    return "waiting";
  }
  if (
    match.kind === "absent" &&
    now - job.endedAt.getTime() >= RECONCILE_SETTLE_MS
  ) {
    if (await deps.store.settle(job.id, "not_charged"))
      console.info(
        `[xy2api-reconcile] job ${job.id} not charged: no usage row of its shape after ${Math.round((now - job.endedAt.getTime()) / 3_600_000)}h`,
      );
    return "not_charged";
  }
  return "waiting";
}

export function createBillingReconciler(
  deps: Deps & { store: ReconcileStore },
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<unknown> | undefined;
  let stopped = false;

  async function sweep() {
    const jobs = await deps.store.claim(SWEEP_BATCH);
    const counts = { charged: 0, not_charged: 0, waiting: 0, skipped: 0 };
    // Users whose session or heavy-query budget is gone: try them next sweep.
    const blocked = new Set<string>();
    for (const job of jobs) {
      if (stopped || blocked.has(job.userId)) {
        counts.skipped += 1;
        continue;
      }
      try {
        counts[await reconcileJob(job, deps)] += 1;
      } catch (error) {
        counts.skipped += 1;
        const reason =
          error instanceof Xy2apiError
            ? `${error.status} ${error.id}`
            : error instanceof BillingGuardError
              ? error.code
              : "unexpected error";
        if (
          error instanceof BillingGuardError ||
          (error instanceof Xy2apiError && error.status === 429)
        )
          blocked.add(job.userId);
        console.warn(
          `[xy2api-reconcile] job ${job.id} not checked (${reason}); retrying on a later sweep`,
        );
      }
    }
    if (jobs.length)
      console.info(
        `[xy2api-reconcile] checked ${jobs.length} 待核对 job(s): charged=${counts.charged} not_charged=${counts.not_charged} waiting=${counts.waiting} skipped=${counts.skipped}`,
      );
    return counts;
  }

  function schedule(ms: number) {
    if (stopped) return;
    timer = setTimeout(() => {
      running = sweep()
        .catch(() =>
          console.error(
            "[xy2api-reconcile] sweep failed (database unavailable or migration 20261009000006 missing)",
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
    /** First sweep 1–2 minutes after start, then every 5 minutes. */
    start() {
      schedule(60_000 + Math.floor(Math.random() * 60_000));
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await running;
      await deps.store.close();
    },
  };
}
