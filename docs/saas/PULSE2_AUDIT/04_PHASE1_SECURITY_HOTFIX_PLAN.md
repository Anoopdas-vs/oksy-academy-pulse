# 04 — Phase 1 Plan: Security Hot-fixes on Current Production

> **Status (21 Oct 2026): APPROVED by Anoop (D-1, D-18 = yes). Migrations 40–48 written and applied to STAGING ONLY; all checks pass there. Production NOT touched — waiting for walkthrough sign-off + explicit go-ahead.** Results: see §0.1.
> Prepared 2026-10-06 from the Phase 0 audit (`01_CURRENT_SYSTEM_AUDIT.md` §A6). **Revised 2026-10-21** (see §0: migration numbers now start at 40; conflicts with migrations 38/39 checked).

## 0. Revision 2026-10-21 (after PR #36)

**Numbering:** migrations 38 (`38_student_delete_any_status.sql`) and 39 (`39_adjustments_account.sql`) are taken and both are **verified applied on production** (read-only check, 21 Oct). Phase 1 files are `supabase/40_…` onwards, one per fix:

| Fix | File |
|---|---|
| 1.1 notify_batch guard | `40_guard_notify_batch.sql` |
| 1.3 expenses select | `41_expenses_select_staff_only.sql` |
| 1.4 collections_basic | `42_collections_basic_filter.sql` |
| 1.5 grading triggers | `43_block_self_grading.sql` |
| 1.6 notifications insert | `44_drop_notif_insert.sql` |
| 1.7 attendance own batch | `45_attendance_own_batch.sql` |
| 1.8 upload limits | `46_submissions_bucket_limits.sql` |
| 1.9 function hygiene | `47_function_hygiene.sql` |
| 1.10 fee/waiver guard (only if D-18 = yes) | `48_staff_cannot_change_fees.sql` |

(1.2 and 1.11 have no SQL.) Re-check the highest number on `main` before each file is created; "Features & UI" may add 40+ first.

**Conflicts / interactions found:**
1. **Migration 38 vs 1.9 / 1.10 / new test.** `delete_mistaken_student()` is `SECURITY DEFINER`, Owner/Admin only (`is_admin()` = role admin or super_admin, approved), already `revoke … from public, anon` + `grant … to authenticated`. 1.9 must **leave it as is** (not in the revoke list). It is a delete, not an update, so the 1.10 trigger does not touch it. **Add test:** anon, student, faculty, staff/Executive get an error; Admin succeeds on a student with no live receipt/login; Admin is refused when a live receipt or linked login exists; every delete writes `audit_log`.
2. **Migration 39 vs Phase 1.** No conflict: it only changes the two CHECK constraints on `transfers`. Phase 1 must not touch `transfers`. Add a regression test: an `Adjustments` transfer still inserts; `collections.account` / `expenses.account` still reject `Adjustments`.
3. **1.3 / 1.4 and the 13 reports.** All reports (incl. Healthcare Account Statement, Fee Collection Register, Student Dues, Expense Register) read `expenses` / `collections` in the browser. Staging walkthrough must open **all 13 reports** as Owner, Admin and Executive (with and without `can_view_financials`) and check the numbers are unchanged. Executive-without-financials behaviour is still to be confirmed before 1.3 is coded.
4. **1.5 – 1.7:** no overlap with 38/39 or with recon UTR matching.
5. **Test count:** "326 existing tests" is stale; use the count from `npm test` on current `main`.
6. **Drift to note (not Phase 1):** production's migration history list shows 28, 32–37 and `adjustments_account` only; 38 was applied (function body is new) but is not in that list. Phase 2 baseline must reconcile this. Staging must be checked for 38/39 before the Phase 1 test run.
7. **Docs location:** these docs now live in `docs/saas/` in the repo (branch `docs/saas-phase1-plan`).

> **ചുരുക്കത്തിൽ:** ഇപ്പോഴത്തെ app-ലെ security പഴുതുകൾ അടയ്ക്കുക മാത്രമാണ് ഈ phase-ന്റെ ലക്ഷ്യം. Table-കളുടെ ഘടനയോ data-യോ മാറ്റില്ല — ആര്‌ എന്ത് കാണാം/മാറ്റാം എന്ന rules മാത്രം. ആദ്യം staging-ൽ, പിന്നെ നിങ്ങളുടെ അനുമതിയോടെ production-ൽ. ഏകദേശം 4–5 പ്രവൃത്തി ദിവസം.

### 0.1 Staging results (21 Oct 2026)

