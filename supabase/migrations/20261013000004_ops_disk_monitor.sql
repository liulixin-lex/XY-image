-- 磁盘用量告警 (第 59 条, agent01).
--
-- The worker samples disk use every 10 minutes (features/ops/disk-monitor.ts):
-- the host filesystem the containers run on (statfs), the database size, and
-- what Storage holds by kind (generated pictures, uploads, canvas images,
-- brand kits). An alert opens when use passes the warning or critical
-- threshold and resolves when it drops back; admins (main-site role admin)
-- see both on the 管理 page and a banner, and an optional webhook is told.
--
-- Both tables are for the service role only: no grants to anon or
-- authenticated, RLS on with no policies. Samples older than 30 days are
-- deleted by the worker. Re-runnable.

create table if not exists public.ops_disk_samples (
  id bigint generated always as identity primary key,
  sampled_at timestamptz not null default now(),
  fs_total_bytes bigint not null,
  fs_used_bytes bigint not null,
  fs_avail_bytes bigint not null,
  db_bytes bigint,
  storage_bytes bigint,
  -- { "generated": n, "uploads": n, "canvas": n, "brand": n, "other": n }
  storage_by_kind jsonb not null default '{}'::jsonb,
  -- "local" (files on this disk) or "s3" (R2 / S3, not on this disk)
  object_storage text not null default 'local'
);

create index if not exists idx_ops_disk_samples_at
  on public.ops_disk_samples (sampled_at desc);

create table if not exists public.ops_alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  level text not null check (level in ('warning', 'critical')),
  message text not null,
  value numeric,
  threshold numeric,
  opened_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  notified_level text
);

-- One open alert per kind.
create unique index if not exists idx_ops_alerts_open_kind
  on public.ops_alerts (kind) where resolved_at is null;
create index if not exists idx_ops_alerts_opened
  on public.ops_alerts (opened_at desc);

alter table public.ops_disk_samples enable row level security;
alter table public.ops_alerts enable row level security;
revoke all on public.ops_disk_samples from anon, authenticated;
revoke all on public.ops_alerts from anon, authenticated;
grant all on public.ops_disk_samples to service_role;
grant all on public.ops_alerts to service_role;
