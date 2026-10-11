-- 待核对 jobs without xy2api's request id (Cloudflare cut the call after
-- ~125 s, or the worker died mid-call) are now reconciled too, matched by
-- key, model, 画质 and time in the user's usage list (FINDINGS G7/R1,
-- apps/server/src/features/xy2api/billing-reconciler.ts). Widen the sweep's
-- partial index to every unknown job. Server only: no new grants.
DROP INDEX IF EXISTS public.background_jobs_billing_reconcile_idx;

CREATE INDEX IF NOT EXISTS background_jobs_billing_reconcile_idx
  ON public.background_jobs (billing_checked_at NULLS FIRST, created_at)
  WHERE billing_status = 'unknown';
