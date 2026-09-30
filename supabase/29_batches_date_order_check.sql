-- ============================================================
-- Migration 29: a batch's end date can't be before its start date
-- ============================================================
-- Run ONCE in the Supabase SQL Editor, after 28. Incremental, one purpose:
-- it adds a single CHECK constraint to public.batches and changes nothing
-- else (no data, no RLS, no functions).
--
--   batches_end_after_start:
--     end_date is null or start_date is null or end_date >= start_date
--
-- Added NOT VALID: existing rows are NOT scanned, so a batch that already has
-- end < start (production's BATCH 6) does not block the migration. From now on
-- the constraint is checked on every INSERT and on every UPDATE of a row, so
-- no new bad data can get in.
--
-- Consequence to know about: while such a legacy row exists, ANY update to it
-- (rename, archive, notes, fees) fails until its dates are corrected. Fixing
-- the dates in Admin -> Batches is allowed, because the corrected row passes.
-- The automation (migration 28) is unaffected: it still skips bad-date batches
-- and batch_status_data_issues() still lists them. Dates are never guessed or
-- auto-fixed.
--
-- After every legacy row is fixed you can make the constraint fully trusted:
--   alter table public.batches validate constraint batches_end_after_start;
--
-- Rollback:
--   alter table public.batches drop constraint batches_end_after_start;
-- ============================================================

begin;

alter table public.batches
  add constraint batches_end_after_start
  check (end_date is null or start_date is null or end_date >= start_date) not valid;

commit;
