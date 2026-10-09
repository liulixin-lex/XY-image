-- 待核对 reconciliation. The worker settles image jobs whose billing outcome
-- is unknown but which carry xy2api's request id, by finding (or, after a
-- day, not finding) the matching row in the user's xy2api usage list.
-- billing_checked_at spaces the checks out and lets several workers share
-- the sweep (FOR UPDATE SKIP LOCKED). Server only: no new grants.
-- See apps/server/src/features/xy2api/billing-reconciler.ts.
ALTER TABLE public.background_jobs
  ADD COLUMN IF NOT EXISTS billing_checked_at timestamptz;

CREATE INDEX IF NOT EXISTS background_jobs_billing_reconcile_idx
  ON public.background_jobs (billing_checked_at NULLS FIRST, created_at)
  WHERE billing_status = 'unknown' AND xy2api_request_id IS NOT NULL;
