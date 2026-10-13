-- Deleted 作品 that a canvas or chat still uses (第 58 条 follow-up, agent01).
--
-- The deleted-works purge used to stamp purged_at on a picture it kept
-- because a canvas or chat message still used it, so it was never looked at
-- again, even after that canvas dropped the picture. Now a kept picture gets
-- purge_checked_at instead and is checked again a week later; purged_at is
-- only stamped once the files are gone. Until then the delete can still be
-- undone (POST /api/jobs/restore checks purged_at).
--
-- Re-runnable.

alter table public.background_jobs
  add column if not exists purge_checked_at timestamptz;

comment on column public.background_jobs.purge_checked_at is
  'Last time the deleted-works purge found this deleted picture still used by a canvas or chat and kept it (第 58 条).';
