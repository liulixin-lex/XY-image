-- An image is charged the moment xy2api returns it. If writing it to storage
-- then fails, the server keeps the bytes here and the worker retries the
-- upload with backoff, so a paid result is never thrown away and never
-- regenerated. A row is deleted once the image is delivered; a row that runs
-- out of retries stays for manual recovery (docs/XY2API_OPERATIONS.md).
-- Server only: RLS on, no policies, no client grants. The worker reads and
-- writes it over SUPABASE_DB_URL (bytea does not go through PostgREST JSON).
CREATE TABLE IF NOT EXISTS public.xy2api_pending_deliveries (
  job_id uuid PRIMARY KEY REFERENCES public.background_jobs(id) ON DELETE CASCADE,
  object_path text NOT NULL,
  mime_type text NOT NULL CHECK (mime_type LIKE 'image/%'),
  width integer NOT NULL,
  height integer NOT NULL,
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 52428800),
  attempts integer NOT NULL DEFAULT 1,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.xy2api_pending_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.xy2api_pending_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.xy2api_pending_deliveries TO service_role;

-- Same checks as 20261009000004, plus the held-image table.
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
  AND NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects' AND roles && ARRAY['public','anon']::name[]
  )
  AND NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id='canvases' AND public);
$$;
REVOKE ALL ON FUNCTION public.xy_runtime_permissions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.xy_runtime_permissions() TO service_role;

-- Readiness 'schema' now also requires the held-image table.
CREATE OR REPLACE FUNCTION public.xy_runtime_readiness()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
SELECT jsonb_build_object(
  'schema', to_regclass('public.user_chat_providers') IS NOT NULL
    AND to_regclass('public.xy2api_accounts') IS NOT NULL
    AND to_regclass('public.xy2api_pending_deliveries') IS NOT NULL
    AND to_regclass('langgraph.checkpoints') IS NOT NULL AND to_regclass('langgraph.store') IS NOT NULL,
  'queue', to_regclass('pgmq.q_image_generation_jobs') IS NOT NULL,
  'storage', (SELECT count(*) = 4 FROM storage.buckets WHERE id IN ('project-assets','brand-kit-assets','canvases','user-avatars')),
  'realtime', EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='background_jobs'),
  'permissions', public.xy_runtime_permissions()
);
$$;
REVOKE ALL ON FUNCTION public.xy_runtime_readiness() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.xy_runtime_readiness() TO service_role;
