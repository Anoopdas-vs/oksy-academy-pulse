# 03 — Gap Analysis (current Pulse → PULSE 2.0)

> Phase 0 deliverable · read-only · prepared 2026-10-06. Evidence references point to `01_CURRENT_SYSTEM_AUDIT.md` (§A…), repo files, or database objects. Nothing here has been implemented.

**Contents:** C1 capability gap matrix · C2 accounting deep-dive · C3 multi-tenancy gap · C4 architecture options · C5 risk register · C6 phase plan · C7 owner decisions
## C1. Capability gap matrix

Every capability ID from `02_TARGET_CAPABILITY_CATALOGUE.md` appears below exactly once.

**Legend** — Effort: S ≤ 2 days · M 3–7 days · L 1–3 weeks · XL > 3 weeks (solo founder + AI pair-programmer, including tests). Risk = chance of breaking production data/security if done badly.

### Summary

| Tier | EXISTS-COMPLETE | EXISTS-PARTIAL | MISSING | Total |
|---|---|---|---|---|
| T0 | 3 | 2 | 5 | 10 |
| T1 | 14 | 22 | 16 | 52 |
| T2 | 2 | 26 | 37 | 65 |
| T3 | 0 | 3 | 29 | 32 |
| T4 | 0 | 0 | 5 | 5 |
| **All** | 19 | 53 | 92 | 164 |

**T0 + T1 (January scope): 62 capabilities — 17 complete, 24 partial, 21 missing.** Note that even "complete" items need the tenant work (`tenant_id` + RLS) before they are SaaS-ready.

### 1. Platform & Tenancy

| ID | Capability | Current status | Evidence | Action | Effort | Risk | Tier | Depends on |
|---|---|---|---|---|---|---|---|---|
| PLT-01 | Tenant registry | MISSING | No tenants table in `public` (catalog query, A3) | ADD | M | High | T0 | — |
| PLT-02 | Tenant data isolation | MISSING | No `tenant_id` column anywhere; all policies are role-only (`pg_policies`, A3) | ADD | XL | High | T0 | PLT-01, IAM-04 |
| PLT-03 | Tenant settings store | EXISTS-PARTIAL | `app_settings` is a global singleton (`app_settings_singleton CHECK (id = 1)`), holds only `roleAreas` | REFACTOR | M | Med | T1 | PLT-01 |
| PLT-04 | Branding | MISSING | Hard-coded: `src/components/Login.jsx:49-51`, `src/App.jsx:1433-1477`, `public/oksy-logo.jpeg`, `index.html:7` | ADD | M | Low | T1 | PLT-03 |
| PLT-05 | Legal & contact details | MISSING | Hard-coded address in `src/components/Receipt.jsx:22-23`; `OKSY ACADEMY LLP` in `src/pages/ReportsPage.jsx:126` | ADD | S | Low | T1 | PLT-03 |
| PLT-06 | Tenant subdomain | MISSING | Single domain `pulse.oksyacademy.in` (CLAUDE.md §1) | ADD | M | Med | T2 | PLT-01 |
| PLT-07 | Custom domain | MISSING | — | ADD | M | Med | T3 | PLT-06 |
| PLT-08 | Tenant suspension | MISSING | — | ADD | S | Med | T1 | PLT-01, PLT-02 |
| PLT-09 | Platform admin console | MISSING | Today `super_admin` means the institute Owner (`src/lib/access.js` ROLE_LABEL) — there is no platform tier | ADD | M | Med | T1 | PLT-01, IAM-05 |
| PLT-10 | Platform audit log | MISSING | `audit_log` covers only collections/expenses/transfers update/delete (`pg_trigger`) | ADD | M | Med | T1 | PLT-09 |
| PLT-11 | Feature flags per tenant | EXISTS-PARTIAL | Per-role tab visibility only (`app_settings.data.roleAreas`, `src/lib/access.js`), global, UI-only | REFACTOR | S | Low | T1 | PLT-03 |
| PLT-12 | Onboarding wizard | MISSING | Manual SQL in SETUP.md §4 to create the first owner | ADD | L | Med | T1 | PLT-01, IAM-07, ACC-02 |
| PLT-13 | Per-tenant data export | EXISTS-PARTIAL | Report-level Excel export only (`src/lib/reports.js`) | ADD | M | Med | T1 | PLT-02 |
| PLT-14 | Per-tenant data deletion | MISSING | — | ADD | M | High | T1 | PLT-02, CMP-04 |
| PLT-15 | Subscription & billing | MISSING | — | ADD | L | Med | T2 | PLT-01 |
| PLT-16 | Plan limits / quotas | MISSING | — | ADD | M | Low | T3 | PLT-15 |
| PLT-17 | Tenant-aware scheduled jobs | EXISTS-PARTIAL | Global `cron.job` 'batch-auto-student-status' runs `run_batch_status_automation()` over all rows | MODIFY | S | Med | T1 | PLT-02 |
| PLT-18 | Environments & migration pipeline | EXISTS-PARTIAL | Staging project exists (`oksy-pulse-staging`); hand-run `supabase/NN_*.sql`; only 7 rows in `supabase_migrations` (28, 32-37); no CI workflow for lint/test/build (`.github/workflows/`) | REFACTOR | M | Med | T0 | — |
| PLT-19 | Neutral product copy | MISSING | `src/App.jsx:187,298,725`, `src/lib/format.js:19` | MODIFY | S | Low | T1 | PLT-04 |
| PLT-20 | Error monitoring & observability | MISSING | Only `src/components/ErrorBoundary.jsx`; no monitoring service | ADD | S | Low | T1 | — |

### 2. Identity & Access

| ID | Capability | Current status | Evidence | Action | Effort | Risk | Tier | Depends on |
|---|---|---|---|---|---|---|---|---|
| IAM-01 | Email + password login | EXISTS-COMPLETE | `src/components/Login.jsx`, `src/context/AuthContext.jsx` | KEEP | S | Low | T0 | — |
| IAM-02 | Google sign-in | EXISTS-COMPLETE | `signInWithOAuth({provider:'google'})` in `AuthContext.jsx`; any Google account can create an (unapproved) auth user | MODIFY | S | Low | T2 | IAM-07 |
| IAM-03 | Password reset | EXISTS-PARTIAL | `resetPasswordForEmail` exists; no `PASSWORD_RECOVERY` handler / new-password screen found (grep `src/`) — likely broken, verify manually | MODIFY | S | Low | T1 | — |
| IAM-04 | Tenant memberships | MISSING | Role is a single global column `profiles.role` | ADD | L | High | T0 | PLT-01 |
| IAM-05 | Role model | EXISTS-PARTIAL | `profiles_role_check`: super_admin/admin/staff/student/faculty/professional; finance access is a boolean flag; no parent/platform roles | REFACTOR | M | High | T1 | IAM-04 |
| IAM-06 | Permission model | EXISTS-PARTIAL | UI tab list (`roleAreas`) + SQL helpers `is_admin()`, `is_staff_or_admin()`, `can_view_financials()` | REFACTOR | L | High | T1 | IAM-04, IAM-05 |
| IAM-07 | Invitations | EXISTS-PARTIAL | `create-user` edge function sets an admin-chosen temp password + `must_change_password` (`supabase/functions/create-user/index.ts`) | MODIFY | M | Med | T1 | IAM-04 |
| IAM-08 | Invite-only access | EXISTS-PARTIAL | Approval gate `profiles.is_approved`; `signUp` and Google OAuth still create auth users (`AuthContext.jsx`) | MODIFY | S | Med | T1 | IAM-07 |
| IAM-09 | Session management | EXISTS-PARTIAL | Supabase defaults (`persistSession`, `autoRefreshToken` in `src/lib/supabaseClient.js`) | MODIFY | S | Low | T2 | — |
| IAM-10 | Multi-factor authentication | MISSING | — | ADD | M | Low | T3 | — |
| IAM-11 | Login & activity audit | MISSING | Only Supabase auth logs | ADD | M | Low | T2 | PLT-10 |
| IAM-12 | Tenant switcher | MISSING | — | ADD | S | Med | T1 | IAM-04 |
| IAM-13 | Password policy | MISSING | Advisor `auth_leaked_password_protection` = disabled | MODIFY | S | Low | T1 | — |
| IAM-14 | User lifecycle management | EXISTS-PARTIAL | `src/components/StaffAccess.jsx` approve/role/financial toggles; no deactivate | MODIFY | M | Med | T1 | IAM-04 |

