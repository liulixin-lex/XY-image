-- 作品 and 生成记录 can delete pictures (第 58 条).
--
-- A delete only stamps deleted_at: the row is the billing record (request id,
-- billing_status, the reconciler still settles a 待核对 job), so it is never
-- removed. Lists skip deleted rows, and the user can undo while purged_at is
-- null. After 24 hours the worker's deleted-works purge removes the picture
-- and its thumbnail from storage when no canvas or chat message still uses
-- them, and stamps purged_at either way (features/jobs/deleted-works-purge.ts).
--
-- Writes go through the API's service-role client only (authenticated users
-- have no UPDATE on background_jobs since 20261007000002).

alter table public.background_jobs
  add column if not exists deleted_at timestamptz,
  add column if not exists purged_at timestamptz;

comment on column public.background_jobs.deleted_at is
  'The user deleted this picture from 作品 / 生成记录 (第 58 条). Hidden from lists; the row stays as the billing record.';
comment on column public.background_jobs.purged_at is
  'The deleted-works purge ran for this job: its stored picture was removed, or kept because a canvas or chat still uses it.';

-- Lists: a user's visible jobs, newest first (GET /api/jobs, every page).
create index if not exists idx_background_jobs_visible
  on public.background_jobs (created_by, created_at desc)
  where deleted_at is null;

-- The purge: deleted jobs it has not handled yet.
create index if not exists idx_background_jobs_purge_due
  on public.background_jobs (deleted_at)
  where deleted_at is not null and purged_at is null;
