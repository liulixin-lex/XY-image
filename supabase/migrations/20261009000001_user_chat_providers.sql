-- Personal chat-only providers. Image billing always remains on xy2api.
create table if not exists public.user_chat_providers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  protocol text not null check (protocol = 'openai_compatible'),
  base_url text not null check (char_length(base_url) between 1 and 300),
  secret_enc text not null,
  key_hint text not null check (char_length(key_hint) = 4),
  models text[] not null default '{}' check (cardinality(models) <= 200),
  models_source text not null check (models_source in ('fetched', 'manual')),
  enabled boolean not null default true,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name),
  unique (user_id, id)
);

alter table public.user_chat_providers enable row level security;
revoke all on public.user_chat_providers from anon, authenticated;
grant all on public.user_chat_providers to service_role;
drop trigger if exists user_chat_providers_set_updated_at on public.user_chat_providers;
create trigger user_chat_providers_set_updated_at before update on public.user_chat_providers
  for each row execute function public.set_updated_at();

alter table public.xy2api_preferences add column if not exists default_chat_provider_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint
    where conrelid = 'public.xy2api_preferences'::regclass
      and conname = 'xy2api_preferences_chat_provider_owner_fk') then
    alter table public.xy2api_preferences add constraint xy2api_preferences_chat_provider_owner_fk
      foreign key (user_id, default_chat_provider_id)
      references public.user_chat_providers(user_id, id);
  end if;
end $$;

-- Atomic deletion: clear both halves of the preference before removing the provider.
-- Also runs for auth.users cascades. No client-executable SECURITY DEFINER function.
create or replace function public.clear_deleted_chat_provider_preference()
returns trigger language plpgsql set search_path = '' as $$
begin
  update public.xy2api_preferences
    set default_chat_provider_id = null, default_chat_model = null
    where user_id = old.user_id and default_chat_provider_id = old.id;
  return old;
end $$;
revoke all on function public.clear_deleted_chat_provider_preference() from public, anon, authenticated;
drop trigger if exists user_chat_providers_clear_preference on public.user_chat_providers;
create trigger user_chat_providers_clear_preference before delete on public.user_chat_providers
  for each row execute function public.clear_deleted_chat_provider_preference();

-- The service also checks this limit. Serialize concurrent inserts in the database.
create or replace function public.enforce_chat_provider_limit()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text, 903));
  if (select count(*) from public.user_chat_providers where user_id = new.user_id) >= 10 then
    raise exception 'provider_limit_reached' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.enforce_chat_provider_limit() from public, anon, authenticated;
drop trigger if exists user_chat_providers_limit on public.user_chat_providers;
create trigger user_chat_providers_limit before insert on public.user_chat_providers
  for each row execute function public.enforce_chat_provider_limit();

comment on column public.user_chat_providers.secret_enc is
  'AES-256-GCM with AAD loomic:chat-provider:v1:<user_id>:<provider_id>; never returned to clients';
