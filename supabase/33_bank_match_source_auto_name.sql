-- Migration 33: allow source 'auto_name' on bank_match_links
--
-- The matcher gained a name tie-break pass (several same-date, same-amount
-- candidates, exactly one of which is named in the bank description). Links
-- it creates carry source = 'auto_name', which the check constraint from
-- migration 32 does not allow. This replaces that constraint with a wider
-- one; no data changes. Migration 32 is left untouched.
--
-- Idempotent: safe to re-run. Single-tenant. Requires migration 32.
-- TODO: fold into schema.sql during Step 16.

alter table public.bank_match_links
  drop constraint if exists bank_match_links_source_check;
alter table public.bank_match_links
  add constraint bank_match_links_source_check
  check (source in ('auto_utr', 'auto_exact', 'auto_name', 'auto_group', 'manual', 'backfill'));

-- ROLLBACK (fails if any 'auto_name' rows exist; re-source or delete them first):
--   alter table public.bank_match_links drop constraint if exists bank_match_links_source_check;
--   alter table public.bank_match_links add constraint bank_match_links_source_check
--     check (source in ('auto_utr', 'auto_exact', 'auto_group', 'manual', 'backfill'));