### 3. Accounting & Finance

| ID | Capability | Current status | Evidence | Action | Effort | Risk | Tier | Depends on |
|---|---|---|---|---|---|---|---|---|
| ACC-01 | Chart of accounts | MISSING | No accounts table; categories are free-standing (`expense_categories`) | ADD | L | Med | T2 | PLT-02 |
| ACC-02 | Money accounts | EXISTS-PARTIAL | CHECK constraints `collections_account_check`, `expenses_account_check`, `transfers_*_account_check`, `bank_statements_account_check`; `ACCOUNTS` const in `src/App.jsx:149` and 5 other files | REFACTOR | M | High | T1 | PLT-02 |
| ACC-03 | Parties register | MISSING | Only `students`; vendors are free text in `expenses.description` | ADD | M | Med | T2 | ACC-01 |
| ACC-04 | Related-party (inter-company) tracking | EXISTS-PARTIAL | Pseudo-account 'Healthcare' in CHECKs; balance logic `src/App.jsx:523-542`; report `src/lib/reports.js:281-315` | REFACTOR | M | High | T1 | ACC-02 |
| ACC-05 | Double-entry journal & ledger | MISSING | Single-entry rows with an `account` column (`collections`, `expenses`, `transfers`) | ADD | XL | High | T2 | ACC-01, ACC-03 |
| ACC-06 | Other income | MISSING | `income` table dropped (`supabase/08_drop_income_table.sql`) | ADD | S | Low | T2 | ACC-02 |
| ACC-07 | Expenses with categories | EXISTS-COMPLETE | `expenses`, `expense_categories`, `src/pages/ExpensesPage.jsx` | MODIFY | S | Low | T1 | PLT-02 |
| ACC-08 | Bank & cash balances | EXISTS-PARTIAL | Computed in browser `accountBalance()` (`src/lib/fees.js`); no opening balance field | MODIFY | M | Med | T1 | ACC-02, ACC-33 |
| ACC-09 | Bank statement import & reconciliation | EXISTS-COMPLETE | `bank_statements`, `bank_statement_lines`, `bank_match_links`, `bank_sync_history`; `src/lib/reconcile.js` (tested); parser tuned to ICICI layout (`src/lib/bankStatement.js`) | MODIFY | M | Med | T1 | ACC-02 |
| ACC-10 | Transfers between accounts | EXISTS-COMPLETE | `transfers`, Banking → Transfers | MODIFY | S | Low | T1 | ACC-02 |
| ACC-11 | Fee structures | EXISTS-PARTIAL | Fixed fee columns on `batches` and `students` (registration/course/exam/other) | REFACTOR | M | Med | T1 | PLT-02 |
| ACC-12 | Installment plans | MISSING | — | ADD | M | Med | T2 | ACC-11 |
| ACC-13 | Discounts / scholarships / waivers | EXISTS-PARTIAL | Single `students.waiver` number; auto-raised on Drop (`waiverForDrop()` in `src/lib/fees.js`) | MODIFY | M | Med | T1 | ACC-11 |
| ACC-14 | Receipts | EXISTS-PARTIAL | Number = `OKSY/` + row id (`src/lib/format.js:19`); receipts editable/deletable (17 deleted collections in `audit_log`) | REFACTOR | M | High | T1 | PLT-03 |
| ACC-15 | Invoices / fee demand notes | MISSING | — | ADD | M | Med | T2 | ACC-11, ACC-21 |
| ACC-16 | Refunds & credit notes | MISSING | `collections_amount_check (amount > 0)`; no refund type | ADD | M | Med | T2 | ACC-14 |
| ACC-17 | Dues & outstanding | EXISTS-COMPLETE | `studentFeeTotals()` in `src/lib/fees.js`; Receivables report | KEEP | S | Low | T1 | — |
| ACC-18 | Due reminders | MISSING | — | ADD | M | Low | T2 | ACC-12, COM-03 |
| ACC-19 | Vendor bills & payables | MISSING | — | ADD | M | Low | T3 | ACC-03, ACC-05 |
| ACC-20 | Payroll / faculty payments | MISSING | Only as expense categories | ADD | L | Med | T3 | ACC-03 |
| ACC-21 | GST / tax handling | MISSING | — | ADD | M | Med | T2 | ACC-11 |
| ACC-22 | Period closing / locking | MISSING | Any admin can edit/delete any past record (`collections_admin_update/delete`) | ADD | M | Med | T2 | ACC-05 |
| ACC-23 | Profit & loss | EXISTS-PARTIAL | `src/lib/reports.js` P&L; dashboard Net P&L double-counts related-party expenses (`src/App.jsx:542`) | MODIFY | M | Med | T1 | ACC-04 |
| ACC-24 | Balance sheet | MISSING | — | ADD | M | Med | T2 | ACC-05 |
| ACC-25 | Trial balance | MISSING | — | ADD | S | Low | T2 | ACC-05 |
| ACC-26 | Cash-flow statement | MISSING | Only point-in-time cash/bank position | ADD | M | Low | T2 | ACC-05 |
| ACC-27 | Party statements | EXISTS-PARTIAL | Receivables + Inter-company reports (`src/lib/reports.js`) | MODIFY | S | Low | T1 | ACC-04 |
| ACC-28 | Receivables aging | MISSING | — | ADD | S | Low | T2 | ACC-12 |
| ACC-29 | Approvals (maker-checker) | MISSING | — | ADD | M | Low | T3 | IAM-06 |
| ACC-30 | Financial audit trail | EXISTS-PARTIAL | `audit_log` triggers only UPDATE/DELETE on collections/expenses/transfers; no INSERT, no students/fee changes (except two RPCs) | MODIFY | S | Med | T1 | PLT-02 |
| ACC-31 | Multi-currency | MISSING | — | ADD | L | Low | T3 | ACC-05 |
| ACC-32 | Online fee payment | MISSING | — | ADD | L | Med | T2 | ACC-14, INT-01 |
| ACC-33 | Opening balances | MISSING | Only statement-level opening balance (`bank_statements.opening_balance`) | ADD | S | Med | T1 | ACC-02 |
| ACC-34 | Financial-year handling | EXISTS-PARTIAL | 'This FY' in `src/components/PeriodFilter.jsx`; FY not used for receipt numbering | MODIFY | S | Low | T1 | ACC-14 |

### 4. Student Lifecycle

