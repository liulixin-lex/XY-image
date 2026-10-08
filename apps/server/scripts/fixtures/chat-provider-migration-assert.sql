do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.user_chat_providers'::regclass)
    then raise exception 'Provider RLS missing'; end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename='user_chat_providers')
    then raise exception 'Unexpected provider client policy'; end if;
  if has_table_privilege('anon', 'public.user_chat_providers','SELECT,INSERT,UPDATE,DELETE') or
    has_table_privilege('authenticated', 'public.user_chat_providers','SELECT,INSERT,UPDATE,DELETE')
    then raise exception 'Client can access provider credentials'; end if;
  if not has_table_privilege('service_role', 'public.user_chat_providers','SELECT,INSERT,UPDATE,DELETE')
    then raise exception 'Service role cannot access provider table'; end if;
  if has_function_privilege('authenticated', 'public.clear_deleted_chat_provider_preference()', 'EXECUTE') or
    has_function_privilege('authenticated', 'public.enforce_chat_provider_limit()', 'EXECUTE')
    then raise exception 'Client can execute trigger function'; end if;
end $$;
insert into auth.users values
  ('00000000-0000-4000-8000-000000000003'), ('00000000-0000-4000-8000-000000000004');
set role service_role;
insert into public.user_chat_providers (id,user_id,name,protocol,base_url,secret_enc,key_hint,models,models_source)
values ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000003',
  'Fixture','openai_compatible','https://api.example.com/v1','fixture-encrypted','test','{model}','manual');
insert into public.xy2api_preferences(user_id,default_chat_provider_id,default_chat_model)
values ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000005','model');
do $$
begin
  begin
    insert into public.xy2api_preferences(user_id,default_chat_provider_id,default_chat_model)
    values ('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005','model');
    raise exception 'Cross-user provider preference accepted';
  exception when foreign_key_violation then null;
  end;
end $$;
delete from public.user_chat_providers where id='00000000-0000-4000-8000-000000000005';
do $$
begin
  if exists(select 1 from public.xy2api_preferences
    where user_id='00000000-0000-4000-8000-000000000003'
      and (default_chat_provider_id is not null or default_chat_model is not null))
    then raise exception 'Delete left stale preference'; end if;
end $$;
insert into public.user_chat_providers(user_id,name,protocol,base_url,secret_enc,key_hint,models_source)
select '00000000-0000-4000-8000-000000000003', 'Provider ' || n, 'openai_compatible',
  'https://api.example.com/v1','fixture-encrypted','test','manual' from generate_series(1,10) n;
do $$
begin
  begin
    insert into public.user_chat_providers(user_id,name,protocol,base_url,secret_enc,key_hint,models_source)
    values ('00000000-0000-4000-8000-000000000003','Overflow','openai_compatible',
      'https://api.example.com/v1','fixture-encrypted','test','manual');
    raise exception 'Limit failed to reject 11th provider';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'provider_limit_reached' then raise; end if;
  end;
end $$;
reset role;
select 'chat_provider_rls_ownership_delete_and_limit_checks_passed' as result;
