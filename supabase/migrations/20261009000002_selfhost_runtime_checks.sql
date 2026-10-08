-- Deployment readiness stays service-only and reports booleans, never account data.
CREATE OR REPLACE FUNCTION public.xy_runtime_readiness()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
SELECT jsonb_build_object(
  'schema', to_regclass('public.user_chat_providers') IS NOT NULL
    AND to_regclass('public.xy2api_accounts') IS NOT NULL
    AND to_regclass('langgraph.checkpoints') IS NOT NULL
    AND to_regclass('langgraph.store') IS NOT NULL,
  'queue', to_regclass('pgmq.q_image_generation_jobs') IS NOT NULL,
  'storage', (SELECT count(*) = 4 FROM storage.buckets WHERE id IN ('project-assets','brand-kit-assets','canvases','user-avatars')),
  'realtime', EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='background_jobs')
);
$$;
REVOKE ALL ON FUNCTION public.xy_runtime_readiness() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.xy_runtime_readiness() TO service_role;

-- A fresh self-hosted stack does not automatically publish application tables.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='background_jobs') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.background_jobs;
  END IF;
END $$;
