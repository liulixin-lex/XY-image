-- Async image tasks at the main site (FINDINGS G7 step 2; user requests
-- 53/54). An image job sent as an xy2api task stores the task id with its
-- 202, before polling, so a restarted worker (or the worker, for a job the
-- API process was polling when it stopped) polls the same task instead of
-- sending again. xy2api_task_polled_at is the poller's lease, renewed every
-- 15 s; a resumer takes over only once it is a minute old.
-- See apps/server/src/features/xy2api/image-task.ts and image-runner.ts.
-- Server only: no new grants.
ALTER TABLE public.background_jobs
  ADD COLUMN IF NOT EXISTS xy2api_task_id text,
  ADD COLUMN IF NOT EXISTS xy2api_task_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS xy2api_task_polled_at timestamptz;

-- The worker's resume sweep: tasks still being waited for.
CREATE INDEX IF NOT EXISTS background_jobs_xy2api_task_idx
  ON public.background_jobs (xy2api_task_polled_at)
  WHERE billing_status = 'pending' AND xy2api_task_id IS NOT NULL;
