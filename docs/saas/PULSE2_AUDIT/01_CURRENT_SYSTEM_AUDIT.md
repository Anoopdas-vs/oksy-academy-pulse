# 01 — Current System Audit (Oksy Academy Pulse → PULSE 2.0)

> **Phase 0 · read-only.** Prepared 2026-10-06.
> **Code audited:** `oksy-academy-pulse` @ `06bf4ce` (= `origin/main`; the local checkout is on branch `receipt-print-and-refresh`, same commit). The GitHub download in `~/Downloads/oksy-academy-pulse-main` is identical for `src/` and `supabase/`.
> **Database audited:** Supabase project **"Oksy Academy Pulse"** (`lkkbaosujkkakoglxmah`, Postgres 17, region ap-south-1) — confirmed as production because `.env` points to it. A second project `oksy-pulse-staging` exists (`.env.staging.local`).
> **Method:** file reading, `git log`, read-only catalog/`SELECT count(*)` queries, Supabase security & performance advisors. No code, config or data was changed. Lint/test/build were run on a throw-away clone in the cloud workspace, not in your folder.
> **Privacy:** no keys, tokens or personal student data are reproduced here. Counts only.

---

## A1. Architecture

### Stack

| Layer | What is used | Evidence |
|---|---|---|
| UI | React 19.2, JavaScript + JSX (no TypeScript) | `package.json` |
| Build | Vite 8.2 with manual vendor chunks | `vite.config.js` |
| Charts / Excel | recharts 3.10; SheetJS `xlsx` 0.20.3 loaded from `cdn.sheetjs.com` tarball (dynamic import) | `package.json`, `src/lib/reports.js`, `src/lib/bankStatement.js` |
| Lint / tests | oxlint; Node built-in test runner (`node --test src/lib/*.test.js`) | `package.json`, `.oxlintrc.json` |
| Routing | **None.** One `activeTab` state in `src/App.jsx`; only the nav-collapsed flag is kept in `localStorage` (`oksy.nav`) | `src/App.jsx:149-160, 298-306` |
| State | React `useState`/`useMemo` in `App.jsx` (1,717 lines) — all data loaded into memory, totals computed in the browser | `src/App.jsx:404-565` |
| Data access | Supabase JS client directly from the browser; finance calls in `src/lib/data.js`, academy calls in `src/lib/academy.js`; 15 RPC calls for multi-step writes and helpers | `src/lib/data.js`, `src/lib/academy.js` |
| Auth | Supabase Auth: email+password, Google OAuth, password-reset email; `profiles` row created by trigger | `src/context/AuthContext.jsx`, trigger `on_auth_user_created` |
| Database | Supabase Postgres 17 with RLS on all 26 `public` tables | catalog query |
| Edge functions | `create-user` (in repo, CI-deployed, v4) **and `smart-endpoint` (NOT in repo, deployed by hand, v1)** | `supabase/functions/create-user/index.ts`; `list_edge_functions` |
| Scheduled jobs | `pg_cron` job `batch-auto-student-status`, daily 18:35 UTC (00:05 IST) → `run_batch_status_automation()` | `cron.job`; `supabase/31_batch_status_daily_schedule.sql` |
| Storage | One private bucket `submissions` (no size or MIME limit) | `storage.buckets` |
| Hosting | Vercel project (named `oksy-academy-finance`), auto-deploy on push to `main`; domain `pulse.oksyacademy.in` | `.vercel/project.json`, `CLAUDE.md` §1 |
| CI | GitHub Actions: `deploy-edge-functions.yml` (deploy `create-user` on push), `nightly-backup.yml` (pg_dump at 00:30 IST). **No lint/test/build CI.** | `.github/workflows/` |
| Extensions | pg_cron, pgcrypto, uuid-ossp, pg_stat_statements, supabase_vault | `list_extensions` |
| Third parties | Google (OAuth), SheetJS CDN, Supabase, Vercel, GitHub. Live-class links point to whatever URL is stored (Jitsi/Meet) | code |

### Environment variables (names only)