| ID | Capability | Current status | Evidence | Action | Effort | Risk | Tier | Depends on |
|---|---|---|---|---|---|---|---|---|
| STU-01 | Leads / enquiries | MISSING | Only `students.lead_source` column | ADD | M | Low | T2 | PLT-02 |
| STU-02 | Admission / enrolment | EXISTS-COMPLETE | `enroll_student()` RPC, `src/pages/EnrollmentPage.jsx` | MODIFY | S | Med | T1 | PLT-02 |
| STU-03 | Student profile | EXISTS-COMPLETE | `students` columns from `supabase/24_students_personal_fields.sql` | MODIFY | S | Med | T1 | PLT-02 |
| STU-04 | Guardians | EXISTS-PARTIAL | Single `parent_name`/`parent_phone`/`guardian_relation` | MODIFY | S | Low | T2 | STU-03 |
| STU-05 | Student documents | MISSING | Only `submissions` bucket exists | ADD | M | Med | T2 | PLT-02 |
| STU-06 | Auto student ID | EXISTS-COMPLETE | `allocate_student_id()`, `student_id_prefix_for_batch()` (`supabase/26_*.sql`); global, prefix = course code | MODIFY | S | Med | T1 | PLT-02 |
| STU-07 | Batch assignment | EXISTS-COMPLETE | `students.batch` FK → `batches(name)` | MODIFY | S | Med | T1 | PLT-02 |
| STU-08 | Bulk import / update | EXISTS-COMPLETE | `bulk_upsert_students()` RPC, `src/components/StudentBulkUpload.jsx` | MODIFY | S | Med | T1 | PLT-02 |
| STU-09 | Status lifecycle | EXISTS-COMPLETE | `run_batch_status_automation()` + cron; `students_follow_batch_dates` trigger | MODIFY | S | Med | T1 | PLT-17 |
| STU-10 | Batch transfer with history | EXISTS-PARTIAL | Batch is editable; no history | ADD | S | Low | T2 | STU-07 |
| STU-11 | Completion & alumni | EXISTS-PARTIAL | Status 'Completed' only | ADD | S | Low | T3 | — |
| STU-12 | Certificates | MISSING | — | ADD | M | Low | T2 | PLT-04 |
| STU-13 | Student login linking | EXISTS-PARTIAL | `profiles.student_ref`; 1 student login has no link (A9) | MODIFY | S | Med | T1 | IAM-04 |

### 5. Academics

| ID | Capability | Current status | Evidence | Action | Effort | Risk | Tier | Depends on |
|---|---|---|---|---|---|---|---|---|
| ACA-01 | Courses | EXISTS-COMPLETE | `courses` (2 rows), Admin → Courses | MODIFY | S | Low | T1 | PLT-02 |
| ACA-02 | Curriculum / modules / lessons | MISSING | — | ADD | L | Low | T3 | ACA-01 |
| ACA-03 | Batches | EXISTS-COMPLETE | `batches`; Oksy-specific name rule trigger `enforce_batch_name_rule()` | MODIFY | S | Med | T1 | PLT-02 |
| ACA-04 | Timetable | EXISTS-PARTIAL | `timetable_slots` (2 rows), `timetable_no_conflict()` trigger | MODIFY | S | Low | T2 | PLT-02 |
| ACA-05 | Attendance | EXISTS-PARTIAL | `attendance` (1 row) tied to live sessions only | MODIFY | M | Med | T2 | ACA-04 |
| ACA-06 | Course completion % | MISSING | — | ADD | M | Low | T2 | ACA-02 |
| ACA-07 | Assignments | EXISTS-PARTIAL | `assignments` (3), `assignment_submissions` (2); self-grade possible on INSERT (A6 H-5) | MODIFY | S | Med | T2 | PLT-02 |
| ACA-08 | Online exams | EXISTS-PARTIAL | `exams` (0 rows – unused); attempt forgery possible on INSERT; timer not enforced server-side | MODIFY | M | Med | T2 | PLT-02 |
| ACA-09 | Offline marks entry | MISSING | — | ADD | M | Low | T2 | ACA-08 |
| ACA-10 | Grades / report cards | MISSING | — | ADD | M | Low | T3 | ACA-09 |
| ACA-11 | Study material / library | MISSING | — | ADD | M | Low | T3 | PLT-02 |

### 6. Faculty

| ID | Capability | Current status | Evidence | Action | Effort | Risk | Tier | Depends on |
|---|---|---|---|---|---|---|---|---|
| FAC-01 | Faculty profile | EXISTS-PARTIAL | Only `profiles` row with role 'faculty' | ADD | S | Low | T2 | IAM-04 |
| FAC-02 | Assigned batches | EXISTS-COMPLETE | `faculty_batches` | MODIFY | S | Low | T2 | PLT-02 |
| FAC-03 | Personal timetable | EXISTS-PARTIAL | `slots_read` policy (faculty_id = auth.uid()) | MODIFY | S | Low | T2 | ACA-04 |
| FAC-04 | Mark attendance | EXISTS-PARTIAL | Policy `attend_staff_write`; UI coverage UNKNOWN — needs verification | MODIFY | S | Low | T2 | ACA-05 |
| FAC-05 | Create assignments / exams & grade | EXISTS-PARTIAL | `can_manage_assignment()`, `can_manage_exam()` | MODIFY | S | Low | T2 | ACA-07, ACA-08 |
| FAC-06 | Workload | MISSING | — | ADD | S | Low | T3 | ACA-04 |
| FAC-07 | Faculty payments | MISSING | — | ADD | M | Low | T3 | ACC-20 |
| FAC-08 | Faculty performance | MISSING | — | ADD | M | Low | T3 | REV-04 |

### 7. Student Portal

| ID | Capability | Current status | Evidence | Action | Effort | Risk | Tier | Depends on |
|---|---|---|---|---|---|---|---|---|
| SPT-01 | Student dashboard | EXISTS-PARTIAL | Role-tailored view in `src/pages/Dashboard.jsx` | MODIFY | S | Low | T2 | IAM-04 |
| SPT-02 | My profile | EXISTS-PARTIAL | Policy `students_staff_or_own_select`; UI UNKNOWN | MODIFY | S | Low | T2 | STU-13 |
| SPT-03 | Course details | EXISTS-PARTIAL | Batch via `profiles.batch_name` | MODIFY | S | Low | T2 | STU-13 |
| SPT-04 | Timetable view | EXISTS-PARTIAL | `TimetablePage.jsx` | KEEP | S | Low | T2 | ACA-04 |
| SPT-05 | Attendance view | MISSING | — | ADD | S | Low | T2 | ACA-05 |
| SPT-06 | Completion % | MISSING | — | ADD | S | Low | T3 | ACA-06 |
| SPT-07 | Assignment submission | EXISTS-PARTIAL | `AssignmentsPage.jsx`, `submissions` bucket | MODIFY | S | Med | T2 | ACA-07 |
| SPT-08 | Exam scores | EXISTS-PARTIAL | `exam_attempts`, `exams.results_released` | MODIFY | S | Low | T2 | ACA-08 |
| SPT-09 | Fee status & receipts | MISSING | No student fee screen; meanwhile DB lets any approved user read all collections (A6 H-3) | ADD | M | Med | T2 | ACC-14, CMP-08 |
| SPT-10 | Class & faculty feedback | EXISTS-PARTIAL | `faculty_reviews` (0 rows) | MODIFY | S | Low | T2 | REV-01 |
| SPT-11 | Support tickets | MISSING | — | ADD | M | Low | T2 | COM-07 |
| SPT-12 | Notifications | EXISTS-PARTIAL | `notifications`, `NotificationBell.jsx` | MODIFY | S | Med | T2 | COM-02 |
| SPT-13 | Live-class access | EXISTS-PARTIAL | `LiveClassPage.jsx` opens `timetable_slots.join_link` | KEEP | S | Low | T2 | LIV-01 |

### 8. Parent Portal

| ID | Capability | Current status | Evidence | Action | Effort | Risk | Tier | Depends on |
|---|---|---|---|---|---|---|---|---|
| PAR-01 | Parent login & child linking | MISSING | — | ADD | M | Med | T3 | IAM-05, STU-04 |
| PAR-02 | Child progress view | MISSING | — | ADD | M | Low | T3 | PAR-01 |
| PAR-03 | Fee status & online payment | MISSING | — | ADD | M | Med | T3 | PAR-01, ACC-32 |

### 9. Live Classroom (integrate, don't build)

| ID | Capability | Current status | Evidence | Action | Effort | Risk | Tier | Depends on |
|---|---|---|---|---|---|---|---|---|
| LIV-01 | Scheduled class with meeting link | EXISTS-PARTIAL | `timetable_slots.join_link`, `live_sessions`; AGENTS.md claims embedded Jitsi but code just opens the link (`LiveClassPage.jsx:46`) | KEEP | S | Low | T2 | ACA-04 |
| LIV-02 | Zoom / Google Meet API integration | MISSING | — | ADD | M | Med | T3 | LIV-01 |
| LIV-03 | Attendance from joins | EXISTS-PARTIAL | `attendance` insert on join (`attend_self_insert`) | MODIFY | S | Med | T3 | LIV-01 |
| LIV-04 | Recordings | MISSING | — | ADD | S | Low | T3 | LIV-01 |

