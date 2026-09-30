-- ============================================================
-- Migration 31: run batch-status automation daily at 12:05 AM IST
-- ============================================================
-- Run ONCE in the Supabase SQL Editor, after 28b. One purpose: move the
-- nightly run_batch_status_automation() job to just after India midnight, so
-- statuses flip at the start of the day a batch starts / ends (the rule uses
-- the IST date).
--
-- 12:05 AM IST = 18:35 UTC of the previous day (India has no DST), so the
-- pg_cron expression is '35 18 * * *'. pg_cron always uses UTC.
--
-- Replaces, does not add: migration 28b scheduled the same job name at
-- '0 21 * * *' (02:30 IST). cron.schedule() upserts by job name, so this
-- moves that job instead of creating a second one, and re-running this file
-- never creates a duplicate.
--
-- Prerequisite: pg_cron must be enabled first in Dashboard -> Database ->
-- Extensions (search "pg_cron", toggle on). This file does not create the
-- extension: if it is missing it stops with a clear message, changes nothing,
-- and can be re-run after you enable it. On a project where 28b did not
-- schedule the job, this migration creates it.
--
-- Why the job is allowed to run the function: run_batch_status_automation()
-- accepts is_admin() OR (session_user = 'postgres' AND auth.uid() IS NULL).
-- pg_cron runs jobs as the role that scheduled them (postgres), with no JWT,
-- so the second branch passes; no auth.uid() is needed. updated_by on the
-- changed students is NULL for the scheduler (audit_log.changed_by too).
--
-- Security: no grants, policies or function bodies change. anon, authenticated
-- and service_role still cannot run the function through the API (a PostgREST
-- session_user is 'authenticator').
--
-- Rollback (stops the schedule; run the function by hand when needed):
--   select cron.unschedule('batch-auto-student-status');
-- To go back to the 28b time instead:
--   select cron.schedule('batch-auto-student-status', '0 21 * * *',
--     $cron$select public.run_batch_status_automation();$cron$);
-- ============================================================

begin;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'pg_cron is not enabled. Enable it in Dashboard -> Database -> Extensions -> pg_cron, then re-run this migration.';
  end if;
end $$;

select cron.schedule(
  'batch-auto-student-status',
  '35 18 * * *',
  $cron$select public.run_batch_status_automation();$cron$
);

commit;
