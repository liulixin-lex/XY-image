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

do $$ begin
  if exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'canvases_%')
    or exists (select 1 from storage.buckets where id='canvases' and public) then
    raise exception 'canvases bucket not locked down';
  end if;
end $$;
begin;
create policy drift_anon_read on storage.objects for select to anon using (true);
do $$ begin
  if public.xy_runtime_permissions() then raise exception 'anonymous storage policy drift not detected'; end if;
end $$;
rollback;
begin;
update storage.buckets set public = true where id = 'canvases';
do $$ begin
  if public.xy_runtime_permissions() then raise exception 'public canvases bucket drift not detected'; end if;
end $$;
rollback;
select 'canvases_bucket_lockdown_checks_passed' as result;

do $$ begin
  if not (select relrowsecurity from pg_class where oid = 'public.xy2api_pending_deliveries'::regclass)
    or has_table_privilege('anon','public.xy2api_pending_deliveries','SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated','public.xy2api_pending_deliveries','SELECT,INSERT,UPDATE,DELETE')
    or not has_table_privilege('service_role','public.xy2api_pending_deliveries','SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'pending deliveries table not server-only';
  end if;
end $$;
begin;
grant select on public.xy2api_pending_deliveries to authenticated;
do $$ begin
  if public.xy_runtime_permissions() then raise exception 'pending deliveries grant drift not detected'; end if;
end $$;
rollback;
begin;
insert into public.background_jobs(id) values ('00000000-0000-4000-8000-000000000005');
insert into public.xy2api_pending_deliveries(job_id, object_path, mime_type, width, height, bytes)
  values ('00000000-0000-4000-8000-000000000005', 'w/generated/j.png', 'image/png', 1, 1, '\x89'::bytea);
delete from public.background_jobs where id = '00000000-0000-4000-8000-000000000005';
do $$ begin
  if exists (select 1 from public.xy2api_pending_deliveries) then raise exception 'held image not removed with its job'; end if;
end $$;
rollback;
begin;
insert into public.background_jobs(id) values ('00000000-0000-4000-8000-000000000006');
do $$ begin
  insert into public.xy2api_pending_deliveries(job_id, object_path, mime_type, width, height, bytes)
    values ('00000000-0000-4000-8000-000000000006', 'w/generated/j.png', 'image/png', 1, 1, ''::bytea);
  raise exception 'empty held image accepted';
exception when check_violation then null;
end $$;
rollback;
select 'pending_deliveries_checks_passed' as result;