| Where | Names |
|---|---|
| Front-end (`.env`, `.env.staging.local`, Vercel) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (public by design) |
| Supabase Edge secrets | `SERVICE_ROLE_KEY` (+ auto `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) |
| GitHub Actions secrets | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_URL`, optional `BACKUP_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION` |
| Test-only (local) | `TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, `TEST_SUPABASE_SERVICE_KEY`, `TEST_*_EMAIL/PASSWORD` (`src/lib/*.rls.test.js`) |

Whether the GitHub secrets are actually set (i.e. whether the nightly backup really runs) is **UNKNOWN — needs verification** in GitHub → Actions.

### Folder structure (short)

```
src/App.jsx (1717)   ← all state, data loading, totals, nav, modals
src/pages/           Dashboard, Timetable, LiveClass, Assignments, Exams, Reviews,
                     Enrollment, FeeCollection, Expenses, Banking (929), Reports, Admin (591)
src/components/      Login, ForcePasswordChange, Receipt, StaffAccess, StudentBulkUpload,
                     Sync/Match modals, NotificationBell, ErrorBoundary, ui.jsx …
src/lib/             data.js, academy.js, access.js, fees.js, reconcile.js (1180), reports.js,
                     bankStatement.js, validation.js, studentBulk.js … + 26 *.test.js
supabase/            schema.sql, 01…36 hand-run migrations (+19a/19b/28b), academy-suite
                     patches, checks/, seed/, functions/create-user
scripts/backup-db.sh, .github/workflows/, docs/claude-project/ (rules + 11 earlier audits)
```

### How the pieces connect

```
 Browser (React SPA, pulse.oksyacademy.in on Vercel)
   │  anon key + user JWT (public)
   ├──► Supabase Auth  (email/pw, Google OAuth, reset e-mail)
   ├──► PostgREST /rest/v1  ──► Postgres 17 (26 tables, RLS, 45 functions, 2 views)
   │        tables: students, collections(+collections_basic view), expenses, transfers,
   │                bank_*, batches, courses, profiles, academy tables, audit_log …
   │        RPCs:   enroll_student, bulk_upsert_students, save_bank_match_links, sync_bank_entries …
   ├──► Storage  (bucket "submissions", private)
   └──► Edge Functions  create-user  (service-role inside)     smart-endpoint (stray copy)
 pg_cron ──► run_batch_status_automation()  (daily 00:05 IST)
 GitHub Actions ──► deploy create-user  |  nightly pg_dump → artifact / optional S3
```

---

## A2. Feature map

There are no URL routes; each "page" is a tab. Tab visibility per role comes from `app_settings.data.roleAreas` (`src/lib/access.js` `getAccess()`); this is **UI-only** — the database rules are in §A3/§A5.

| Tab / module | What it does | Who can open (default) | Reads | Writes | Status |
|---|---|---|---|---|---|
| Login / Forgot password | Email+pw, Google, reset link | Everyone | `profiles` | auth | **PARTIAL** — reset link is sent but no "set new password" screen handles the `PASSWORD_RECOVERY` event (grep of `src/`); verify manually |
| Force password change | Blocks app until temp password replaced | New logins | `profiles` | `clear_my_must_change_password()` | WORKING |
| Waiting for approval | Lock screen for unapproved users | Unapproved | `profiles` | — | WORKING |
| Pulse (Dashboard) | Student tiles, revenue/expense/Net P&L, cash & bank, Due to Healthcare, charts, batch summary | All; finance part if `financials` | students, collections_basic, expenses, transfers, batches | — | WORKING (Net P&L definition questionable, §A4) |
| Timetable | Weekly slots per batch | All academy roles; edit staff+ | `timetable_slots`, `faculty_batches` | same | PARTIAL (2 slots) |
| Live Class | Open the slot's meeting link; start session; join → attendance | All academy roles | `timetable_slots`, `live_sessions` | `live_sessions`, `attendance` | PARTIAL (2 sessions, 1 attendance). Opens external link; not an embedded Jitsi as `AGENTS.md` claims |
| Assignments | Create, submit (link/file), grade | Faculty/staff create; students submit | `assignments`, `assignment_submissions`, storage | same + `resubmit_assignment()` | PARTIAL (3 assignments, 2 submissions) |
| Exams | Timed MCQ, server-side scoring | Faculty/staff create; students take | `exams`, `exam_questions(_public)`, `exam_attempts` | same + `score_exam_attempt()` | **UNUSED** (0 exams) |
| Reviews | Students rate faculty | Students write; faculty/staff read | `faculty_reviews` | same | **UNUSED** (0 reviews) |
| Enrollment | Student master, add/edit, auto ID, bulk Excel, safe delete | Staff+ | `students`, `batches`, `courses` | `enroll_student()`, `students` update, `bulk_upsert_students()`, `delete_mistaken_student()` | WORKING (136 students) |
| Fee Collection | Record payment → receipt; list, edit/delete (admin); bulk import | Staff+ (enter), Admin (edit/delete) | `collections_basic`, `students` | `collections` | WORKING (584 receipts) |
| Expenses | Record expense, edit/delete (admin), bulk import | Staff+ | `expenses`, `expense_categories` | `expenses` | WORKING (585 rows) |
| Banking → Transfers | Account↔account incl. Healthcare repayments | Admin + financial access | `transfers` | `transfers` | WORKING (40) |
| Banking → Reconciliation | Upload statement, auto-match (UTR/exact/name/group), manual link, sync bank reference/date with undo, Excel export | Admin + financial | `bank_statements`, `bank_statement_lines`, `bank_match_links`, `bank_sync_history` | same + 4 RPCs | WORKING (2 statements, 220 lines, all matched) |
| Reports | 7 reports: P&L, Fee Collection, Expense Analysis, Receivables, Students, Transfers, Inter-company (Healthcare); Excel + print | Staff: Fee Collection & Receivables; financial users: all | in-memory data | — | WORKING |
| Admin → Batches / Courses / Categories | Masters; create staff+, edit staff+ (DB) / delete admin | Staff+ | `batches`, `courses`, `expense_categories` | same | WORKING |
| Admin → Users | Create login (edge fn), approve, role, financial toggle | Owner | `profiles` | `create-user` fn, `profiles` | WORKING |
| Admin → Access | Per-role tab checkboxes | Owner | `app_settings` | `app_settings` | WORKING (UI-only control) |
| Admin → Auto status | Preview/run batch-date status automation, date issues | Admin | RPCs | `run_batch_status_automation()` | WORKING |
| Notification bell | In-app notifications | All | `notifications` | `notifications` (mark read) | PARTIAL (2 rows) |

---

## A3. Database audit

### A3.1 Tables at a glance

"Owner of data" today = Oksy Academy for all rows (single tenant). **Classification** is what each table becomes in PULSE 2.0. Row counts are exact `count(*)` on 2026-10-06.

| Table | Purpose | PK | Key FKs | Notable constraints / indexes | Rows | Class |
|---|---|---|---|---|---|---|
| `profiles` | One per login: role, approval, financial flag, batch, student link | `id` (= auth.users.id) | → `auth.users` (cascade), `batches(name)`, `students(id)` | `profiles_role_check` (6 roles) | 14 | Global user + **tenant membership** (split) |
| `students` | Student master incl. fees, waiver, status, personal & guardian data | `id` text (e.g. course code + number) | `batch` → `batches(name)` ON UPDATE CASCADE | status CHECK; phone `^[0-9]{10}$`; email regex; guardian_relation CHECK | 136 | Tenant-owned (**personal data**) |
| `collections` | Fee payments | `id` bigint | → `students(id)` | `account IN (HDFC,ICICI,Cash,Healthcare)`, `amount > 0`; idx date, student_id | 584 | Tenant-owned (financial) |
| `expenses` | Expenses | `id` bigint | `category` → `expense_categories(name)` ON UPDATE CASCADE | same account CHECK, `amount > 0`; idx date | 585 | Tenant-owned (financial) |
| `transfers` | Account-to-account movements | `id` bigint | — | from/to CHECK (4 accounts), `from <> to`, `amount > 0` | 40 | Tenant-owned (financial) |
| `bank_statements` | Uploaded statements | `id` | — | `account IN (HDFC,ICICI,Cash)` | 2 | Tenant-owned |
| `bank_statement_lines` | Statement lines + match status | `id` | → statements (cascade) | status CHECK (5), match_kind CHECK | 220 | Tenant-owned |
| `bank_match_links` | Line ↔ book entry links (many-to-one) | `id` uuid | → lines (cascade) | UNIQUE (book_kind, book_id, account); source CHECK | 222 | Tenant-owned |
| `bank_sync_history` | Undo log for reference/date sync | `id` uuid | — | field CHECK | 201 | Tenant-owned |
| `batches` | Batch master with dates & fee defaults | `id` | — | **UNIQUE(name)**; 2 CHECKs `NOT VALID`; name-format trigger | 7 | Tenant-owned |
| `courses` | Course master | `id` | — | **UNIQUE(code)**, **UNIQUE(name)** | 2 | Tenant-owned |
| `expense_categories` | Category list | `id` | — | **UNIQUE(name)** | 36 | Tenant-owned (seed from template) |
| `app_settings` | Global JSON settings (roleAreas) | `id` = 1 | — | `CHECK (id = 1)` singleton | 1 | → `tenant_settings` |
| `audit_log` | Old/new row JSON on update/delete of money tables (+2 RPCs) | `id` bigint | `changed_by` → profiles | action CHECK (update, delete); idx (table_name,row_id) | 1,240 | Tenant-owned (contains personal + financial copies) |
| `timetable_slots` | Weekly schedule | `id` uuid | batch(name), faculty | conflict trigger; day/mode/status CHECKs | 2 | Tenant-owned |
| `live_sessions` | Started class sessions | `id` | → slot (cascade) | — | 2 | Tenant-owned |
| `attendance` | Session attendance | (session_id, student_id) | → profiles | — | 1 | Tenant-owned |
| `assignments` | Assignments | `id` | batch(name) | status CHECK | 3 | Tenant-owned |
| `assignment_submissions` | Submissions & grades | `id` | → assignments (cascade), profiles | UNIQUE (assignment, student) | 2 | Tenant-owned |
| `exams` / `exam_questions` / `exam_attempts` / `exam_answers` | MCQ engine | uuids | cascades | passing 0–100, one attempt per student | 0/0/0/0 | Tenant-owned |
| `faculty_batches` | Faculty ↔ batch | (faculty_id, batch_name) | → profiles, batches(name) | — | 3 | Tenant-owned |
| `faculty_reviews` | Ratings 1–5 + comment | `id` | → profiles | rating CHECKs | 0 | Tenant-owned |
| `notifications` | In-app notifications | `id` | → profiles | idx (recipient, created_at) | 2 | Tenant-owned |
| **Views** `collections_basic` | Collections with `account` masked unless financial user or creator; `security_barrier`, definer-rights | — | — | filter `is_approved_user()` | — | Tenant-scoped view |
| `exam_questions_public` | Questions without `correct_index`; definer-rights | — | — | published + own batch / manager | — | Tenant-scoped view |
| `backup_20261003.*` (5 tables) | Manual copy of collections/expenses/transfers/bank tables taken 2026-10-03 | none | — | **no PK, no RLS**, not exposed to API (no grants) | — | Remove after retention decision |

### A3.2 RLS policies in plain language

RLS is **enabled on every public table** (none use `FORCE`). Helper meanings: `is_approved_user()` = any approved login (incl. students & faculty); `is_staff_or_admin()` = approved Owner/Admin/Executive; `is_admin()` = approved Owner/Admin; `can_view_financials()` = approved and (role `admin` or financial flag); `my_batch()` / `my_student_ref()` / `teaches_batch()` read the caller's profile.

| Table | SELECT (who can read) | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| profiles | Self; Owner sees all | — (trigger only) | Owner only | — |
| students | Staff+ all; a student only their own row | Staff+ (direct or `enroll_student`) | **Staff+ (any column, incl. fees & waiver)** | none (only `delete_mistaken_student` RPC, admin) |
| collections | Base table: column grant only `id` for `authenticated`; real reads go through `collections_basic` → **any approved user sees all rows** (account masked for non-financial) | Staff+ | Admin | Admin |
| expenses | **Any approved user (students & faculty included)** | Staff+ | Admin | Admin |
| transfers | Financial users | Admin | Admin | Admin |
| bank_statements / lines / match_links / sync_history | Financial users | Admin | Admin | Admin (statements, links); lines via cascade |
| batches, courses, expense_categories | Any approved user | Staff+ | **Staff+** | Admin |
| app_settings | Any approved user | Owner | Owner | — |
| audit_log | Financial users | — (triggers/RPCs) | — | — |
| timetable_slots | Staff+, own faculty, own batch | Staff+ | Staff+ | Staff+ |
| live_sessions | Staff+, host, own batch | Staff+ or slot faculty | same | same |
| attendance | Self, staff+, session faculty | **Self for any session** (`attend_self_insert` only checks `student_id = auth.uid()`), staff+, faculty | staff+/faculty | staff+/faculty |
| assignments | Staff+, teaching faculty, published-for-my-batch | Staff+ or teaches batch | manager | manager |
| assignment_submissions | Self, staff+, manager | **Self — but every column incl. `marks`, `status`, `feedback`, `graded_by` is insertable** | manager (students via `resubmit_assignment` RPC) | — |
| exams / exam_questions | Managers; students via `exam_questions_public` | managers | managers | managers |
| exam_attempts | Self, staff+, manager | **Self — `score`, `passed`, `submitted_at` insertable** | — (RPC only) | — |
| exam_answers | Own open attempt; managers read | own open attempt | own open attempt | own open attempt |
| faculty_batches | Self or staff+ | staff+ | staff+ | staff+ |
| faculty_reviews | Author, reviewed faculty, staff+ | Self (any `faculty_id`) | Author | Staff+ |
| notifications | Recipient | **Any approved user, for any recipient** | Recipient | — |
| storage `submissions` | Own folder, staff+, assignment manager | Own folder `<assignment>/<uid>/…` | Own folder | — |

### A3.3 Functions / RPCs (45 in `public` + 2 in `private`)

| Concern | Finding | Evidence |
|---|---|---|
| SECURITY DEFINER | 27 functions; all set `search_path=public` except `rls_auto_enable` (`pg_catalog`). | `pg_proc` query |
| Callable by `anon` | 15 SECURITY DEFINER functions (advisor 0028). Most are harmless helpers returning false/null for anon. **`notify_batch()` has no permission check at all** → see A6 C-1. | advisor `anon_security_definer_function_executable` |
| Mutable search_path | `timetable_no_conflict`, `can_manage_assignment`, `can_manage_exam`, `ist_today`, `batch_status_for` (all invoker) | advisor 0011 |
| Well-guarded RPCs | `enroll_student`, `bulk_upsert_students`, `delete_mistaken_student`, `run_batch_status_automation`, `save_bank_match_links`, `sync_bank_entries`, `undo_bank_sync`: role checks inside, locks, audit rows | function bodies |
| Triggers | `on_auth_user_created`; `students_follow_batch_dates`, `students_id_immutable`; `*_audit` on collections/expenses/transfers (UPDATE/DELETE only); `bank_match_links_*` (3); `batches_name_rule`, `batches_resync_students`; `timetable_no_conflict_t` | `pg_trigger` |
| Grants | `anon` and `authenticated` keep Supabase's default ALL on every public table (RLS is the only barrier); `authenticated` SELECT on `collections` limited to column `id` (migration 06). `anon` still has SELECT on `collections` (blocked by RLS). | `information_schema.role_table_grants`, `column_privileges` |
| Migration tracking | Only 7 rows in `supabase_migrations.schema_migrations` (28, 32–37). Commit messages for 33–36 say "not applied", but production **has** them (and a `37_revoke_cleanup_trigger_execute` that is not in the repo). Repo and production schema are therefore not provably in sync. | `list_migrations`; `git log`; `ls supabase/` |

### A3.4 Storage & extensions

- Bucket `submissions`: private ✔, **no `file_size_limit`, no `allowed_mime_types`** (only a client-side `accept=` list in `AssignmentsPage.jsx:298`). 3 objects.
- Extensions installed: `pg_cron`, `pgcrypto`, `uuid-ossp`, `pg_stat_statements`, `supabase_vault`.

---

## A4. Accounting / finance audit (most important)

### A4.1 How money is stored today

- **Three separate single-entry tables**: `collections` (money in from students), `expenses` (money out), `transfers` (movement between accounts). A fourth, `income`, was dropped (`08_drop_income_table.sql`).
- Each row has **one** `account` text value: `HDFC`, `ICICI`, `Cash` or `Healthcare`, enforced by CHECK constraints (not a table).
- **There is no chart of accounts, no ledger, no debit/credit, no journal, no party/vendor master.** Categories exist only for expenses (`expense_categories`, FK by **name**). Collection "type" is free text — production has 6 spellings for 4 heads (e.g. "Course fee"/"Course Fee", "Registration Fee"/a misspelt variant).
- Bank statement data is separate (`bank_statements`, `bank_statement_lines`) and linked to book rows by `bank_match_links`.
- All balances and P&L are **computed in the browser** from the rows the user downloaded (`src/lib/fees.js`, `src/App.jsx:489-565`). Nothing is stored.

### A4.2 Healthcare ↔ Academy balance — exact logic

```
healthcareBalance = Σ collections where account='Healthcare'      (fees a student paid to Healthcare → Healthcare owes Academy)
                  − Σ expenses    where account='Healthcare'      (Academy costs Healthcare paid → Academy owes Healthcare)
                  + Σ transfers   where to_account='Healthcare'   (Academy repays Healthcare)
                  − Σ transfers   where from_account='Healthcare' (Healthcare funds an Academy account)
> 0  ⇒ "Healthcare Receivable"   < 0 ⇒ "Due to Healthcare" (liability)
Net P&L (dashboard) = Revenue(period) − Expense(period) − max(0, −healthcareBalance)(ALL-TIME)
```
Evidence: `accountBalance()` in `src/lib/fees.js`; `src/App.jsx:523-542`; `src/lib/reports.js:281-315` (Inter-company report). Production volume: 39 collections, 21 expenses and 11 transfers use the Healthcare account.

**Stored or computed?** Computed every time, never stored. **Reliable?** The arithmetic is consistent with the rows, but the *meaning* has problems:

| # | Edge case / weakness | Effect on numbers |
|---|---|---|
| 1 | Net P&L subtracts "Due to Healthcare" although Healthcare-paid expenses are already inside Expense. Documented as an intentional owner choice (`PROJECT_OVERVIEW.md` §10). | Profit is **under-stated by the full liability**; not an accounting-standard P&L. |
| 2 | The subtracted liability is all-time, while Revenue/Expense follow the period filter. | A single month's "Net P&L" can be hugely negative; it jumps up in the month Healthcare is repaid (a transfer, which is not P&L). |
| 3 | If the balance is a *receivable* (Healthcare owes Academy), it is ignored in P&L but a payable is subtracted. | Asymmetric treatment. |
| 4 | Gross amounts are netted into one number. | You cannot see "Healthcare holds ₹X of our fees" separately from "we owe Healthcare ₹Y for expenses". |
| 5 | Classification depends on staff choosing the right screen: a loan from Healthcare entered as a "collection" with account Healthcare would be counted as **fee revenue**. | Silent revenue inflation; nothing validates it. |
| 6 | No statement exists for the Healthcare "account" (`bank_statements_account_check` excludes it), so it can never be reconciled. | No independent check; needs a periodic balance confirmation with Healthcare. |
| 7 | Past rows can be edited/deleted by any Admin; no period lock; no opening balance before 2025-04-30 (earliest collection). | Historic balances can change silently; opening position unknown. |
| 8 | Totals depend on how many rows the browser received; the API is very likely capped at 1,000 rows per request (Supabase default "Max rows" — **verify** in Dashboard → API settings) and `loadData()` swallows fetch errors with `.catch(() => [])` (`src/App.jsx:413-418`). | When a table passes 1,000 rows, or a request fails, totals become wrong **without any warning**. Collections and expenses are at ~585 rows each today. |
| 9 | Hard-coded name "Healthcare" in 4 CHECK constraints, 6 JS constants, reports and import mapping. | Cannot be reused by another institute; must become a generic related-party record. |

### A4.3 Student fees

| Aspect | How it works | Weakness |
|---|---|---|
| Fee structure | 4 fixed columns on `batches` (registration, course, exam) copied into `students` (registration, course, exam, other) at enrolment | No custom heads, no fee plan history, no due dates |
| Installments | None — any amount, any date | No schedule, no overdue logic |
| Discounts | One number `students.waiver` | No reason/date/approver; overwritten in place |
| Dropped students | `effectiveFeeDue = min(fee − waiver, collected)` and waiver auto-raised (`waiverForDrop`) | Write-off happens implicitly; not visible as an expense/discount |
| Refunds | Not possible (`amount > 0` CHECK; no refund type) | Workarounds would distort reports |
| Receipts | Printed view of one collection; number = `OKSY/` + DB row id (`src/lib/format.js:19`) | Not per FY, gaps after deletes, editable/deletable after printing (17 collections deleted, 1,009 collection updates in `audit_log` — most from bank-reference sync) |
| Dues / status | `outstanding = max(0, effectiveDue − collected)` per student, credit balance shown separately | 2 students currently paid more than they owe (credit) — needs review |

### A4.4 Expenses, income, reconciliation

- Expenses: date, category (FK by name), account, amount, reference, description, bank_reference. No vendor, no bill attachment, no GST. Staff can create; only Admin can edit/delete.
- Other income: no longer possible (table dropped).
- Reconciliation (strongest part of the system): statement upload (ICICI-style + generic parser), multi-pass auto-matching (UTR → exact date → name → group), many-lines-to-one-book links per account, manual link, "sync bank reference/date" with preview and undo, Excel export. Well tested (`src/lib/reconcile.test.js`, 1,194 lines). Weaknesses: parser formats are bank-specific; Healthcare cannot be reconciled; Cash "statements" are allowed by CHECK but have no real source.

### A4.5 Reports & trust

| Report | Exists | Trust issues |
|---|---|---|
| P&L | Yes (cash basis: money received − money spent) | Fee "revenue" = cash received, not fees earned; Healthcare double-count on dashboard |
| Fee collection, expense analysis, receivables, students, transfers, inter-company | Yes | Free-text fee types split totals |
| Balance sheet, trial balance, cash-flow statement, aging | **No** | — |

Rounding: no fractional-paise values found (0 rows). Possible duplicates (same student/date/amount/account): 5 collection groups; (same date/amount/category/account): 25 expense groups — may be legitimate, need human review. Audit trail starts 2026-09-14 (earliest `audit_log` row); earlier edits are not recorded; inserts are never logged. No date/period locking.

### A4.6 Verdict — can today's data become a proper double-entry ledger?

**Yes, without data loss. Difficulty: MODERATE.**

*Why not EASY:* free-text fee types must be mapped; fee "charges" were never recorded as events (they are columns on the student), so opening receivables must be derived; waivers and drop write-offs have no dates; Healthcare rows must be re-expressed as related-party entries; there is no opening balance before April 2025; edits before 2026-09-14 are unrecoverable (only current values exist).
*Why not HARD:* every money row is positive, dated, has exactly one account from a closed list, belongs to a known student or category, and transfers are already separate from income/expense. Each row maps to exactly one balanced two-line journal entry (mapping table in `03_GAP_ANALYSIS.md` §C2). The bank-match links can be kept as-is.

---

## A5. Authentication & authorization audit

| Topic | Finding | Evidence |
|---|---|---|
| Login | Email+password and Google OAuth via Supabase Auth | `AuthContext.jsx` |
| Self-signup | `signUp()` exists in context and Google OAuth creates an auth user for any Google account; new users get `role='staff'`, `is_approved=false` and see the lock screen | `handle_new_user()`, `src/App.jsx:183-191` |
| Session | Supabase JWT with auto-refresh, persisted in browser storage; expiry = project default (UNKNOWN — needs verification in Auth settings) | `supabaseClient.js` |
| Logout | `supabase.auth.signOut()` | `AuthContext.jsx` |
| Protected "routes" | Whole app gated by session → profile → approved → password-change checks; tabs by `access.canOpen()` | `src/App.jsx:162-197` |
| Password reset | Email sent with redirect to site root; no handler for the recovery event → user lands in the app signed in without a set-password step (unless `must_change_password`). **Likely broken — test it.** | grep `PASSWORD_RECOVERY` (none) |
| Where roles live | `profiles.role` + `profiles.can_view_financials` + `profiles.is_approved`; tab rights in `app_settings.data.roleAreas` | schema |
| Can users tamper with their role? | **No.** No self-UPDATE policy on `profiles`; only Owner can update; must-change flag cleared by a narrow RPC. | `pg_policies` |
| Admin creation | First Owner is made by hand-run SQL; `supabase/05_super_admin.sql:83` hard-codes the owner's personal e-mail. Other logins via `create-user` (Owner only) — **but the stray `smart-endpoint` function lets any Admin create Admin logins** (A6 H-1). | files; `get_edge_function` |
| Hard-coded IDs | No hard-coded UUIDs found; one hard-coded e-mail (above) | grep |
| DB vs UI enforcement | Financial tables use DB helpers ✔, but several UI rules are **not** enforced in the DB: the "financial access" toggle does not protect `expenses` or fee rows; Executive "enter-only" is not true for students/batches/courses; tab visibility is UI-only | §A3.2 |

**What each kind of user can really do with the public anon key + their own login (direct API, bypassing the UI):**

| Actor | Can read | Can change |
|---|---|---|
| Not logged in (anon key from the JS bundle) | Nothing (RLS) | **Create notifications for every student of any batch via `notify_batch()`** |
| Signed-up but unapproved | Nothing | Same as above |
| Student / Faculty (approved) | **All expenses; all fee receipts (student ID, name, amount, date, reference, UTR)**; batches, courses, categories, settings; own student row | Notifications to anyone; self-grade a new submission; insert a pre-scored exam attempt; attendance for any session; faculty review for any faculty ID |
| Executive (staff) without financial flag | Same reads (expenses fully, receipts with account masked) | Students incl. **fee amounts & waiver**, batches incl. fees, courses, categories; insert receipts/expenses |
| Admin | Everything financial | Edit/delete any receipt/expense/transfer (audit-logged); via `smart-endpoint`: create new Admin logins |
| Owner | Everything | Everything incl. user roles |

---

## A6. Security audit

Ratings: CRITICAL = exploitable now with serious harm; HIGH = real exposure of personal/financial data or privilege escalation; MEDIUM = integrity/abuse risk needing a precondition; LOW = hygiene.
**No CRITICAL issue found.** No secrets found in tracked files or git history (searched all commits for JWT, `sb_secret_`, AWS keys and DB URLs with passwords; only `.env.example` with placeholders is tracked; `scripts/backup-db.sh:36` contains a placeholder `<password>` only). `.env` / `.env.staging.local` hold only the public anon key and are git-ignored.

| ID | Rating | Finding | Plain-language impact | Recommended fix | Evidence |
|---|---|---|---|---|---|
| C-1 | **HIGH** | `notify_batch()` is SECURITY DEFINER, executable by `anon`, with **no caller check** | Anyone on the internet who copies the public key from the website can send fake in-app messages (e.g. "pay fees to this UPI") to all students of a batch | Revoke from `anon`/`public`; check `is_staff_or_admin()` or batch teacher inside; later move to tenant-scoped RPC | `pg_proc`; advisor 0028; `src/lib/academy.js` |
| H-1 | **HIGH** | Stray edge function `smart-endpoint` (not in repo) is an **old copy of create-user** that accepts `admin` callers, lets them assign role `admin`, and does not set `must_change_password` | Undoes the earlier "Owner-only user creation" fix; any Admin can mint more Admins with permanent passwords | Delete `smart-endpoint` (after confirming no caller); keep all functions in repo/CI only | `list_edge_functions`, `get_edge_function` |
| H-2 | **HIGH** | `expenses_approved_select` = any approved user | Students and faculty can read every expense (salaries, rent, commissions) via the API, even though the UI hides it; the "financial access" toggle does not protect expenses | Restrict SELECT to staff who need it (`can_view_financials()` or a `finance.read` permission) | `pg_policies` |
| H-3 | **HIGH** | `collections_basic` view returns all rows to any approved user | Every student can download all other students' fee payments (names, amounts, dates, UTR references) — personal financial data under DPDP | Filter view to staff+ (and a student's own rows only); make it `security_invoker` with proper policies | `pg_get_viewdef('collections_basic')` |
| H-4 | **MEDIUM** | Self-grading / result forgery on INSERT: `sub_student_insert` and `attempt_student_insert` don't restrict grading columns | A student can submit with `marks=100, status='graded'`, or insert an exam attempt already `passed=true` | Column-level INSERT grants or a BEFORE INSERT trigger forcing grading fields to NULL; move first submission to RPC | `pg_policies`, `column_privileges` |
| H-5 | **MEDIUM** | Repository appears **public** (anonymous HTTPS clone succeeded from the audit sandbox) | Schema, RLS design, owner e-mail (`05_super_admin.sql:83`), office address and seed data are visible to anyone; makes attacks easier (no secrets leaked) | Make repo private (GitHub → Settings → Danger zone) unless intentionally open; verify | clone test |
| M-1 | MEDIUM | Executive (staff) can UPDATE `students` (fees, waiver, status), `batches` (fees), `courses`, `expense_categories` | Contradicts "enter-only" design (`SETUP.md` §5); staff can reduce a student's dues without Admin approval (students edits are not audit-logged) | Split student UPDATE: personal fields staff, fee fields admin; audit students | `students_staff_update`, `batches_staff_update` |
| M-2 | MEDIUM | Any approved user can INSERT a notification for any recipient | Students can spoof messages to staff or other students | Only staff/faculty, or via RPC | `notif_insert` |
| M-3 | MEDIUM | Financial records can be edited/deleted with no period lock; receipts deletable; INSERTs not audited | Past figures can change silently; a receipt given to a parent can disappear | Void/cancel instead of delete; log INSERTs; add period lock (T2) | `collections_admin_delete`, triggers |
| M-4 | MEDIUM | Storage bucket has no size or MIME limits | A student can upload very large or executable files; storage cost/abuse | Set `file_size_limit` (e.g. 10 MB) and allowed MIME types on the bucket | `storage.buckets` |
| M-5 | MEDIUM | Unbounded list queries + likely 1,000-row API cap + swallowed errors | Dashboards/reports become silently wrong as data grows — a finance-trust problem | Server-side aggregates (RPC/views), pagination, surface fetch errors | `src/lib/data.js`, `src/App.jsx:413-418` |
| M-6 | MEDIUM | Backups: workflow exists but whether it runs (secrets set) and whether a restore was ever tested is UNKNOWN | If production is lost, recovery may not work | Verify last successful run; do a restore drill into a scratch project | `.github/workflows/nightly-backup.yml` |
| M-7 | MEDIUM | Migration drift: production has migrations not in repo (`37_*`) and repo commit messages disagree with prod state | Future changes may be built on a wrong picture of production | Adopt Supabase CLI migrations; `db diff` prod vs repo | `list_migrations` |
| L-1 | LOW | 14 other SECURITY DEFINER helpers executable by `anon` (return false/null) and 5 functions with mutable `search_path` | Hygiene; increases attack surface | Revoke `anon` EXECUTE; set `search_path = ''`; move helpers to a non-exposed schema | advisors |
| L-2 | LOW | Attendance self-insert for any session | A student can mark themselves present in any class | Check session belongs to `my_batch()` | `attend_self_insert` |
| L-3 | LOW | Leaked-password protection disabled | Weak/breached passwords allowed | Enable in Auth settings | advisor |
| L-4 | LOW | Open signup / any Google account creates an auth user (unapproved) | Unapproved users still get a JWT and can call anon/authenticated RPCs (see C-1) | Invite-only; disable public signups | `AuthContext.jsx` |
| L-5 | LOW | `faculty_reviews` not anonymous; any `faculty_id` accepted | Students may self-censor; junk reviews | Validate faculty teaches student's batch; anonymise | `rev_*` policies |
| L-6 | LOW | In-database copy `backup_20261003` (no PK/RLS; not API-exposed) | Extra copy of financial data to manage under DPDP retention | Export off-platform and drop after agreed retention | catalog |
| L-7 | LOW | Edge functions return raw error messages; CORS `*` | Minor information leakage | Generic errors to client, details to logs; restrict origins | `create-user/index.ts` |
| L-8 | LOW | `can_view_financials()` ignores `super_admin` unless flag set (UI treats Owner as financial) | Owner could be blocked by DB if flag cleared | Include `super_admin` in helper | function body vs `src/lib/access.js` |
| L-9 | LOW | SheetJS loaded from vendor CDN tarball (blocked in audit sandbox) | Build fails if CDN is unreachable; supply-chain single point | Vendor the tarball or mirror; keep lockfile integrity | `package.json` |

Not present / not applicable: no service-role key in front-end ✔; rate limiting = Supabase Auth defaults only; input validation exists client-side (`src/lib/validation.js`) and partly in DB (CHECKs, RPC validation in `bulk_upsert_students`).

---

## A7. Oksy-specific dependencies

| File / table | What is hard-coded | Suggested replacement |
|---|---|---|
| `src/components/Login.jsx:49-51,61,103` | Logo, "Welcome to Oksy Academy", placeholder `you@oksy.in`, "An Oksy Academy admin…" | Tenant branding (`tenant_settings.name/logo`) or neutral PULSE copy before tenant is known |
| `src/App.jsx:187, 206, 1433-1477` | "Oksy Academy admin", logo, "OKSY ACADEMY", "Oksy Academy Pulse v2.0" | Tenant settings + product name config |
| `index.html:7`, `public/oksy-logo.jpeg`, `public/favicon.svg` | Title, logo file | Product brand; tenant logo in Storage |
| `src/components/Receipt.jsx:20-23` | Logo, "OKSY ACADEMY LLP", full Manjeri address | Tenant legal name, address, GSTIN/PAN, contact (settings) |
| `src/pages/ReportsPage.jsx:126` | "OKSY ACADEMY LLP — report" header | Tenant legal name |
| `src/lib/format.js:19-28`, `src/App.jsx:725`, `src/lib/reconcile.js:754` | Receipt prefix `OKSY/` + global id | Per-tenant receipt series (prefix + FY + sequence) |
| `src/App.jsx:298-306` | `localStorage` key `oksy.nav` | Neutral key |
| DB CHECKs `collections_account_check`, `expenses_account_check`, `transfers_from/to_account_check`, `bank_statements_account_check`, `bank_statement_lines_account_check` | Accounts HDFC/ICICI/Cash/Healthcare | `money_accounts` table per tenant (FK) |
| `src/App.jsx:149`, `CreateNewTab.jsx:7`, `ExpensesPage.jsx:13`, `FeeCollectionPage.jsx:12,127`, `BankingPage.jsx:35`, `validation.js:38,85,103`, `reports.js:49,94,246` | Same account list in JS | Load accounts from DB |
| `src/App.jsx:523-542`, `Dashboard.jsx:260-268`, `BankingPage.jsx:99-101`, `reports.js:281-315`, `FeeCollectionPage.jsx:140-143`, `ExpensesPage.jsx:85-88`, `App.jsx:1148-1152,1243-1248` | "Healthcare" as the inter-company party; legacy import mapping | Generic **related party** rows (`parties` with type `related_party`) + per-party balance |
| `supabase/05_super_admin.sql:83` | Owner's personal e-mail | Onboarding flow creates owner membership |
| `enforce_batch_name_rule()` trigger (migrations 25/30) | Oksy batch naming format (uppercase, allowed chars) | Tenant setting (optional regex) or drop |
| `student_id_prefix_for_batch()`, `allocate_student_id()` (migration 26) | ID = course code + 3-digit number, global uniqueness | Per-tenant ID format setting + per-tenant sequence |
| `students` fee columns, `batches` fee columns | Exactly 4 fee heads | Fee heads table per tenant |
| `expense_categories` (36 rows, e.g. GEC Commission) | Oksy's category list (`19b_backfill_missing_expense_categories.sql`) | Starter template + tenant-editable |
| `bankStatement.js` parser | ICICI-style layout | Parser profiles per bank |
| `src/lib/access.js` ROLE_LABEL | "Owner", "Executive", "Professionals" labels | Tenant-renamable role labels (optional) |
| `src/pages/BankingPage.jsx:199` | Placeholder "Healthcare repayment" | Neutral text |
| `.vercel/project.json` (`oksy-academy-finance`), edge-function path `oksy-academy-finance` | Old project/repo names | Rename Vercel project for product |
| `pg_cron` schedule 00:05 IST, `ist_today()` | India timezone assumption | Tenant timezone setting (default Asia/Kolkata) |
| Docs (`README.md`, `PROJECT_OVERVIEW.md`, `CLAUDE.md`, `AGENTS.md`, `SETUP.md`) | "for Oksy Academy LLP", single-institute instructions | Product docs + tenant onboarding docs |
| Whole schema | **Assumption that only one institute exists**: global UNIQUE on batch name, course code/name, category name, student ID; singleton settings; global roles | `tenant_id` + composite uniques (see 03 §C3) |

No GST/PAN numbers, phone numbers or bank account numbers are hard-coded in code (searched).

---

## A8. Code quality & engineering health

| Check | Result | How verified |
|---|---|---|
| Tests | **326 tests, 320 pass, 0 fail, 6 skipped** (the 6 are live-Supabase RLS suites that skip without test env vars). Coverage strongest on `fees.js`, `reconcile.js`, `access.js`, `validation.js`, `studentBulk.js`; no UI/component tests, no E2E | `npm test` on clean clone |
| Lint | **0 errors, 7 warnings** (`react(purity)`: `Date` called during render in Dashboard, ReportsPage, LiveClassPage, TimetablePage). Note: lint ran with oxlint 1.87 because the lockfile had to be regenerated (SheetJS CDN blocked in sandbox, `xlsx` 0.18.5 substituted for the run only) — results with the pinned version may differ slightly | `npm run lint` |
| Type-check | Not applicable (no TypeScript) | — |
| Build | **Passes** (Vite, < 1 s). Entry chunk 195 kB (budget 200 kB per `CLAUDE.md`); warning: `academy.js` dynamic import ineffective | `npm run build` |
| CI | None for lint/test/build | `.github/workflows/` |
| Large files | `App.jsx` 1,717 lines (state + handlers + math), `App.css` 3,253, `reconcile.js` 1,180, `BankingPage.jsx` 929, `Dashboard.jsx` 754 | `wc -l` |
| Duplicated logic | Account list duplicated in 6+ files; role/financial logic duplicated in `AuthContext.jsx` and `access.js` | grep |
| Data loading | Every save calls `loadData()` which re-downloads all tables (`App.jsx:648-789`) | code |
| Unbounded queries | All `fetch*` functions select whole tables with no range | `src/lib/data.js` |
| DB performance advisors | 38 unindexed foreign keys; 18 RLS policies re-evaluating `auth.uid()` per row (`auth_rls_initplan`); 13 multiple-permissive-policy warnings; 3 unused indexes | `get_advisors(performance)` |
| Dead code | `signUp` in AuthContext (no UI); full_name self-update in `loadProfile` silently fails (no self-update policy); Exams & Reviews modules unused in production | code + counts |
| Documentation | Rich (README, PROJECT_OVERVIEW, SETUP, 11 audit docs, `.agents/skills`) **but drifting**: says xlsx ^0.18 and "36 assertions"; README says migrations 01–10; AGENTS.md says embedded Jitsi; commit messages say migrations not applied that are applied | compare docs vs code/DB |

---

## A9. Data inventory (counts only)

| Table | Rows | | Table | Rows |
|---|---|---|---|---|
| students | 136 (Active 55, Completed 61, Dropped 20, Registered 0) | | bank_statement_lines | 220 (all matched) |
| collections | 584 (Cash 268, ICICI 276, Healthcare 39, HDFC 1) | | bank_match_links | 222 |
| expenses | 585 (Cash 537, ICICI 22, Healthcare 21, HDFC 5) | | bank_sync_history | 201 |
| transfers | 40 | | bank_statements | 2 |
| audit_log | 1,240 | | expense_categories | 36 |
| profiles / auth.users | 14 / 14 (Owner 1, Admin 6, Executive 5, Faculty 1, Student 1) | | batches / courses | 7 / 2 |
| assignments / submissions | 3 / 2 | | timetable_slots / live_sessions / attendance | 2 / 2 / 1 |
| exams, questions, attempts, answers, faculty_reviews | 0 | | notifications | 2 |
| storage objects | 3 | | app_settings | 1 |

Date range: collections 2025-04-30 → 2026-10-06; expenses 2025-05-28 → 2026-10-06; audit_log from 2026-09-14.

**Data-quality issues**

1. Collection `type` free text: 6 spellings for 4 fee heads (incl. one misspelling) — must be normalised before mapping to income accounts.
2. 132 of 136 students have no phone number; contact data mostly empty.
3. 2 students have paid more than their effective fee (credit balance).
4. Possible duplicates: 5 collection groups and 25 expense groups with identical key fields (review, may be legitimate).
5. 1 student login has no `student_ref` link.
6. Two `batches` CHECK constraints are `NOT VALID` (old rows never validated).
7. Natural-key foreign keys by **name** (`students.batch`, `expenses.category`, `profiles.batch_name`, academy tables) — renames cascade; uniqueness is global.
8. `audit_log.row_id` is bigint, so student-related audit rows use `row_id = 0` with the real ID inside JSON.
9. No orphans possible on FK columns (FKs validated); no future-dated money rows; no fractional-paise amounts.

**Risks for migrating into Tenant #001**

- Global unique keys (student ID text, batch name, course code/name, category name) must become unique **per tenant**; text student IDs like the current ones will collide across institutes unless the PK becomes `(tenant_id, id)` or a surrogate UUID.
- FKs by name must be rebuilt as composite `(tenant_id, name)` or switched to ids — touches ~10 FKs and cascades.
- `audit_log` and `bank_sync_history` JSON copies need `tenant_id` back-filled from their source tables.
- `profiles.role` must be copied into a membership row for Tenant #001 for all 14 users without locking anyone out (the Owner especially).
- Storage paths have no tenant prefix (3 objects to move/rename).
- `backup_20261003` schema should not be migrated.
- Production schema ≠ repo schema (M-7): take a fresh schema dump before designing migration scripts.
