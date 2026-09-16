-- ============================================================
-- Migration 20: bank reconciliation matching improvements
-- ============================================================
-- Run ONCE in the Supabase SQL Editor, after 01-19b.
--
-- Background: the auto-matcher (src/lib/reconcile.js -> autoMatch) picked
-- the first app record with the same amount within a few days of a bank
-- statement line, without weighing the transaction date or the payer
-- identity embedded in the description. When two students paid the same
-- amount around the same date, it silently matched the wrong pair (see the
-- task brief "Fix Bank Reconciliation Matching Logic" — the Fahmida/Fasila
-- Rs 500 case, both paid Rs 500 a day apart, matched to each other).
--
-- The app-side fix (this migration's companion code change) now scores
-- candidates on date + payer-identity, and refuses to silently pick between
-- two same-amount/same-date candidates unless the identity signal clearly
-- points at one of them. Two schema changes support that:
--
--   * public.bank_statement_lines.status gains 'review' — an ambiguous
--     line lands here instead of being force-matched, until a human
--     confirms which record it belongs to via the existing "Classify"
--     flow (unchanged; 'review' is treated the same as 'unmatched' for
--     that purpose).
--   * public.bank_statement_lines.match_score — the winning candidate's
--     match confidence (0-1), kept for audit/debugging of the matcher;
--     not shown as a truth source in the UI, only a hint.
--   * public.collections.bank_reference — on every successful match (auto
--     or manual), the full bank statement description/reference is copied
--     here, so the fee collection record carries its own permanent audit
--     trail and staff can cross-check it against the bank statement
--     without opening the reconciliation screen. collections_basic must
--     be recreated to expose it (it lists columns explicitly).
--
-- Note: this is a new, additive migration on top of the existing
-- incremental set — per 01_PROJECT_CONTEXT_FOR_FEATURES_UI.md, it is NOT
-- folded into schema.sql now; that happens in the still-pending Step 16
-- schema.sql reconciliation pass, same as every migration since.
--
-- Rollback:
--   alter table public.collections drop column if exists bank_reference;
--   alter table public.bank_statement_lines drop column if exists match_score;
--   alter table public.bank_statement_lines drop constraint if exists bank_statement_lines_status_check;
--   alter table public.bank_statement_lines add constraint bank_statement_lines_status_check
--     check (status in ('unmatched', 'matched', 'classified', 'ignored'));
--   create or replace view public.collections_basic
--   with (security_barrier = true)
--   as
--   select id, student_id, student_name, date, type, amount, reference,
--     case when public.can_view_financials() or created_by = auth.uid() then account else null end as account
--   from public.collections
--   where public.is_approved_user();
-- ------------------------------------------------------------

begin;

alter table public.collections
  add column if not exists bank_reference text;

alter table public.bank_statement_lines
  add column if not exists match_score numeric;

alter table public.bank_statement_lines
  drop constraint if exists bank_statement_lines_status_check;
alter table public.bank_statement_lines
  add constraint bank_statement_lines_status_check
  check (status in ('unmatched', 'matched', 'classified', 'ignored', 'review'));

-- Recreate collections_basic to surface bank_reference. Same shape/owner/
-- security_barrier as 06_close_collections_view_bypass.sql — see that
-- migration's comments for why this is NOT security_invoker. bank_reference
-- is appended LAST in the select list (after the existing `account` CASE)
-- because CREATE OR REPLACE VIEW only allows adding columns at the end --
-- inserting it earlier renumbers `account` and Postgres errors with
-- "cannot change name of view column ... to ..." (42P16).
create or replace view public.collections_basic
with (security_barrier = true)
as
select
  id,
  student_id,
  student_name,
  date,
  type,
  amount,
  reference,
  case
    when public.can_view_financials() or created_by = auth.uid() then account
    else null
  end as account,
  bank_reference
from public.collections
where public.is_approved_user();

commit;