### 10. Support & Communication

| ID | Capability | Current status | Evidence | Action | Effort | Risk | Tier | Depends on |
|---|---|---|---|---|---|---|---|---|
| COM-01 | Announcements | EXISTS-PARTIAL | `notify_batch()` RPC (anon-callable — A6 C-1) | MODIFY | S | Med | T2 | CMP-08 |
| COM-02 | In-app notifications | EXISTS-PARTIAL | `notifications` table; any approved user can insert for anyone (`notif_insert`) | MODIFY | S | Med | T2 | CMP-08 |
| COM-03 | Email sending & templates | MISSING | Only Supabase Auth emails | ADD | M | Low | T2 | INT-03 |
| COM-04 | WhatsApp messaging | MISSING | — | ADD | M | Med | T2 | INT-02 |
| COM-05 | SMS | MISSING | — | ADD | M | Low | T3 | INT-05 |
| COM-06 | Message log | MISSING | — | ADD | S | Low | T2 | COM-03 |
| COM-07 | Support ticket portal | MISSING | — | ADD | M | Low | T2 | IAM-04 |
| COM-08 | Tenant → vendor support channel | MISSING | — | ADD | S | Low | T1 | — |

### 11. Reviews & Quality

| ID | Capability | Current status | Evidence | Action | Effort | Risk | Tier | Depends on |
|---|---|---|---|---|---|---|---|---|
| REV-01 | Faculty review | EXISTS-PARTIAL | `faculty_reviews` (0 rows), `ReviewsPage.jsx` | MODIFY | S | Low | T2 | IAM-04 |
| REV-02 | Class / session review | MISSING | — | ADD | S | Low | T3 | ACA-04 |
| REV-03 | Anonymous feedback | MISSING | Reviews store `student_id`; faculty can read own reviews (`rev_read`) | ADD | S | Med | T3 | REV-01 |
| REV-04 | Review analytics | EXISTS-PARTIAL | Aggregates in `ReviewsPage.jsx` | MODIFY | S | Low | T3 | REV-01 |

### 12. Reports & Analytics

| ID | Capability | Current status | Evidence | Action | Effort | Risk | Tier | Depends on |
|---|---|---|---|---|---|---|---|---|
| RPT-01 | Operational dashboard | EXISTS-COMPLETE | `src/pages/Dashboard.jsx` | MODIFY | S | Low | T1 | PLT-02 |
| RPT-02 | Finance dashboard | EXISTS-PARTIAL | Dashboard; Net P&L definition issue (ACC-23) | MODIFY | S | Med | T1 | ACC-23 |
| RPT-03 | Report registry & export | EXISTS-COMPLETE | 7 reports in `src/lib/reports.js` (pnl, fee-collection, expense-analysis, receivables, students, transfers, intercompany) | MODIFY | S | Low | T1 | PLT-04 |
| RPT-04 | Admissions funnel | MISSING | — | ADD | S | Low | T3 | STU-01 |
| RPT-05 | Attendance trends | MISSING | — | ADD | S | Low | T3 | ACA-05 |
| RPT-06 | Exam performance | MISSING | — | ADD | S | Low | T3 | ACA-08 |
| RPT-07 | Custom report builder | MISSING | — | ADD | L | Low | T3 | RPT-03 |
| RPT-08 | Scheduled / emailed reports | MISSING | — | ADD | S | Low | T3 | COM-03 |
| RPT-09 | Server-side totals & pagination | MISSING | All lists fetch whole tables (`src/lib/data.js` fetch*), totals computed in browser (`src/App.jsx:489-565`) | ADD | M | High | T1 | PLT-02 |

### 13. Compliance & Security

| ID | Capability | Current status | Evidence | Action | Effort | Risk | Tier | Depends on |
|---|---|---|---|---|---|---|---|---|
| CMP-01 | DPDP notice & consent | MISSING | No consent fields / notice | ADD | M | Med | T1 | PLT-05 |
| CMP-02 | Data-principal requests | MISSING | — | ADD | M | Med | T2 | CMP-01 |
| CMP-03 | Retention & purge | MISSING | In-DB copy schema `backup_20261003` (5 financial tables, no PK, no RLS, not API-exposed) | ADD | S | Med | T2 | — |
| CMP-04 | Backups & restore drills | EXISTS-PARTIAL | `.github/workflows/nightly-backup.yml` + `scripts/backup-db.sh`; whether secrets are set and dumps succeed is UNKNOWN — needs verification; no restore test recorded | MODIFY | S | High | T0 | — |
| CMP-05 | Encryption | EXISTS-COMPLETE | Supabase-managed (Postgres 17, ap-south-1), HTTPS | KEEP | S | Low | T0 | — |
| CMP-06 | Access logs | MISSING | — | ADD | M | Low | T2 | PLT-10 |
| CMP-07 | Tenant-isolation test suite | MISSING | RLS tests exist but are single-tenant and skip without env (`src/lib/*.rls.test.js`) | ADD | L | High | T0 | PLT-02, PLT-18 |
| CMP-08 | Fix current RLS / RPC gaps | MISSING | See 01 §A6 | ADD | M | High | T0 | — |
| CMP-09 | Rate limiting & abuse protection | EXISTS-PARTIAL | Supabase Auth default limits only | MODIFY | S | Low | T2 | — |
| CMP-10 | Incident & breach response | MISSING | — | ADD | S | Med | T2 | — |
| CMP-11 | Customer terms & DPA | MISSING | — | ADD | S | Med | T1 | — |
| CMP-12 | Data residency (India) | EXISTS-COMPLETE | Supabase region ap-south-1 (`list_projects`) | KEEP | S | Low | T0 | — |

### 14. Integrations (not built in-house)

| ID | Capability | Current status | Evidence | Action | Effort | Risk | Tier | Depends on |
|---|---|---|---|---|---|---|---|---|
| INT-01 | Payment gateway | MISSING | — | ADD | M | Med | T2 | ACC-14 |
| INT-02 | WhatsApp Business API | MISSING | — | ADD | M | Med | T2 | — |
| INT-03 | Transactional email provider | MISSING | — | ADD | S | Low | T2 | — |
| INT-04 | Video conferencing | EXISTS-PARTIAL | Link field only | KEEP | S | Low | T2 | — |
| INT-05 | SMS gateway | MISSING | — | ADD | S | Low | T3 | — |
| INT-06 | Accounting export | MISSING | — | ADD | M | Low | T3 | ACC-05 |

### 15. AI Intelligence Layer

| ID | Capability | Current status | Evidence | Action | Effort | Risk | Tier | Depends on |
|---|---|---|---|---|---|---|---|---|
| AI-01 | Insights | MISSING | — | ADD | M | Med | T4 | RPT-09 |
| AI-02 | Dropout / risk detection | MISSING | — | ADD | L | Med | T4 | ACA-05, ACC-12 |
| AI-03 | Natural-language queries | MISSING | — | ADD | L | High | T4 | PLT-02, CMP-07 |
| AI-04 | Assistant | MISSING | — | ADD | L | Med | T4 | AI-03 |
| AI-05 | Collection forecasting | MISSING | — | ADD | M | Low | T4 | ACC-12 |
## C2. Accounting gap deep-dive

### C2.1 Today vs. target, in plain words

**Today** the app keeps three notebooks: *money in from students* (`collections`), *money out* (`expenses`) and *money moved between pockets* (`transfers`). Each line says which pocket (HDFC, ICICI, Cash, "Healthcare"). Totals are added up in the browser. This is **single-entry bookkeeping** — like a cash book. It works for "how much cash do we have", but it cannot answer "what do we own, what do we owe, and did we really earn a profit", and nothing forces the books to balance.

**Target** is **double-entry bookkeeping**: every money event is written as one *journal entry* with at least two lines, and the lines always balance (total debit = total credit). Simple rule of thumb:

