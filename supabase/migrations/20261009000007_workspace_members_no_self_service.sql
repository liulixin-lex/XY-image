-- Workspace membership is not self-service. There is no invite flow: every
-- membership is created by public.bootstrap_viewer (SECURITY DEFINER) when a
-- user first signs in. The owner INSERT/UPDATE policies from 20260323000001
-- let any signed-in user add someone else to their own workspace (or repoint
-- a membership row at another user). The added user's RLS then showed two
-- "personal" workspaces, and the agent runtime's unscoped lookup could store
-- that user's generated images in the other user's workspace (fixed in code
-- in the same change; this removes the cause). Owners can still remove
-- members (DELETE is unchanged). Found by the two-user isolation drill
-- (xy-ops/agent01/e2e/probe-isolation.mjs, probe-agent-workspace.mjs).
DROP POLICY IF EXISTS "workspace_members_insert_owner" ON public.workspace_members;
DROP POLICY IF EXISTS "workspace_members_update_owner" ON public.workspace_members;
REVOKE INSERT, UPDATE ON public.workspace_members FROM PUBLIC, anon, authenticated;

-- Same checks as 20261009000005, plus: clients cannot add or change
-- workspace memberships.
CREATE OR REPLACE FUNCTION public.xy_runtime_permissions()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
SELECT
  NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('deduct_credits','refund_credits','claim_daily_credits','grant_plan_credits','increment_job_attempt')
      AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'))
  )
  AND NOT has_schema_privilege('authenticated','langgraph','USAGE')
  AND NOT has_schema_privilege('anon','langgraph','USAGE')
  AND NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('xy2api_accounts','xy2api_api_keys','xy2api_preferences','user_chat_providers','agent_runs','xy2api_pending_deliveries')
      AND (NOT c.relrowsecurity OR has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE')
        OR has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE'))
  )
  AND NOT has_table_privilege('authenticated','public.background_jobs','INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('anon','public.background_jobs','INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('authenticated','public.workspace_members','INSERT,UPDATE')
  AND NOT has_table_privilege('anon','public.workspace_members','INSERT,UPDATE')
  AND NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects' AND roles && ARRAY['public','anon']::name[]
  )
  AND NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id='canvases' AND public);
$$;
REVOKE ALL ON FUNCTION public.xy_runtime_permissions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.xy_runtime_permissions() TO service_role;
