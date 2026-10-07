do $$
declare t text;
begin
  foreach t in array array['xy2api_accounts','xy2api_api_keys','xy2api_preferences'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception 'RLS missing on %',t; end if;
    if exists(select 1 from pg_policies where schemaname='public' and tablename=t) then raise exception 'Unexpected policy on %',t; end if;
    if has_table_privilege('authenticated','public.' || t,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'Client grant on %',t; end if;
    if not has_table_privilege('service_role','public.' || t,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'Service role grant missing on %',t; end if;
  end loop;
  if has_table_privilege('authenticated','public.background_jobs','UPDATE') or has_table_privilege('authenticated','public.background_jobs','INSERT') or has_table_privilege('authenticated','public.background_jobs','DELETE') then raise exception 'Browser can mutate job billing'; end if;
  if not has_table_privilege('authenticated','public.background_jobs','SELECT') then raise exception 'Realtime read grant missing'; end if;
end $$;
insert into auth.users values ('00000000-0000-0000-0000-000000000001');
set role service_role;
insert into public.xy2api_accounts(user_id,xy2api_user_id,email) values ('00000000-0000-0000-0000-000000000001',1,'fixture@example.com');
insert into public.background_jobs(id,created_by) values ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001');
update public.background_jobs set billing_status='pending' where id='00000000-0000-0000-0000-000000000002' and billing_status='none';
do $$ begin
  if not exists(select 1 from public.background_jobs where billing_status='pending') then raise exception 'Billing claim failed'; end if;
  begin
    update public.background_jobs set billing_status='invalid';
    raise exception 'Invalid billing status accepted';
  exception when check_violation then null;
  end;
end $$;
reset role;
select 'migration_rls_and_billing_checks_passed' as result;