| Word | Means | Example |
|---|---|---|
| **Account** | A named bucket in the *chart of accounts* | "ICICI Bank", "Course Fee Income", "Rent Expense", "Student Receivable", "Due to/from Oksy Healthcare" |
| **Party** | *Who* the money is with | Student "A", vendor "KSEB", related party "Oksy Healthcare" |
| **Debit (Dr)** | Value coming **into** an asset/expense bucket (or a liability going down) | Bank receives ₹5,000 → Dr Bank |
| **Credit (Cr)** | Value going **out of** an asset, or income/liability going up | Fee earned → Cr Fee Income |
| **Journal entry** | One event = Dr lines + Cr lines with equal totals | "Student paid ₹5,000 by UPI" |
| **Ledger** | All lines of one account, in date order, with running balance | ICICI ledger = bank book |

Because every entry balances, the system can always produce a **trial balance**, **P&L** and **balance sheet** that agree with each other — and an inter-company balance becomes just the running balance of one account for one party.

| Area | Current model | Target model | Gap |
|---|---|---|---|
| Accounts | 4 fixed strings in CHECKs | `accounts` table per tenant (type: asset, liability, equity, income, expense; sub-type: bank, cash, receivable, related_party …) seeded from a template | ADD |
| Parties | Students only; vendors in free text; "Healthcare" disguised as an account | `parties` (student, guardian, vendor, faculty, related_party, other) | ADD |
| Entries | One row per event, one account | `journal_entries` (header: date, type, source doc, narration, status) + `journal_lines` (account, party, debit, credit) with DB-enforced balance | ADD |
| Fee charges | Columns on `students` | `fee_charges` (student, fee head, amount, due date) → posted Dr Receivable / Cr Fee Income | ADD |
| Receipts | Collection row = receipt; number = row id | Receipt document with per-tenant/FY series, immutable, cancel-with-reason; posts Dr Bank / Cr Receivable | REFACTOR |
| Related party | Running sum of "Healthcare" rows | Account "Inter-company — <party>" (sub-type `related_party`) + party; balance sign tells receivable/payable | REFACTOR |
| Corrections | Edit/delete in place | Reverse-and-repost (or edit only while period open) + audit | ADD |
| Periods | None | `accounting_periods` with lock | ADD (T2) |
| Reports | Browser sums | SQL views/RPCs over `journal_lines` | ADD |

### C2.2 Minimal professional design (to be built in stages)

```
accounts            (id, tenant_id, code, name, type, sub_type, parent_id, is_system, is_active)
parties             (id, tenant_id, kind, name, student_id NULL, contact…, is_related_party)
money_accounts      = accounts where sub_type in ('bank','cash','wallet')  (+ bank details, statement parser profile)
fee_heads           (id, tenant_id, name, income_account_id, gst_rate NULL)
fee_charges         (id, tenant_id, student_id, fee_head_id, amount, due_date, source)    -- what the student owes
receipts            (id, tenant_id, series, number, date, student_id, money_account_id, amount, status, cancelled_reason)
journal_entries     (id, tenant_id, entry_date, entry_type, source_table, source_id, narration, status, posted_by, posted_at, reversal_of)
journal_lines       (id, tenant_id, entry_id, account_id, party_id NULL, debit, credit, CHECK (debit>=0 AND credit>=0 AND (debit=0) <> (credit=0)))
-- DB rule: for each entry_id, sum(debit) = sum(credit)  (deferred constraint trigger)
accounting_periods  (tenant_id, period_start, period_end, status open|locked)   -- T2
```

**Starter chart of accounts (template, editable per tenant):**
Assets — Cash in hand; Bank accounts (one per bank); Student fees receivable; Inter-company receivable (per related party); Advances & deposits.
Liabilities — Inter-company payable (per related party, may share one "Inter-company — X" account with the receivable); Fees received in advance; GST payable; Other payables.
Equity — Partners' capital; Retained earnings / opening balance equity.
Income — Registration fee; Course fee; Exam fee; Other fee; Other income.
Contra-income — Discounts & scholarships; Fee write-offs (dropped students).
Expenses — the tenant's expense categories (Oksy's 36 become 36 expense accounts or sub-accounts).

