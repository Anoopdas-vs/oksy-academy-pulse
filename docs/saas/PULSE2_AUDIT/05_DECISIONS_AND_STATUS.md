# 05 — Decisions & Current Status (living document)

> Read this first in any new chat. Updated 2026-10-21.

## Current status

| Phase | Status |
|---|---|
| Phase 0 — Audit (`00`–`03`) | **Done**, delivered 2026-10-06 (audit predates the changes listed below) |
| Phase 1 — Security hot-fixes | **Plan written** (`04_PHASE1_SECURITY_HOTFIX_PLAN.md`), waiting for Anoop's approval. Nothing applied yet. **Migration numbers in the plan must shift: start at 40, not 38** (see below) |
| Later phases | Not started |

Housekeeping note: during Phase 0 a read-only `git status` left an empty `.git/index.lock` in the local repo; it was removed (with permission) the same day. No other files were touched.

## Decisions taken (2026-10-06)

| # | Decision | Anoop's answer | Effect |
|---|---|---|---|
| D-1 | Security hot-fixes on production | **Show plan first** | `04_PHASE1_SECURITY_HOTFIX_PLAN.md` prepared; apply only after approval |
| D-3 | Meaning of "January" | **Signed deal + first outside institute live by end of January** | — (see timeline impact of D-7 below) |
| D-7 | Double-entry ledger timing | **As soon as possible — Oksy Academy is already a live client and needs it** | Ledger moves from "after first sale" to right after the tenant foundation (Phase L below) |
| D-8 | Net P&L vs "Due to Healthcare" | **Show both**: standard P&L + separately labelled "profit after related-party dues" | Implement in ledger phase; Healthcare becomes a generic related party |

Open decisions: D-2, D-4, D-5, D-6, D-9 … D-19 (see `03_GAP_ANALYSIS.md` §C7), plus D-18 needed for Phase 1 item 1.10.

## Revised phase order (because of D-7)

The ledger tables must carry `tenant_id` from day one, otherwise they would have to be migrated again. So the ledger comes **right after** the tenant foundation and Oksy cut-over:

| Order | Phase | Effort |
|---|---|---|
| 1 | Security hot-fixes | ~1 wk |
| 2 | Engineering foundation (migration baseline, CI, staging parity, server-side totals, password-reset fix) | ~1.5 wk |
| 3 | Tenant foundation — tenants, memberships, RLS, isolation tests (staging) | ~3 wk |
| 4 | Oksy → Tenant #001 cut-over (production) | ~1 wk |
| **L** | **Double-entry ledger for Oksy**: chart of accounts, parties, related party (Healthcare as generic), fee heads & charges, posting engine, back-fill from 1 Apr 2025, trial balance, P&L (both views), balance sheet, party statements, period lock | **~4–5 wk** |
| 5 | Tenant-aware app layer | ~2.5 wk |
| 6 | Branding & settings | ~1 wk |
| 7 | Platform admin + onboarding | ~2 wk |
| 8 | Pilot readiness (DPDP basics, export/delete, terms) | ~1.5 wk |

**Honest timeline impact:** total ≈ 18–19 weeks + buffer from mid-October ⇒ Oksy gets the ledger around **late December 2026 – early January 2027**, but the **first outside institute going live moves to roughly late February–March 2027**. A deal can still be **signed** in January (demo on Oksy/Tenant #001 data). To pull "live" back toward January, something else must be cut (e.g. a minimal onboarding wizard, or onboarding the first customer manually) — to be decided with Anoop.

## Changes made in the "Features & UI" project AFTER the audit (reported by Anoop 2026-10-21)

Both projects share one repo; these went through GitHub `main` (PR #36 merged 2026-10-21). They are NOT in the Phase 0 audit and must be preserved.

| Date | Change | Type |
|---|---|---|
| 21 Oct (PR #36) | Recon: bank lines match using the last 4+ digits of a UTR typed in Reference | App logic |
| 21 Oct (PR #36) | **Migration 39**: "Adjustments" account allowed for transfers only; `schema.sql` updated. UI: Adjustments available in Create, Banking, Import, Reports | DB + UI |
| 9–10 Oct | Reports phases 1–3: corporate layout, period picker on all reports; P&L, Monthly Income vs Expense, Cash & Bank Position, Account-wise, Batch-wise Fee Summary, Fee Collection Register, Student Dues, Expense Category × Month, Expense Register, Fund Transfers, Healthcare Account Statement, Student Register | UI/reports (browser-computed) |
| 9–10 Oct | Book ID popup (hover, copyable); Recon flag on edited entries | UI |
| 9–10 Oct | **Migration 38**: wrongly-added students can be deleted in any status | DB |

**OPEN CHECK:** whether migration 39 is applied on production Supabase — not yet verified.

### Impact on the SaaS plan
- **Migration numbering:** 38 and 39 are used. Phase 1 migrations start at **40**.
- **Migration 38** touches student delete rules → must be read before Phase 1 item 1.10 and preserved in the Phase 3 RLS rewrite (add a test: who can delete a student).
- **Migration 39 / Adjustments** is one more hard-coded money account in CHECK constraints → Phase 5 accounts table must support a transfers-only account type; chart of accounts for Oksy must include it.
- **Reports:** now ~13 (audit counted 7), all browser-computed, one named "Healthcare Account Statement" → Phase 2 server-side totals has a bigger reconciliation scope; Healthcare statement becomes a generic related-party statement (Phase L/5).
- **Recon UTR matching, Book ID popup, edit flag:** no schema impact; keep, and cover with tenant tests in Phase 5.
- Audit docs `01`–`03` should get a short addendum before Phase 2 starts.


## Addendum 2026-10-21 (Phase 1 prep, read-only checks)

- **Migration 39 is applied on production** (read-only SQL on project `lkkbaosujkkakoglxmah`): `transfers` from/to CHECKs include `Adjustments`; migration history shows it as `adjustments_account` (21 Oct). **Migration 38 is also live** (function body is the new any-status version) but is missing from the migration history list → baseline drift for Phase 2.
- **Who can delete students:** only via RPC `delete_mistaken_student()`, Owner/Admin only, any status, refused if a live receipt or linked login exists, audited. No DELETE policy on `students`. Phase 3 must keep this (add tenant check + test "who can delete a student").
- **Adjustments:** enforced only by hard-coded CHECK constraints on `transfers` plus hard-coded lists in `CreateNewTab.jsx`, `BankingPage.jsx`, `App.jsx` (`TRANSFER_ACCOUNTS`). Phase 5 accounts table needs a "transfers-only" account type.
- **Phase 1 migrations renumbered to start at 40** (see `04_…` §0). Docs copied into repo `docs/saas/` on branch `docs/saas-phase1-plan`.
- Open: approve Phase 1; D-18 (Executive blocked from fee/waiver changes; recommended yes).
