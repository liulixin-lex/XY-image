-- The 'canvases' storage bucket (20260327000001) let anyone list and read it
-- and let any signed-in user write anywhere in it. No code path uses it:
-- screenshots, thumbnails and generated images all live in 'project-assets'.
-- Keep the bucket (readiness counts it) but make it private and policy-free,
-- so only service_role can touch it. Existing objects are kept for audit.
-- TODO: drop the bucket and the readiness count once production confirms
-- `select count(*) from storage.objects where bucket_id = 'canvases'` is 0.
DROP POLICY IF EXISTS "canvases_select_public" ON storage.objects;
DROP POLICY IF EXISTS "canvases_insert_authenticated" ON storage.objects;
UPDATE storage.buckets SET public = false WHERE id = 'canvases';

-- Readiness now also fails when any storage policy is open to anonymous
-- callers or the canvases bucket becomes public again.
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
    WHERE n.nspname='public' AND c.relname IN ('xy2api_accounts','xy2api_api_keys','xy2api_preferences','user_chat_providers','agent_runs')
      AND (NOT c.relrowsecurity OR has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE')
        OR has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE'))
  )
  AND NOT has_table_privilege('authenticated','public.background_jobs','INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('anon','public.background_jobs','INSERT,UPDATE,DELETE')
  AND NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects' AND roles && ARRAY['public','anon']::name[]
  )
  AND NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id='canvases' AND public);
$$;
REVOKE ALL ON FUNCTION public.xy_runtime_permissions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.xy_runtime_permissions() TO service_role;
