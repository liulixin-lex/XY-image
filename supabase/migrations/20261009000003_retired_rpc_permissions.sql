-- UI removal alone does not disable RPCs exposed through PostgREST.
-- Preserve historical tables/functions for audit; only service_role can invoke retired billing operations.
DO $$ DECLARE fn regprocedure; BEGIN
  FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN (
      'deduct_credits','refund_credits','claim_daily_credits','grant_plan_credits','increment_job_attempt'
    ) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',fn);
  END LOOP;
END $$;
REVOKE ALL ON public.subscriptions, public.credit_balances, public.credit_transactions,
  public.daily_credit_claims, public.payment_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.subscriptions, public.credit_balances, public.credit_transactions,
  public.daily_credit_claims, public.payment_events TO service_role;

REVOKE ALL ON public.xy2api_accounts, public.xy2api_api_keys, public.xy2api_preferences,
  public.user_chat_providers, public.agent_runs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.xy2api_accounts, public.xy2api_api_keys, public.xy2api_preferences,
  public.user_chat_providers, public.agent_runs TO service_role;
REVOKE ALL ON SCHEMA langgraph FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA langgraph FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA langgraph FROM PUBLIC, anon, authenticated;

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
  AND NOT has_table_privilege('anon','public.background_jobs','INSERT,UPDATE,DELETE');
$$;
REVOKE ALL ON FUNCTION public.xy_runtime_permissions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.xy_runtime_permissions() TO service_role;

CREATE OR REPLACE FUNCTION public.xy_runtime_readiness()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
SELECT jsonb_build_object(
  'schema', to_regclass('public.user_chat_providers') IS NOT NULL
    AND to_regclass('public.xy2api_accounts') IS NOT NULL
    AND to_regclass('langgraph.checkpoints') IS NOT NULL AND to_regclass('langgraph.store') IS NOT NULL,
  'queue', to_regclass('pgmq.q_image_generation_jobs') IS NOT NULL,
  'storage', (SELECT count(*) = 4 FROM storage.buckets WHERE id IN ('project-assets','brand-kit-assets','canvases','user-avatars')),
  'realtime', EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='background_jobs'),
  'permissions', public.xy_runtime_permissions()
);
$$;
REVOKE ALL ON FUNCTION public.xy_runtime_readiness() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.xy_runtime_readiness() TO service_role;