- Applied to `oksy-pulse-staging` (`mgiowjacjyhdtvrlhaaa`): 40–48, plus 38 (staging was missing it — drift) and a small patch revoking `authenticated` EXECUTE on the trigger functions (folded into the 43/47/48 files).
- `supabase/checks/40_48_phase1_checks.sql`: 36 of 37 passed on the first run; the one failure was staging missing migration 38, and it passed after 38 was applied (re-run of that check alone) (impersonates the existing staging super_admin, Executive, faculty and two students; rolls back). Covers 1.1, 1.3–1.10, migration 38 delete rules and migration 39 regression.
- `npm test` 385 pass / 0 fail / 6 skipped (live-RLS suites skip without env); `npm run lint` clean; `npm run build` OK.
- Advisor (staging): remaining anon-executable definer functions are only the policy helpers (`is_admin`, `is_super_admin`, `is_staff_or_admin`, `is_approved_user`, `can_view_financials`, `my_batch`, `my_student_ref`, `teaches_batch`) — deliberately left for Phase 3. `collections_basic` and `exam_questions_public` still flagged as SECURITY DEFINER views (Phase 3 rebuild). Leaked-password protection = manual step M-1.
- Known limits: "student sees only own receipts" ran with a student who has 0 receipts (proves no foreign rows, not own-row visibility); the walkthrough must confirm a student with receipts sees them. Executive UI will show a database error if an Executive edits fee fields in Enrollment (no UI change in Phase 1).
- **In-app walkthrough on staging (21 Oct, done by Claude via local app, staging test logins):** Executive: fee change blocked with message "Only the Owner or an Admin can change fee amounts"; non-fee edit OK; Dropped write-off OK; Fee Collection (9 receipts), Expenses, Admin open; only 2 reports shown (Fee Collection Register, Student Dues) and both load; batch Edit/Delete buttons not shown. Owner: all 12 report cards open with consistent totals (collected 27,500; expenses 540), fee and batch-fee changes OK. Student 1 and Faculty: all tabs load, no money tabs, no errors. Test data restored.
- **Second UI round with fixtures (21 Oct):** faculty publish -> student got the notification (notify_batch OK); student upload: 11 MB refused ("exceeded the maximum allowed size"), .exe refused ("mime type ... not supported"), 2 KB PDF accepted and resubmit OK; submission stored as submitted/ungraded; exam 1 of 2 correct scored 1/2 = 50 % passed; live class Join recorded attendance; faculty grading (SQL as faculty) kept 8/graded.
- **Pre-existing bug found (NOT caused by Phase 1, identical on production):** faculty/staff always see "No submissions yet" in Assignments > Submissions, because `fetchSubmissions` embeds `profiles` but `assignment_submissions` has two FKs to profiles (student_id, graded_by) -> PostgREST "more than one relationship" error, swallowed. Fix (separate small change): embed `profiles!assignment_submissions_student_id_fkey(full_name,email)`. Only `assignment_submissions` is affected (exam_attempts/attendance have one FK). **Fixed on branch `fix/submissions-profile-embed` (commit 380e11b, off origin/main, not pushed/merged):** verified on staging, faculty sees the submission and can grade it; test 385 pass, lint, build OK. It is app code, so it ships via merge to `main` (auto-deploy) separately from the DB migrations.
- Not yet done: production apply (runbook: `06_PHASE1_PRODUCTION_RUNBOOK.md`), manual steps M-1…M-4.

## 1. Goal (one purpose)

Close the exposures that exist **today** in production, before any SaaS work starts. No table structure changes, no data changes, no new features.

## 2. What will change

| # | Fix | Finding | What changes (database / config) | Who notices a difference | Risk |
|---|---|---|---|---|---|
| 1.1 | Guard `notify_batch()` | C-1 (HIGH) | Function checks the caller is Owner/Admin/Executive or teaches that batch; `EXECUTE` revoked from `anon`/`public` | Nobody (only staff/faculty call it today from Assignments, Timetable, Exams) | Low |
| 1.2 | Delete stray edge function `smart-endpoint` | H-1 (HIGH) | Function removed from Supabase (not used by the app — only `create-user` is called in `src/lib/data.js`) | Nobody | Low |
| 1.3 | Expenses readable only by Owner/Admin/Executive | H-2 (HIGH) | Policy `expenses_approved_select` → `is_staff_or_admin()` | Students/faculty lose API access they should never have had; screens unchanged | Low |
| 1.4 | Fee receipts readable only by staff, plus a student's own receipts | H-3 (HIGH) | View `collections_basic` filter → `is_staff_or_admin() OR student_id = my_student_ref()` | Same as above | Low |
| 1.5 | Students cannot self-grade or forge exam results | H-4 (MED) | BEFORE INSERT triggers on `assignment_submissions` and `exam_attempts` force grading/score fields to empty for non-managers | Nobody (app never sends those fields on insert) | Low |
| 1.6 | Remove direct notification inserts | M-2 (MED) | Drop policy `notif_insert` (app only uses `notify_batch`) | Nobody | Low |
| 1.7 | Attendance only for own batch's sessions | L-2 (LOW) | `attend_self_insert` also checks the session belongs to `my_batch()` | Nobody | Low |
| 1.8 | Upload limits | M-4 (MED) | Bucket `submissions`: 10 MB limit + allowed file types = the list already in `AssignmentsPage.jsx:298` (line number from the audit; re-check) | A student uploading > 10 MB gets an error | Low |
| 1.9 | Function hygiene | L-1 (LOW) | Revoke `anon` EXECUTE on non-helper SECURITY DEFINER functions (`resubmit_assignment`, `score_exam_attempt`, `clear_my_must_change_password`, `handle_new_user`, `log_financial_change`, `rls_auto_enable`); set `search_path` on 5 functions. Policy helper functions (`is_admin` etc.) are left as-is until Phase 3 to avoid breaking policies | Nobody | Low |
| 1.10 | *(needs decision D-18)* Executive cannot change fee amounts / waiver | M-1 (MED) | Trigger blocks changes to fee and waiver columns of `students` (and fee columns of `batches`) unless Owner/Admin | Executives must ask an Admin to change fees. Edge case: marking a student *Dropped* auto-raises the waiver — will be allowed only through that exact rule | Medium |
| 1.11 | Manual settings (you do these, steps below) | L-3, H-5, M-6 | Leaked-password protection on; GitHub repo private; confirm nightly backup works | Nobody | Low |

