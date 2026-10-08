do $$ declare state jsonb; begin
  select public.xy_runtime_readiness() into state;
  if state <> '{"schema":true,"queue":true,"storage":true,"realtime":true,"permissions":true}'::jsonb then
    raise exception 'readiness checks not satisfied';
  end if;
  if has_function_privilege('anon','public.xy_runtime_readiness()','EXECUTE') or
     has_function_privilege('authenticated','public.xy_runtime_readiness()','EXECUTE') or
     not has_function_privilege('service_role','public.xy_runtime_readiness()','EXECUTE') then
    raise exception 'readiness function grants invalid';
  end if;
end $$;
select 'selfhost_readiness_and_publication_checks_passed' as result;

do $$ begin
  if has_function_privilege('authenticated','public.grant_plan_credits(uuid)','EXECUTE')
    or not has_function_privilege('service_role','public.increment_job_attempt(uuid)','EXECUTE')
    or has_table_privilege('authenticated','public.credit_balances','SELECT') then
    raise exception 'retired RPC permissions not locked down';
  end if;
end $$;
begin;
grant execute on function public.grant_plan_credits(uuid) to authenticated;
do $$ begin
  if public.xy_runtime_permissions() then raise exception 'permission drift not detected'; end if;
end $$;
rollback;
select 'retired_rpc_and_permission_drift_checks_passed' as result;
