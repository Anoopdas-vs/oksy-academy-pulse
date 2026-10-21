# 00 — Executive Summary (PULSE 2.0 · Phase 0 Audit)

*For Anoop · 6 October 2026 · read-only audit — nothing was changed in the app or database.*

> **ചുരുക്കത്തിൽ:** ഇപ്പോഴത്തെ Pulse ഒരു institute-ന് നന്നായി പ്രവർത്തിക്കുന്നു (fees, expenses, bank reconciliation ശക്തമാണ്). പക്ഷേ ഇത് ഇപ്പോൾ SaaS ആയി വിൽക്കാൻ തയ്യാറല്ല — tenant വേർതിരിവ് ഇല്ല, ചില security പഴുതുകൾ ഉണ്ട്, accounting single-entry ആണ്. ആദ്യം security ശരിയാക്കുക, പിന്നെ tenant foundation. ജനുവരി അവസാനം ആദ്യ institute live ആക്കാം — double-entry ledger ആദ്യ വിൽപനയ്ക്ക് ശേഷം.

## Overall health score

| View | Score | One-line reason |
|---|---|---|
| As Oksy's internal tool | **6 / 10** | Works daily, good tests for money logic and reconciliation, but some data is visible to the wrong people and numbers are computed in the browser |
| As a sellable multi-institute SaaS | **2 / 10** | No tenants, no per-institute isolation, Oksy hard-coded everywhere, no onboarding |
| Accounting quality | **4 / 10** | Clean, consistent cash book; not double-entry; the "Net P&L" formula double-counts Healthcare-paid expenses |

## Top 10 findings (plain language)

1. **There is no concept of "institute" in the database.** Every table belongs to Oksy only; settings are a single global row. This is the core SaaS work.
2. **Anyone on the internet can push fake notifications to students** using the public website key (`notify_batch` has no permission check).
3. **Students and faculty can read all expenses and all students' fee payments** through the database API, even though the screens hide them. This is a DPDP privacy issue.
4. **A forgotten copy of the "create login" function (`smart-endpoint`) is still live** and lets any Admin create more Admins — undoing an earlier fix.
5. **Accounting is single-entry** (cash in / cash out / transfers, with an `account` label). It can be converted to proper double-entry **without data loss — difficulty MODERATE.**
6. **The Healthcare balance is calculated, not stored**, and is arithmetically consistent — but Net P&L subtracts it again although those expenses are already counted, and "Healthcare" is hard-coded in 4 database rules and many screens. It must become a generic "related party".
7. **Bank reconciliation is the strongest part** (auto-matching, undo, tests) and can be kept almost as-is.
8. **Totals will silently go wrong as data grows**: every screen downloads whole tables (the API normally returns at most 1,000 rows) and errors are hidden as zeros. Collections and expenses are at ~585 rows each.
9. **Production and the code repository are out of sync** (migrations applied by hand; one in production is not in the repo), and the repository appears to be public.
10. **Engineering basics are good but manual**: 326 tests (all passing), clean build, lint 0 errors — but no automatic checks on each change, and backups are configured but not proven to restore.

## Top 5 risks

| # | Risk | What we do about it |
|---|---|---|
| 1 | One institute sees another's data (RLS mistake) | Database-level isolation on every table + automatic Tenant A vs Tenant B tests that block release |
| 2 | Today's privacy/security gaps are used before they are fixed | Phase 1 hot-fix within days of your approval |
| 3 | Moving Oksy's live data into Tenant #001 breaks something | Backup → rehearsal on a copy → maintenance window → before/after reconciliation → tested rollback |
| 4 | Too many features squeezed into January | Strict MVP list; hide unused modules; full ledger after first sale |
| 5 | Backups don't actually restore | Verify the nightly job and do a real restore test now |

## Is January 2027 realistic?

**Honest verdict:** about **13.5 weeks of work + 2 weeks buffer** for the MVP. A **signed deal in January is achievable; the first outside institute going live is realistic in late January**, *if* we:
- do the full double-entry ledger, balance sheet and period lock **after** the first sale (the January data model is prepared for it);
- hide exams, reviews, assignments, live class and timetable for new institutes at launch;
- use one app address with an institute switcher (no subdomains yet) and manual invoicing (no billing module yet).

Going live in the first half of January would require cutting security/isolation work — **not recommended**.

## Recommended next step

1. Read `03_GAP_ANALYSIS.md` §C7 and answer the decisions (most important: **D-1** approve security hot-fixes, **D-3** what "January" means, **D-4** pilot institute's must-haves, **D-7** ledger timing, **D-8** P&L definition).
2. Approve **Phase 1 — Security hot-fixes** (≈ 1 week; backup → staging → your approval → production).
3. Then Phase 2 (engineering foundation) and Phase 3 (tenant foundation on staging).

## Files

| File | What it contains |
|---|---|
| `00_EXECUTIVE_SUMMARY.md` | This page |
| `01_CURRENT_SYSTEM_AUDIT.md` | Architecture, features, every table & policy, accounting, auth, security findings, Oksy hard-coding, code health, data counts |
| `02_TARGET_CAPABILITY_CATALOGUE.md` | 164 capabilities of a complete institute SaaS, by module and tier (T0–T4), plus what to integrate instead of build |
| `03_GAP_ANALYSIS.md` | Status of every capability, accounting design & conversion, multi-tenancy design & test plan, architecture choice, risks, phase plan, owner decisions |