**Related-party handling (generic, never "Healthcare"):** a related party is a `parties` row with `is_related_party = true` (e.g. "Oksy Healthcare LLP" for Tenant #001; a parent company or sister trust for others). It gets one balance account "Inter-company — <name>". Positive balance = they owe us; negative = we owe them. The dashboard tile becomes "Related-party balance" listing every related party.

### C2.3 How each existing transaction maps (one balanced entry each)

| Existing record | Journal entry (Dr = left side, Cr = right side) |
|---|---|
| Student enrolled with fees (columns on `students`) | Dr Student receivable (party = student) / Cr Registration / Course / Exam / Other fee income — one line per non-zero fee head |
| Waiver on student | Dr Discounts & scholarships / Cr Student receivable |
| Student set to Dropped (auto-waiver) | Dr Fee write-off / Cr Student receivable (for the unpaid balance) |
| Collection, account HDFC / ICICI / Cash | Dr that bank/cash account / Cr Student receivable (party = student) |
| Collection, account **Healthcare** | Dr Inter-company — Oksy Healthcare / Cr Student receivable *(Healthcare holds our money → they owe us)* |
| Expense, account HDFC / ICICI / Cash | Dr Expense category account / Cr bank/cash account |
| Expense, account **Healthcare** | Dr Expense category account / Cr Inter-company — Oksy Healthcare *(we owe them)* |
| Transfer bank/cash → bank/cash | Dr destination account / Cr source account |
| Transfer → Healthcare (repayment) | Dr Inter-company — Oksy Healthcare / Cr source bank/cash |
| Transfer Healthcare → bank (they fund us) | Dr destination bank / Cr Inter-company — Oksy Healthcare |
| Future: refund | Dr Student receivable (or Fee refunds) / Cr bank |
| Future: other income | Dr bank / Cr Other income |
| Opening balances (new tenant or pre-history) | Dr/Cr each balance / balancing line to Opening balance equity |

With this, the current "Net P&L − Due to Healthcare" double count disappears: Healthcare-paid expenses appear **once** in P&L, and what is owed to Healthcare appears **once** on the balance sheet. (If the owner still wants a conservative "profit after settling related-party dues" KPI, it can be shown as a separate, clearly labelled management figure — decision D-8.)

### C2.4 Conversion strategy for existing Oksy data

1. **Freeze & snapshot** — backup + export; record trial figures from the current app (revenue, expense, each account balance, Healthcare balance, total receivable) as the *reconciliation target*.
2. **Normalise** — map the 6 collection `type` spellings to 4 fee heads; map 36 expense categories to expense accounts; create party rows for the 136 students and one related party (Oksy Healthcare).
3. **Opening position** — decide cut-over date (recommended: 1 April 2025, start of FY 2025-26, which precedes the first collection 2025-04-30). Opening balances: bank/cash from the first bank statement opening balance or owner-confirmed figures; receivables = 0 at that date unless known.
4. **Generate journals** from source rows with a deterministic posting function (`post_collection(id)`, `post_expense(id)`, …), each journal pointing back to `source_table/source_id`. Fee charges are generated from student fee columns dated at `enrollment_date` (or batch start if null).
5. **Reconcile** — the new trial balance must reproduce step-1 figures exactly (bank/cash balances, receivable per student, related-party balance). Differences are listed, explained, and fixed in source data — never forced.
6. **Run in parallel** — keep old screens as source-document entry ("sub-ledgers"); posting runs automatically on every insert/update (RPC or trigger). Old reports and new reports shown side by side for one month.
7. **Switch** reports to the ledger; add period locking; keep source tables forever (they are the vouchers) and `bank_match_links` unchanged.

**Recommendation on timing:** design the schema now, but build the posting engine and statements in **T2 (after the first sale)**. For January, do only the parts that the multi-tenant product cannot ship without: tenant-configurable money accounts (ACC-02), generic related parties (ACC-04), fee heads (ACC-11), per-tenant receipt series and no hard delete of receipts (ACC-14), opening balances (ACC-33), corrected P&L definition (ACC-23), insert audit (ACC-30). These are chosen so the later ledger can be generated from them without another data migration.

---

## C3. Multi-tenancy gap

### C3.1 New core tables

| Table | Purpose | Notes |
|---|---|---|
| `tenants` | id (uuid), code (`T001`), slug, legal_name, display_name, status (active / suspended / closed), plan, timezone, created_at | Oksy Academy = T001 |
| `tenant_settings` | 1 row per tenant: branding (logo path, colours), contact, GSTIN/PAN/registration, receipt prefix & FY series, student-ID format, module flags, role labels | Replaces `app_settings` |
| `tenant_memberships` | (tenant_id, user_id) unique, role, status (invited / active / disabled), invited_by, created_at; optional `student_id` / `party_id` link | Replaces `profiles.role`, `is_approved`, `can_view_financials`, `batch_name`, `student_ref` |
| `role_permissions` | role → capability list (seeded, platform-managed in MVP) | Lets permissions evolve without schema changes |
| `platform_admins` | user_id, granted_at | Separate from tenant roles |
| `support_sessions` | platform admin, tenant, reason, started/expires | Every support access is time-boxed and logged |
| `platform_audit_log` | who, tenant, action, target, at | Append-only |
| `profiles` (kept) | global person: name, email, must_change_password | Role columns migrate out |

### C3.2 Table-by-table changes

Legend — **Pattern A**: `tenant_id uuid not null references tenants`, index `(tenant_id, …)`, RLS `tenant_id in (select private.my_tenant_ids(<roles>))`. **Composite FK** = parent referenced by `(tenant_id, id)` so a row can never point to another tenant's parent.

| Table | tenant_id | Unique / key changes | RLS (target) | Cross-tenant tests (in addition to the standard 5 below) |
|---|---|---|---|---|
| students | Yes | PK → `(tenant_id, id)` or surrogate `uuid` + unique `(tenant_id, student_code)`; ID sequence per tenant | Read: staff roles of tenant; student own row. Write: staff (personal), admin/finance (fee fields) | Student of A cannot read B's student with the same code |
| collections → receipts | Yes | Receipt number unique `(tenant_id, series, number)`; composite FK to student | Read: finance roles; student own receipts. Insert: staff/finance. Cancel: admin | Insert in A referencing B's student fails |
| expenses | Yes | Composite FK to category/account | Read/write: finance roles | — |
| transfers | Yes | Composite FKs to accounts | Finance roles | From-account of B rejected |
| bank_statements / lines / match_links / sync_history | Yes (all four, not just parent) | Composite FKs; match link uniqueness `(tenant_id, book_kind, book_id, account)` | Finance roles | Link A line to B book fails |
| batches | Yes | `unique (tenant_id, name)`; FKs by name become `(tenant_id, name)` or switch to id | Read: tenant members; write: admin | Two tenants can both have batch "2025-A" |
| courses | Yes | `unique (tenant_id, code)`, `(tenant_id, name)` | Same | Same code allowed in A and B |
| expense_categories → accounts | Yes | `unique (tenant_id, name)` | Finance roles write | — |
| money accounts (new, replaces CHECKs) | Yes | `unique (tenant_id, name)` | Finance | — |
| app_settings → tenant_settings | Yes (PK) | one per tenant | Read: members; write: owner | A owner cannot change B settings |
| profiles | No (global) | — | Self; co-members' names visible only via membership-scoped view | A admin cannot list B users |
| tenant_memberships | Yes | `unique (tenant_id, user_id)` | Read: owner/admin of tenant + self; write: owner/admin via RPC only | A admin cannot add self to B; role escalation blocked |
| audit_log | Yes | index `(tenant_id, table_name, row_id)`; make append-only | Read: owner/finance of tenant | A cannot read B audit rows |
| notifications | Yes | — | Read: recipient; insert: staff via RPC | Cannot notify user of B |
| timetable_slots, live_sessions, attendance | Yes | Composite FKs | Members per current rules, tenant-scoped | Student of A cannot join B session |
| assignments, assignment_submissions | Yes | Composite FKs | As today + tenant scope; grading columns protected | — |
| exams, exam_questions, exam_attempts, exam_answers | Yes | Composite FKs | As today + tenant scope | `exam_questions_public` view returns 0 B rows |
| faculty_batches, faculty_reviews | Yes | Composite FKs | As today + tenant scope | — |
| views `collections_basic`, `exam_questions_public` | n/a | Rebuild as `security_invoker = true` views on tenant-scoped tables (or RPCs) | Inherit table RLS | Views return 0 rows of B |
| storage.objects | Path prefix | `tenants/<tenant_id>/<bucket-purpose>/…` | Policy checks `(storage.foldername(name))[2]::uuid in my tenants` + role | A cannot read/write B path |
| backup_20261003.* | — | Not migrated | — | — |

**Standard 5 tests for every tenant-owned table** (run for each role: owner, admin, finance, staff, faculty, student): (1) A-user SELECT returns 0 rows of B; (2) INSERT with `tenant_id = B` fails; (3) UPDATE of a B row affects 0 rows; (4) DELETE of a B row affects 0 rows; (5) INSERT in A that references a B parent fails (composite FK). Plus: every RPC called with B ids fails; suspended tenant → writes fail.
**Catalog guard test:** a CI test lists every table in `public`; it fails if a table has no RLS, or has no `tenant_id` and is not on the explicit global allow-list (`tenants`, `profiles`, `platform_admins`, `role_permissions`). This stops a future table from being added without isolation.

### C3.3 Proposed RLS pattern

```sql
-- Design sketch only (not executed). Helpers live in a schema NOT exposed to the API.
create schema if not exists private;

create function private.my_tenant_ids(p_roles text[] default null)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select m.tenant_id
  from public.tenant_memberships m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = (select auth.uid())
    and m.status = 'active' and t.status = 'active'
    and (p_roles is null or m.role = any (p_roles))
  union
  select s.tenant_id from public.support_sessions s          -- audited, time-boxed platform support
  where s.admin_id = (select auth.uid()) and now() < s.expires_at;
$$;
revoke all on function private.my_tenant_ids(text[]) from public, anon;
grant execute on function private.my_tenant_ids(text[]) to authenticated;

create policy expenses_select on public.expenses for select to authenticated
  using (tenant_id in (select private.my_tenant_ids(array['owner','admin','finance'])));
create policy expenses_insert on public.expenses for insert to authenticated
  with check (tenant_id in (select private.my_tenant_ids(array['owner','admin','finance','staff'])));
```

Rules that go with it: policies `TO authenticated` only (never `public`); revoke `anon` table grants on tenant tables; `tenant_id` immutable (trigger); every SECURITY DEFINER RPC takes `p_tenant_id` and re-checks membership/role inside; `(select …)` wrapping so helpers run once per query (fixes the current `auth_rls_initplan` warnings); indexes lead with `tenant_id`.

**Active tenant:** the app keeps the selected tenant in memory (tenant switcher) and always sends `tenant_id` on writes and filters on reads. RLS guarantees a user can only reach tenants they belong to, so a tampered `tenant_id` gets nothing. A JWT custom claim is **not** needed for the MVP (avoids stale claims after role changes); it can be added later for performance.

### C3.4 Membership & role design

- Roles per membership: `owner`, `admin`, `finance`, `staff`, `faculty`, `student`, `parent` (later). Platform admin is **not** a tenant role.
- Mapping from today: `super_admin` → owner; `admin` → admin (+ finance if `can_view_financials`); `staff` with flag → finance, without → staff; `faculty` → faculty; `student`/`professional` → student (keep "professional" as a label if needed). `profiles.batch_name`/`student_ref` move to the membership or to a `student_id` link.
- Permissions are checked in SQL via role arrays now, and via `role_permissions` capability lookup later (same helper signature), so roles can evolve.

### C3.5 Storage, edge functions, cron

| Item | Change |
|---|---|
| Bucket `submissions` | Prefix paths with tenant id; set size/MIME limits; policies by tenant + role; move 3 existing objects |
| New buckets | `branding` (public read, owner write — logos), `student-documents` (private, T2) |
| `create-user` | Replace with `invite-member(tenant_id, email, role)`: caller must be owner/admin **of that tenant**; uses invite e-mail; creates membership; no temp passwords |
| `smart-endpoint` | Delete (H-1) |
| New functions | `create-tenant` (platform admin; creates tenant, settings, starter accounts/categories, owner invite), `export-tenant`, `delete-tenant` (two-step, audited) |
| `pg_cron` job | Loop over active tenants, run automation per tenant in its timezone |

---

## C4. Architecture options

| | (1) Shared schema + `tenant_id` + RLS | (2) Schema per tenant | (3) Database (project) per tenant |
|---|---|---|---|
| How | One set of tables; every row tagged; Postgres RLS filters | Same tables copied into `t001`, `t002` … schemas | Separate Supabase project per institute |
| Isolation strength | Good **if** RLS is complete and tested (catalog guard + cross-tenant tests); one bug can leak | Strong logical isolation; RLS still needed for roles; Supabase API exposes schemas explicitly (config per schema) | Strongest (physical) |
| Cost (25–100 tenants) | One project: roughly the current paid plan + compute upgrade as data grows | One project; same cost as (1) | roughly USD 10+/month extra compute per project on the Pro plan (approx. — verify current Supabase pricing) → cost grows linearly with tenants |
| Migrations | Run once | Run N times; drift risk | Run N times across N projects; CI fan-out |
| Cross-tenant platform reports | Easy SQL | UNION across schemas | Very hard |
| Onboarding a tenant | Insert rows | Create schema + objects | Create project, keys, deploy functions, DNS |
| Backup / restore one tenant | Per-tenant export script needed | `pg_dump -n` per schema — easy | Native per project — easy |
| Fit with Supabase Auth/Storage | Native: one auth, one storage | Auth shared; PostgREST schema exposure awkward at scale | Separate auth per tenant (users with 2 institutes = 2 accounts) |
| Complexity for a solo founder | **Lowest** | Medium-high | High |
| Existing code reuse | Highest (add column + policies) | Medium (dynamic schema per request) | Medium (per-tenant config/URL) |

**Recommendation: Option 1 — shared schema + `tenant_id` + RLS**, with the safety net that makes it trustworthy: private helper functions, composite foreign keys, `tenant_id` immutability, catalog guard test, cross-tenant test suite in CI, audited support access, and per-tenant export/delete scripts. Re-evaluate only if a large customer contractually demands physical isolation — that customer can then get a dedicated project (Option 3) running the same code.

---

## C5. Risk register

| # | Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R1 | Incomplete RLS leaks Tenant B data to Tenant A | Security | Medium | **Very high** (trust, DPDP) | Pattern A everywhere, catalog guard, 5 standard tests × roles in CI, external review before first outside tenant |
| R2 | Current HIGH findings (C-1, H-1, H-2, H-3) exploited before fixed | Security | Medium | High | Phase 1 hotfix first, within days of approval |
| R3 | Oksy backfill breaks production (lock-out, wrong totals) | Data migration | Medium | High | Expand → backfill → contract migrations; staging rehearsal on a prod copy; reconciliation targets; tested rollback; maintenance window |
| R4 | Repo schema ≠ production schema | Technical | **High** (already true) | High | Baseline from production dump into Supabase CLI migrations before any change |
| R5 | Totals silently wrong once tables pass ~1,000 rows or a fetch fails | Data integrity | Medium (time-bomb) | High | Server-side aggregates + pagination in Phase 2; show errors instead of zeros |
| R6 | Scope creep (exams, attendance, WhatsApp, full ledger) delays January | Scope | **High** | High | Strict T0/T1 scope, feature flags hide unused modules, owner sign-off for any scope change |
| R7 | Solo-founder capacity / illness; AI-generated code quality | Timeline | High | High | Small phases, CI gates, reviewable PRs, buffer weeks, written runbooks |
| R8 | Double-entry conversion produces numbers the owner doesn't recognise | Accounting | Medium | Medium | Reconciliation targets, parallel run, plain-language explanations; schedule after first sale |
| R9 | Backups not actually running / restore untested | Operations | Medium | Very high | Verify workflow, monthly restore drill, Supabase PITR evaluation |
| R10 | DPDP non-compliance (no notice/consent, students see others' data, no deletion) | Legal | Medium | High | H-3 fix, privacy notice + consent capture, export/delete flows, DPA with institutes |
| R11 | Supabase plan limits (free tier pauses, 500 MB) for paying customers | Operations | Medium | High | Move to paid plan before first outside tenant; monitor size |
| R12 | Breaking Oksy's daily operations during transformation (parallel project editing same repo) | Process | Medium | Medium | Freeze big features in the old project (vision §7); feature branches; staging sign-off |
| R13 | Hard-coded assumptions missed (Oksy text, IST, accounts) appear to second tenant | Product | Medium | Medium | A7 checklist as acceptance test; pilot with a real second institute |
| R14 | Stray deploy paths (manual edge functions, hand-run SQL) reintroduce fixed bugs | Process | High | Medium | Everything via repo + CI; periodic drift check (functions list, migrations list) |

---

## C6. Recommended phase plan

Assumptions: one founder working with an AI pair-programmer, ~25–30 focused hours/week; estimates include tests and staging rehearsal. Today is **6 Oct 2026**; 1 Jan 2027 is ~12.5 weeks away, 31 Jan ~17 weeks.

| Phase | One purpose | Effort | Earliest window |
|---|---|---|---|
| 1 | Security hot-fixes on today's production | 1 wk | 12–18 Oct |
| 2 | Engineering foundation (migration baseline, CI, staging parity, server totals) | 1.5 wk | 19–29 Oct |
| 3 | Tenant foundation: schema, memberships, RLS, isolation tests (staging only) | 3 wk | 30 Oct–19 Nov |
| 4 | Oksy backfill to Tenant #001 + production cut-over | 1 wk | 20–26 Nov |
| 5 | Tenant-aware app layer + generic accounts/related parties/receipts | 2.5 wk | 27 Nov–15 Dec |
| 6 | Branding & tenant settings | 1 wk | 16–22 Dec |
| 7 | Platform admin console + onboarding wizard + invitations | 2 wk | 23 Dec–5 Jan |
| 8 | Pilot readiness: DPDP basics, export/delete, terms, support channel, second-institute pilot | 1.5 wk | 6–16 Jan |
| — | Buffer (holidays, bugs, review) | 1.5–2 wk | to end Jan |
| T2-A | Double-entry ledger, trial balance, balance sheet, period lock (after first sale) | 4–6 wk | Feb–Mar 2027 |

**Total to sale-ready: ~13.5 weeks of work + ~2 weeks buffer ⇒ realistic "first outside institute live" = late January 2027.** A signed deal in January is achievable; going live in the first half of January is **at risk**.

**What to cut to protect January (recommended):** full double-entry ledger & statements → T2; Academy Suite modules (exams, reviews, assignments, live class, timetable) hidden by feature flag for new tenants; subdomains → single app domain with tenant switcher; Google sign-in for new tenants → later; SaaS billing → manual invoicing outside the app; installments, refunds, GST invoices → T2 (unless the pilot institute needs one of them — decision D-4).

### Phase details

**Phase 1 — Security hot-fixes (production)**
- Goal: close exposures that exist today, independent of SaaS.
- Tasks: revoke/guard `notify_batch`; delete `smart-endpoint`; restrict `expenses` SELECT and `collections_basic` to finance/staff (+ student own rows); block grading/score columns on INSERT; restrict notification inserts; student fee-field edits admin-only; storage size/MIME limits; revoke `anon` EXECUTE on definer helpers, fix `search_path`; enable leaked-password protection; make repo private (if not intended public); verify nightly backup and do one restore drill.
- Touches: RLS policies, grants, 1 view, 1 edge function, bucket config. No table structure, no data.
- Tests: existing 326 tests; new RLS tests per changed policy (student cannot read expenses/others' receipts; anon cannot call notify_batch; student cannot insert graded submission); manual smoke of every tab per role on staging.
- Rollback: each policy change in its own migration with a written down-migration (previous policy text is captured in §A3.2 / `pg_policies` dump).
- Exit: advisors show no anon-executable definer function except intended; all new tests green on staging and prod; owner smoke-test passed.

**Phase 2 — Engineering foundation**
- Goal: make change safe.
- Tasks: dump production schema → baseline Supabase CLI migration; reconcile repo vs prod (incl. migration 37); staging rebuilt from baseline; GitHub Action for lint+test+build on PRs; branch protection on `main`; local Supabase for RLS tests; Sentry (or similar); dashboard totals and lists via server-side RPC/views + pagination, errors surfaced.
- Touches: repo tooling, new read-only RPCs/views; front-end data loading.
- Tests: CI green; totals from new RPC equal current browser totals on prod copy (reconciliation test).
- Rollback: tooling is additive; RPC-based totals behind a switch.
- Exit: one command recreates the schema; CI blocks failing PRs; totals verified.

**Phase 3 — Tenant foundation (staging only)**
- Goal: isolation in the database.
- Tasks: `tenants`, `tenant_settings`, `tenant_memberships`, `platform_admins`, `support_sessions`, `platform_audit_log`; `private` helpers; add nullable `tenant_id` to all 24 tenant-owned tables; composite uniques & FKs; rewrite all RLS to Pattern A; tenant-aware RPCs; catalog guard + cross-tenant test suite (6 roles × 24 tables × 5 tests + RPC + storage).
- Touches: every table and policy (on staging).
- Tests: full isolation suite with seeded Tenant A/B; all existing tests; owner walkthrough on staging with Oksy copy.
- Rollback: staging only; migrations reversible (expand phase adds columns/tables only).
- Exit: isolation suite 100 % green; zero advisor errors; external/AI-assisted security review of policies signed off.

**Phase 4 — Oksy backfill & cut-over**
- Goal: Oksy becomes Tenant #001 with no loss.
- Tasks: backup → rehearse on fresh prod copy in staging → maintenance window → create T001 → back-fill `tenant_id` → memberships from `profiles` → set NOT NULL → switch policies → move storage objects → verify reconciliation targets (row counts per table, balances per account, receivable per student, Healthcare balance, user logins).
- Touches: production data and schema.
- Tests: reconciliation script (before/after identical); each of 14 users can log in with the right access; isolation tests against prod with a temporary test tenant, then removed.
- Rollback: restore from the pre-window backup (rehearsed); or contract step delayed — old columns kept until 2 weeks of stable running.
- Exit: Oksy works exactly as before; owner sign-off.

**Phase 5 — Tenant-aware app layer**
- Goal: front-end and functions work for any tenant.
- Tasks: membership loading + tenant switcher; all queries tenant-scoped; split `App.jsx` data layer into per-domain hooks; money accounts & related parties from DB (remove hard-coded lists and "Healthcare"); fee heads; per-tenant receipt series, cancel instead of delete; P&L definition fix; insert audit; invitations replace temp passwords; tenant-prefixed storage; cron per tenant.
- Touches: most of `src/`, edge functions, some RPCs.
- Tests: unit tests for new money/fee logic; E2E smoke (login → enrol → collect → expense → reconcile → report) for two tenants; isolation suite stays green.
- Rollback: feature branch; deploy behind preview URL; Vercel instant rollback.
- Exit: a second test tenant can run the full flow with zero Oksy-specific code paths (A7 checklist all ticked).

**Phase 6 — Branding & settings**: settings screen (name, logo, colours, contact, GSTIN/PAN, receipt prefix, ID format, modules); receipt/report headers from settings; neutral product shell. Tests: visual check for two tenants; Exit: no "Oksy" string outside Tenant #001 data. Rollback: Vercel rollback.

**Phase 7 — Platform admin & onboarding**: platform console (list/create/suspend tenants, support session with reason + audit), onboarding wizard (tenant → owner invite → starter accounts/categories/course/batch → opening balances), member management (invite, change role, disable). Tests: create tenant end-to-end on staging; suspended tenant cannot write; every support access logged. Rollback: additive. Exit: new institute self-configures in < 30 minutes without SQL.

**Phase 8 — Pilot readiness**: privacy notice + consent capture (guardian for minors), data-subject request process (manual with log), per-tenant export and deletion scripts, terms & DPA, support channel, paid Supabase plan, monitoring; onboard pilot institute. Exit: pilot institute uses fees/expenses/reports for 2 weeks with no isolation or data issues.

---

## C7. Decisions needed from the owner

| # | Question | Recommended default | Trade-off |
|---|---|---|---|
| D-1 | Approve Phase 1 security hot-fixes on production now, before SaaS work? | **Yes**, this week | Small risk of breaking a screen vs. live data exposure today |
| D-2 | Product name/domain (Acadex / Campuzo / other) and when? | Keep "PULSE 2.0" internally; decide by end of Phase 5 so branding work isn't redone | Late decision may delay marketing site |
| D-3 | January goal: "signed deal" or "institute live and using it"? | Signed deal + live pilot by end of January | Live by early January would force cutting tenant safety work — not recommended |
| D-4 | What does the first outside institute need on day 1 beyond today's features? (installments? refunds? GST invoice? WhatsApp receipts?) | Only today's features + branding; add **one** extra only if it is a deal-breaker | Each extra adds 1–2 weeks |
| D-5 | Hide Academy Suite (timetable, live class, assignments, exams, reviews) for new tenants at launch? | **Yes**, hide; keep for Oksy | Smaller demo vs. lower risk |
| D-6 | Accounting basis for fee income: accrual (fee earned when charged) or cash (when received)? | Accrual for receivables + a cash report alongside | Accrual is "proper" but numbers differ from today's cash-based P&L |
| D-7 | Double-entry ledger timing: before or after first sale? | **After** (T2), with T1 data model prepared | Earlier = stronger pitch but January slips ~4–6 weeks |
| D-8 | Keep the "Net P&L minus Due to Healthcare" figure? | Replace with standard P&L + separate related-party balance; optional labelled KPI "profit after related-party dues" | Standard numbers will look different from what you are used to |
| D-9 | Cut-over date for opening balances | 1 April 2025 (FY 2025-26 start) | Earlier history would need extra data |
| D-10 | Can one person (e.g. a faculty member) belong to several institutes? | Yes (membership model supports it) | Slightly more UI (tenant switcher) |
| D-11 | Login methods for new tenants | Email + password via invitation; Google later | Google is convenient but harder to control |
| D-12 | Subdomain per institute at launch? | No — one app URL + tenant switcher; subdomains in T2 | Less "white-label" feel initially |
| D-13 | Pricing model assumption (per student / per month flat / tiered) | Flat monthly tiers by active students; manual invoicing for first customers | Affects quotas (PLT-16) later, not MVP code |
| D-14 | Payment-gateway model later: each institute's own merchant account, or platform collects and settles? | Each institute's own account (no money handling by PULSE) | Platform-collect needs RBI/PA compliance |
| D-15 | Who may see an institute's data from the PULSE side (support)? | Only via time-boxed, logged support sessions with a reason | Slower support vs. trust/DPDP |
| D-16 | Data retention after an institute leaves | Export delivered, data deleted after 30 days, backups expire in 90 days | Shorter = less liability, less recovery option |
| D-17 | Make the GitHub repo private? | Yes (unless intentionally open-source) | None for a commercial product |
| D-18 | Executive (staff) rights on student fees & waivers | View/enter only; changes to fees/waivers need Admin | Staff may need to call Admin more often |
| D-19 | Delete the in-database copy `backup_20261003` after exporting it off-platform? | Yes, after confirming the nightly backup works | Keeps one fewer copy of financial data |
