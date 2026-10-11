-- A run the user stopped is recorded as canceled (FINDINGS A5: it stayed
-- 'running' with no completed_at forever). Runs left 'accepted'/'running'
-- by a crash are swept to failed/interrupted by the API
-- (apps/server/src/features/agent-runs/stale-run-sweeper.ts); this also
-- settles the ones already stuck. Server only: no new grants.
ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_status_check;
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_status_check
  CHECK (status IN ('accepted', 'running', 'completed', 'failed', 'canceled'));

UPDATE public.agent_runs
   SET status = 'failed',
       error_code = 'interrupted',
       error_message = '运行中断，没有完成',
       completed_at = coalesce(completed_at, now())
 WHERE status IN ('accepted', 'running')
   AND created_at < now() - interval '1 hour';