**Not in Phase 1** (moved to Phase 2, because they change app code or need more testing): password-reset screen, 1,000-row / hidden-error totals problem, invite-only signup, receipts cancel-instead-of-delete.

## 3. How it will be done (safe order)

1. **Pre-checks (read-only):** confirm the latest nightly backup succeeded (you, step M-3 below); compare staging vs production policies so staging is a faithful test bed.
2. **Code:** one new branch `phase1/security-hotfixes`; one migration file per fix (`supabase/40_…` onwards; 38/39 are already used), each with a written **undo** script; new automated RLS tests for every fix.
3. **Staging:** apply migrations to `oksy-pulse-staging`; run all tests (326 existing + new); run the app locally against staging and walk through every tab as Owner, Admin, Executive, Faculty, Student (checklist in §5).
4. **Your approval** (you see the test results and the checklist).
5. **Production:** fresh backup → apply the same migrations → re-run Supabase security advisor → quick smoke test on pulse.oksyacademy.in.
6. **Docs:** update project docs and `01` audit status.

## 4. Tests that must pass

- Existing: `npm test`, `npm run lint`, `npm run build`.
- New RLS tests (against staging): anon cannot call `notify_batch`; student cannot read `expenses`; student sees only own rows in `collections_basic`; student insert with `marks`/`status='graded'` ends up ungraded; student insert of pre-scored exam attempt ends up unscored; student cannot insert a notification; student cannot mark attendance in another batch's session; upload > 10 MB rejected; (1.10) Executive cannot change `course_fee`/`waiver`, Admin can.
- Advisor: no `anon` SECURITY DEFINER warning for the functions in 1.1/1.9.

## 5. Staging walkthrough checklist (per role)

Owner/Admin: Dashboard numbers unchanged · record + edit + delete a receipt · record an expense · Banking reconciliation opens · Reports open and export · create assignment and notify batch.
Executive: Enrollment add/edit (personal fields) · Fee Collection record · Expenses tab visible if granted · cannot change fees (if 1.10 approved).
Faculty: Timetable, Assignments (create, grade), notify batch works.
Student: Dashboard, Timetable, submit assignment (small file OK, 11 MB file rejected), join live class.

## 6. Rollback

Each migration has an undo script that restores the exact previous policy/function text (captured from production on 2026-10-06). If anything breaks after production apply: run the undo for that one fix (minutes), or restore from the pre-change backup in the worst case. `smart-endpoint` source is saved in this audit's evidence and can be redeployed if ever needed (it should not be).

## 7. Exit criteria

All tests green on staging and production · walkthrough checklist passed · advisor clean for these items · you sign off · project docs updated.

## 8. Effort

About **4–5 working days** (1 day code + tests, 1 day staging + walkthrough, ½ day production, buffer).

## 9. Manual steps for Anoop (when we reach them — not now)

**M-1 Leaked-password protection**
1. supabase.com → sign in → project **Oksy Academy Pulse**.
2. Left menu **Authentication** → **Sign In / Providers** (or **Policies/Password security** depending on dashboard version) → **Email**.
3. Turn on **"Prevent use of leaked passwords"** → **Save**. (If it says it needs a paid plan, tell me — we'll note it for later.)

**M-2 Make the GitHub repo private** *(decision D-17)*
1. github.com → repo **Anoopdas-vs/oksy-academy-pulse** → **Settings** (top tab).
2. Scroll to the bottom **Danger Zone** → **Change repository visibility** → **Make private** → type the repo name → confirm.
3. Vercel keeps deploying (it uses the GitHub app, which still has access).

**M-3 Confirm the nightly backup works**
1. github.com → the repo → **Actions** tab → left list **Nightly database backup**.
2. Look at the latest run: green tick = OK. Red cross or "no runs" = tell me (the `SUPABASE_DB_URL` secret is probably missing).

**M-4 Delete `smart-endpoint`** (only after approval)
1. supabase.com → project **Oksy Academy Pulse** → left menu **Edge Functions**.
2. Click **smart-endpoint** → **Settings** (or ⋯ menu) → **Delete function** → confirm.
3. Make sure **create-user** is still listed.

## 10. Decision needed to start

- **Approve Phase 1 as above?** (yes / change something)
- **1.10 (D-18):** should Executives be blocked from changing fee amounts and waivers? Recommended: **yes**.
