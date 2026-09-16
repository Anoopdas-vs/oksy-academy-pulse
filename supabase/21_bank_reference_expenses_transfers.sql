-- ============================================================
-- Migration 21: bank_reference on expenses and transfers
-- ============================================================
-- Run ONCE in the Supabase SQL Editor, after 01-20.
--
-- Background: migration 20 added public.collections.bank_reference so a
-- successful bank-reconciliation match (auto-match or manual link/
-- classify — src/lib/reconcile.js and src/App.jsx) writes the full bank
-- statement description/reference onto the matched fee collection as a
-- permanent audit trail. That tracking was collections-only; this
-- migration extends the same column to public.expenses and
-- public.transfers (a cash deposit is recorded as a transfer) so every
-- record type staff reconcile against the bank statement carries its own
-- bank reference, for tallying bank balance vs book balance.
--
-- Unlike collections, neither expenses nor transfers is read through a
-- masking view — both are queried directly via `select("*")` in
-- src/lib/data.js (fetchExpenses / fetchTransfers) — so no view needs to
-- be recreated here, just the two ALTER TABLEs below.
--
-- RLS: bank_reference is a plain column on each table, so it inherits
-- whichever SELECT policy already exists there — no new policy needed,
-- and the existing difference between the two tables is preserved as-is:
--   * expenses_approved_select   — public.is_approved_user() (any approved
--     staff can see expenses, per schema.sql's "confidential" access model
--     for that table today).
--   * transfers_financial_viewer_select — public.can_view_financials()
--     (financial-access role only).
--
-- The app-side companion change (src/App.jsx, src/lib/reconcile.js) writes
-- bank_reference on expenses/transfers the same way it already does for
-- collections: on auto-match in uploadBankStatement, on manual link/
-- classify in classifyBankLine, and it's surfaced via the existing
-- "Matched" status tag hover tooltip (matchedRecordDetail) plus a new
-- "Bank Reference" column in the Reports tab's Excel/report export
-- (src/lib/reports.js) — deliberately NOT as an always-visible column on
-- the main ExpensesPage/BankingPage transfers grids.
--
-- Rollback:
--   alter table public.expenses drop column if exists bank_reference;
--   alter table public.transfers drop column if exists bank_reference;
-- ------------------------------------------------------------

begin;

alter table public.expenses
  add column if not exists bank_reference text;

alter table public.transfers
  add column if not exists bank_reference text;

commit;
