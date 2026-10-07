-- xy2api SSO / key sync / billing integration (2026-10-07)

-- 1. Account link: Supabase shadow user <-> xy2api user. Service role only.
create table if not exists public.xy2api_accounts (
  user_id                 uuid primary key references auth.users(id) on delete cascade,
  xy2api_user_id          bigint not null unique,
  email                   text not null,
  username                text,
  role                    text,
  status                  text not null default 'active',
  access_token_enc        text,
  access_token_expires_at timestamptz,
  refresh_token_enc       text,
  session_state           text not null default 'active'
                          check (session_state in ('active', 'reauth_required')),
  last_validated_at       timestamptz,
  last_login_at           timestamptz not null default now(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- 2. Synced API keys. secret_enc = AES-256-GCM ciphertext of the plaintext key.
create table if not exists public.xy2api_api_keys (
  user_id                uuid not null references auth.users(id) on delete cascade,
  key_id                 bigint not null,
  name                   text not null,
  masked_key             text not null,
  secret_enc             text not null,
  status                 text not null,
  group_id               bigint,
  group_name             text,
  platform               text,
  subscription_type      text,
  allow_image_generation boolean not null default false,
  image_capable          boolean not null default false,
  pricing                jsonb not null default '{}'::jsonb,
  image_models           text[] not null default '{}',
  chat_models            text[] not null default '{}',
  quota                  numeric(20,8) not null default 0,
  quota_used             numeric(20,8) not null default 0,
  expires_at             timestamptz,
  has_ip_restriction     boolean not null default false,
  invalid_reason         text,
  synced_at              timestamptz not null default now(),
  primary key (user_id, key_id)
);

-- 3. Per-user selection.
create table if not exists public.xy2api_preferences (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  image_key_id        bigint,
  chat_key_id         bigint,
  default_image_model text,
  default_chat_model  text,
  updated_at          timestamptz not null default now()
);

-- 4. Job billing trace (no plaintext, no tokens).
alter table public.background_jobs
  add column if not exists xy2api_key_id      bigint,
  add column if not exists xy2api_request_id  text,
  add column if not exists estimated_cost_usd numeric(20,8),
  add column if not exists billing_status     text not null default 'none';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'background_jobs_billing_status_check'
  ) then
    alter table public.background_jobs
      add constraint background_jobs_billing_status_check
      check (billing_status in ('none', 'pending', 'charged', 'not_charged', 'unknown'));
  end if;
end $$;

-- 5. Lock down: RLS on, no policies, no grants for client roles.
alter table public.xy2api_accounts    enable row level security;
alter table public.xy2api_api_keys    enable row level security;
alter table public.xy2api_preferences enable row level security;
revoke all on public.xy2api_accounts, public.xy2api_api_keys, public.xy2api_preferences
  from anon, authenticated;

-- 6. updated_at maintenance (function exists since foundation v1).
drop trigger if exists xy2api_accounts_set_updated_at on public.xy2api_accounts;
create trigger xy2api_accounts_set_updated_at
  before update on public.xy2api_accounts
  for each row execute function public.set_updated_at();

drop trigger if exists xy2api_preferences_set_updated_at on public.xy2api_preferences;
create trigger xy2api_preferences_set_updated_at
  before update on public.xy2api_preferences
  for each row execute function public.set_updated_at();

create index if not exists idx_xy2api_api_keys_user on public.xy2api_api_keys(user_id);
