-- ============================================================
-- Migration 28b: switch on batch-date status automation
-- ============================================================
-- Run AFTER 28, and (on production) only after the dry-run list from
-- preview_batch_status_changes() has been reviewed and approved. It enables
-- the two triggers created (disabled) by 28 and schedules the nightly backup
-- run. Changes no data by itself: the triggers act on later edits, and the
-- first scheduled run is at the next 21:00 UTC (02:30 IST). To apply the
-- approved list immediately, run: select public.run_batch_status_automation();
--
-- Rollback:
--   select cron.unschedule('batch-auto-student-status');
--   alter table public.students disable trigger students_follow_batch_dates;
--   alter table public.batches   disable trigger batches_resync_students;
-- ============================================================

begin;

create extension if not exists pg_cron;

alter table public.students enable trigger students_follow_batch_dates;
alter table public.batches   enable trigger batches_resync_students;

-- 21:00 UTC = 02:30 IST (India has no DST). cron.schedule() upserts by job
-- name, so re-running never creates a duplicate.
select cron.schedule(
  'batch-auto-student-status',
  '0 21 * * *',
  $cron$select public.run_batch_status_automation();$cron$
);

commit;
