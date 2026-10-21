# 02 — Target Capability Catalogue (PULSE 2.0)

> Phase 0 deliverable · read-only audit · prepared 2026-10-06 · repo `oksy-academy-pulse` @ `06bf4ce` (main)

This is the list of everything a complete, professional institute-management SaaS should be able to do. It is a **menu, not a build order**. Each item has a priority tier. Only T0 and T1 are needed for the January 2027 first sale. The current status of each item is in `03_GAP_ANALYSIS.md` §C1 (same IDs).

## Priority tiers

| Tier | Meaning | Count |
|---|---|---|
| **T0** | Platform foundation — must exist before anything else | 10 |
| **T1** | MVP for January 2027 first sale | 52 |
| **T2** | Soon after first sale | 65 |
| **T3** | Later | 32 |
| **T4** | AI layer (last) | 5 |
| | **Total capabilities** | **164** |

Primary role = the person who mainly uses the capability. "Platform" = PULSE team / system level.

## 1. Platform & Tenancy

| ID | Capability | Short description | Primary user role | Tier |
|---|---|---|---|---|
| PLT-01 | Tenant registry | `tenants` table: name, slug, status, plan, created_at; Oksy Academy = Tenant #001 | Platform Super Admin | T0 |
| PLT-02 | Tenant data isolation | `tenant_id` on every tenant-owned table + RLS policies keyed on membership | Platform | T0 |
| PLT-03 | Tenant settings store | One config point per tenant (locale, FY start, receipt prefix, modules, defaults) | Institute Owner | T1 |
| PLT-04 | Branding | Institute name, logo, colours, favicon, product name in UI | Institute Owner | T1 |
| PLT-05 | Legal & contact details | Legal name, address, phone, email, GSTIN/PAN/registration no. used on receipts & reports | Institute Owner | T1 |
| PLT-06 | Tenant subdomain | `<slug>.<product-domain>` routing to the tenant | Platform | T2 |
| PLT-07 | Custom domain | Tenant's own domain with TLS | Institute Owner | T3 |
| PLT-08 | Tenant suspension | Suspend / read-only / reactivate a tenant; enforced in RLS | Platform Super Admin | T1 |
| PLT-09 | Platform admin console | List, create, suspend tenants; see usage; enter tenant in audited support mode | Platform Super Admin | T1 |
| PLT-10 | Platform audit log | Immutable log of platform-admin actions and support access into tenants | Platform Super Admin | T1 |
| PLT-11 | Feature flags per tenant | Turn modules on/off per tenant / plan | Platform Super Admin | T1 |
| PLT-12 | Onboarding wizard | Create institute, owner account, starter config (accounts, categories, first course/batch) | Platform Super Admin / Owner | T1 |
| PLT-13 | Per-tenant data export | Full export (CSV/Excel/JSON zip) of a tenant's data for offboarding | Institute Owner | T1 |
| PLT-14 | Per-tenant data deletion | Verified deletion of all tenant rows + storage objects | Platform Super Admin | T1 |
| PLT-15 | Subscription & billing | Plans, invoices, payment collection for the SaaS itself | Platform Super Admin | T2 |
| PLT-16 | Plan limits / quotas | Students, users, storage limits per plan | Platform | T3 |
| PLT-17 | Tenant-aware scheduled jobs | Cron jobs iterate per tenant with tenant context | Platform | T1 |
| PLT-18 | Environments & migration pipeline | Staging parity, versioned CLI migrations, CI (lint/test/build) on every PR | Engineering | T0 |
| PLT-19 | Neutral product copy | Remove 'Oksy' from UI copy, storage keys, receipt prefixes | Engineering | T1 |
| PLT-20 | Error monitoring & observability | Front-end error reporting, uptime check, DB/edge logs review | Engineering | T1 |

## 2. Identity & Access

| ID | Capability | Short description | Primary user role | Tier |
|---|---|---|---|---|
| IAM-01 | Email + password login | Sign-in, session persistence, sign-out | All | T0 |
| IAM-02 | Google sign-in | OAuth sign-in for invited users | All | T2 |
| IAM-03 | Password reset | Request link → set new password screen | All | T1 |
| IAM-04 | Tenant memberships | user ↔ tenant ↔ role; one person may belong to several tenants | Platform | T0 |
| IAM-05 | Role model | Platform Super Admin, Owner, Admin, Finance Staff, Faculty, Student, Parent, Other staff | Owner | T1 |
| IAM-06 | Permission model | Capability-based permissions (e.g. `fees.collect`, `fees.edit`) mapped to roles, checked in DB | Owner | T1 |
| IAM-07 | Invitations | Invite by email → accept → set own password; no temp passwords | Owner / Admin | T1 |
| IAM-08 | Invite-only access | Disable open self-signup; only invited users get a membership | Platform | T1 |
| IAM-09 | Session management | Sensible JWT expiry, sign-out everywhere, revoke on deactivation | All | T2 |
| IAM-10 | Multi-factor authentication | TOTP MFA, enforceable for owners/finance | Owner / Finance | T3 |
| IAM-11 | Login & activity audit | Who logged in when; key actions per user | Owner | T2 |
| IAM-12 | Tenant switcher | Pick active institute when a user has several memberships | All | T1 |
| IAM-13 | Password policy | Minimum strength + leaked-password protection | Platform | T1 |
| IAM-14 | User lifecycle management | Deactivate, change role, re-invite, remove membership | Owner / Admin | T1 |

## 3. Accounting & Finance

| ID | Capability | Short description | Primary user role | Tier |
|---|---|---|---|---|
| ACC-01 | Chart of accounts | Per-tenant accounts (Asset, Liability, Income, Expense, Equity) from a starter template | Owner / Finance | T2 |
| ACC-02 | Money accounts | Tenant-configurable bank / cash / wallet accounts (replaces hard-coded HDFC/ICICI/Cash) | Owner / Finance | T1 |
| ACC-03 | Parties register | Students, vendors, faculty, related parties as one party master | Finance | T2 |
| ACC-04 | Related-party (inter-company) tracking | Generic related-party entity with running receivable/payable; never hard-coded | Owner / Finance | T1 |
| ACC-05 | Double-entry journal & ledger | Journal entries with balanced debit/credit lines generated from source documents | Finance | T2 |
| ACC-06 | Other income | Non-fee income (rent, commission, interest) | Finance | T2 |
| ACC-07 | Expenses with categories | Record, edit (controlled), categorise, attach bill | Finance Staff | T1 |
| ACC-08 | Bank & cash balances | Running balance per money account incl. opening balance | Owner / Finance | T1 |
| ACC-09 | Bank statement import & reconciliation | Upload statement, auto/manual match, sync references, undo | Finance | T1 |
| ACC-10 | Transfers between accounts | Bank↔bank, cash deposits, related-party repayments | Finance | T1 |
| ACC-11 | Fee structures | Fee heads per course/batch (registration, course, exam, other, custom) | Owner / Admin | T1 |
| ACC-12 | Installment plans | Schedule of dues with due dates per student | Finance | T2 |
| ACC-13 | Discounts / scholarships / waivers | Typed, dated, approved concessions | Admin | T1 |
| ACC-14 | Receipts | Per-tenant, per-FY sequential numbering; immutable once issued; reprint; cancel with reason | Finance Staff | T1 |
| ACC-15 | Invoices / fee demand notes | Demand notes; GST invoice where applicable | Finance | T2 |
| ACC-16 | Refunds & credit notes | Refund a fee with approval, linked to receipt | Admin / Finance | T2 |
| ACC-17 | Dues & outstanding | Outstanding per student / batch | Finance Staff | T1 |
| ACC-18 | Due reminders | Manual & scheduled reminders (WhatsApp/SMS/email) | Finance Staff | T2 |
| ACC-19 | Vendor bills & payables | Bills, due dates, payments to vendors | Finance | T3 |
| ACC-20 | Payroll / faculty payments | Faculty pay, salary runs, TDS | Finance | T3 |
| ACC-21 | GST / tax handling | Tax rates on fee heads, GSTIN, tax reports | Finance | T2 |
| ACC-22 | Period closing / locking | Lock a month/FY so past entries cannot be changed | Owner | T2 |
| ACC-23 | Profit & loss | Correct, period-scoped P&L | Owner | T1 |
| ACC-24 | Balance sheet | Assets, liabilities, equity at a date | Owner | T2 |
| ACC-25 | Trial balance | Debits = credits check by account | Finance | T2 |
| ACC-26 | Cash-flow statement | Operating cash in/out by period | Owner | T2 |
| ACC-27 | Party statements | Student ledger, related-party statement | Finance | T1 |
| ACC-28 | Receivables aging | 0-30/31-60/61-90/90+ buckets | Finance | T2 |
| ACC-29 | Approvals (maker-checker) | Approval for refunds, waivers, back-dated edits | Owner | T3 |
| ACC-30 | Financial audit trail | Insert/update/delete history with who/when for all money tables | Owner | T1 |
| ACC-31 | Multi-currency | Foreign-currency fees | Finance | T3 |
| ACC-32 | Online fee payment | Payment-gateway checkout + webhook → receipt | Student / Finance | T2 |
| ACC-33 | Opening balances | Opening bank/cash, receivable, related-party balances for a new tenant | Owner | T1 |
| ACC-34 | Financial-year handling | Indian FY (Apr-Mar) filters and numbering | Finance | T1 |

## 4. Student Lifecycle

| ID | Capability | Short description | Primary user role | Tier |
|---|---|---|---|---|
| STU-01 | Leads / enquiries | Capture, follow up, convert to admission | Admin / Counsellor | T2 |
| STU-02 | Admission / enrolment | Enrol into batch with fee auto-fill | Admin / Staff | T1 |
| STU-03 | Student profile | Personal & contact details | Admin / Staff | T1 |
| STU-04 | Guardians | One or more guardians with relation & contact | Admin | T2 |
| STU-05 | Student documents | Upload ID proof, certificates, photos (private storage) | Admin | T2 |
| STU-06 | Auto student ID | Per-tenant ID format and sequence | Admin | T1 |
| STU-07 | Batch assignment | Student ↔ batch | Admin / Staff | T1 |
| STU-08 | Bulk import / update | Excel template, dry-run, all-or-nothing apply | Admin | T1 |
| STU-09 | Status lifecycle | Registered → Active → Completed / Dropped, date-driven | Admin | T1 |
| STU-10 | Batch transfer with history | Move student between batches keeping history | Admin | T2 |
| STU-11 | Completion & alumni | Completed students as alumni list | Admin | T3 |
| STU-12 | Certificates | Generate/verify course certificates | Admin | T2 |
| STU-13 | Student login linking | Link a login to a student record | Admin | T1 |

## 5. Academics

| ID | Capability | Short description | Primary user role | Tier |
|---|---|---|---|---|
| ACA-01 | Courses | Course master | Admin | T1 |
| ACA-02 | Curriculum / modules / lessons | Syllabus structure per course | Admin / Faculty | T3 |
| ACA-03 | Batches | Batch master with dates and fees | Admin | T1 |
| ACA-04 | Timetable | Weekly schedule per batch with conflict check | Admin | T2 |
| ACA-05 | Attendance | Mark/record attendance per session | Faculty | T2 |
| ACA-06 | Course completion % | Progress per student/batch | Faculty / Student | T2 |
| ACA-07 | Assignments | Create, submit, grade | Faculty / Student | T2 |
| ACA-08 | Online exams | Timed MCQ, server scoring | Faculty / Student | T2 |
| ACA-09 | Offline marks entry | Enter marks for written/practical exams | Faculty | T2 |
| ACA-10 | Grades / report cards | Grade scales, report cards | Admin | T3 |
| ACA-11 | Study material / library | Upload and share materials | Faculty | T3 |

## 6. Faculty

| ID | Capability | Short description | Primary user role | Tier |
|---|---|---|---|---|
| FAC-01 | Faculty profile | Qualifications, subjects, contact | Admin | T2 |
| FAC-02 | Assigned batches | Faculty ↔ batch | Admin | T2 |
| FAC-03 | Personal timetable | Own classes | Faculty | T2 |
| FAC-04 | Mark attendance | Attendance screen for own sessions | Faculty | T2 |
| FAC-05 | Create assignments / exams & grade | Authoring and grading | Faculty | T2 |
| FAC-06 | Workload | Hours per faculty | Admin | T3 |
| FAC-07 | Faculty payments | Link to payroll (ACC-20) | Finance | T3 |
| FAC-08 | Faculty performance | Reviews + results summary | Admin | T3 |

## 7. Student Portal

| ID | Capability | Short description | Primary user role | Tier |
|---|---|---|---|---|
| SPT-01 | Student dashboard | Personal home page | Student | T2 |
| SPT-02 | My profile | View (and request correction of) own data | Student | T2 |
| SPT-03 | Course details | Course, batch, faculty | Student | T2 |
| SPT-04 | Timetable view | Own batch schedule | Student | T2 |
| SPT-05 | Attendance view | Own attendance % | Student | T2 |
| SPT-06 | Completion % | Own progress | Student | T3 |
| SPT-07 | Assignment submission | Submit link/file | Student | T2 |
| SPT-08 | Exam scores | Results after release | Student | T2 |
| SPT-09 | Fee status & receipts | Own dues and receipts only | Student | T2 |
| SPT-10 | Class & faculty feedback | Rate classes/faculty | Student | T2 |
| SPT-11 | Support tickets | Raise and track queries | Student | T2 |
| SPT-12 | Notifications | In-app notices | Student | T2 |
| SPT-13 | Live-class access | Join today's class | Student | T2 |

## 8. Parent Portal

| ID | Capability | Short description | Primary user role | Tier |
|---|---|---|---|---|
| PAR-01 | Parent login & child linking | Parent account linked to one or more students | Parent | T3 |
| PAR-02 | Child progress view | Attendance, marks, timetable | Parent | T3 |
| PAR-03 | Fee status & online payment | Dues, receipts, pay online | Parent | T3 |

## 9. Live Classroom (integrate, don't build)

| ID | Capability | Short description | Primary user role | Tier |
|---|---|---|---|---|
| LIV-01 | Scheduled class with meeting link | Store and open Meet/Zoom/Jitsi link per slot | Faculty / Student | T2 |
| LIV-02 | Zoom / Google Meet API integration | Auto-create meetings, fetch participants | Faculty | T3 |
| LIV-03 | Attendance from joins | Mark present when student clicks Join / from meeting report | Faculty | T3 |
| LIV-04 | Recordings | Link recordings to sessions | Faculty / Student | T3 |

## 10. Support & Communication

| ID | Capability | Short description | Primary user role | Tier |
|---|---|---|---|---|
| COM-01 | Announcements | Batch/institute-wide notices | Admin / Faculty | T2 |
| COM-02 | In-app notifications | Per-user inbox | All | T2 |
| COM-03 | Email sending & templates | Invites, receipts, reminders via transactional email | Platform / Admin | T2 |
| COM-04 | WhatsApp messaging | Template messages via a BSP | Admin | T2 |
| COM-05 | SMS | DLT-registered SMS | Admin | T3 |
| COM-06 | Message log | Delivery status per message | Admin | T2 |
| COM-07 | Support ticket portal | Tickets from students/staff to institute admin | Student / Admin | T2 |
| COM-08 | Tenant → vendor support channel | How an institute contacts the PULSE team (helpdesk/email/WhatsApp) | Institute Owner | T1 |

## 11. Reviews & Quality

| ID | Capability | Short description | Primary user role | Tier |
|---|---|---|---|---|
| REV-01 | Faculty review | Students rate faculty | Student | T2 |
| REV-02 | Class / session review | Rate a specific session | Student | T3 |
| REV-03 | Anonymous feedback | Feedback not attributable to the student by faculty | Student | T3 |
| REV-04 | Review analytics | Averages and trends | Admin | T3 |

## 12. Reports & Analytics

| ID | Capability | Short description | Primary user role | Tier |
|---|---|---|---|---|
| RPT-01 | Operational dashboard | Students, batches, status counts | Owner / Admin | T1 |
| RPT-02 | Finance dashboard | Revenue, expense, P&L, balances, receivables | Owner | T1 |
| RPT-03 | Report registry & export | Filtered reports with Excel / print | Owner / Admin | T1 |
| RPT-04 | Admissions funnel | Lead → admission conversion | Owner | T3 |
| RPT-05 | Attendance trends | By batch / student | Admin | T3 |
| RPT-06 | Exam performance | By batch / question | Faculty | T3 |
| RPT-07 | Custom report builder | User-defined columns/filters | Owner | T3 |
| RPT-08 | Scheduled / emailed reports | Monthly finance pack by email | Owner | T3 |
| RPT-09 | Server-side totals & pagination | Aggregates computed in the DB; lists paged; no silent 1,000-row cap | Engineering | T1 |

## 13. Compliance & Security

| ID | Capability | Short description | Primary user role | Tier |
|---|---|---|---|---|
| CMP-01 | DPDP notice & consent | Privacy notice, purpose, consent record (guardian consent for minors) | Owner | T1 |
| CMP-02 | Data-principal requests | Access, correction, erasure requests with log | Owner | T2 |
| CMP-03 | Retention & purge | Retention periods, purge of stale backups/copies | Platform | T2 |
| CMP-04 | Backups & restore drills | Automated off-platform backups; tested restore | Platform | T0 |
| CMP-05 | Encryption | At rest & in transit | Platform | T0 |
| CMP-06 | Access logs | Who viewed/exported sensitive data | Owner | T2 |
| CMP-07 | Tenant-isolation test suite | Automated Tenant A vs Tenant B tests for every table, in CI | Engineering | T0 |
| CMP-08 | Fix current RLS / RPC gaps | Close findings C-1..M-x in 01 §A6 before multi-tenancy | Engineering | T0 |
| CMP-09 | Rate limiting & abuse protection | Auth & RPC rate limits, CAPTCHA on public forms | Platform | T2 |
| CMP-10 | Incident & breach response | Runbook, breach notification per DPDP | Owner | T2 |
| CMP-11 | Customer terms & DPA | Terms of service, data-processing agreement with institutes | Owner | T1 |
| CMP-12 | Data residency (India) | Data stays in India region | Platform | T0 |

## 14. Integrations (not built in-house)

| ID | Capability | Short description | Primary user role | Tier |
|---|---|---|---|---|
| INT-01 | Payment gateway | Razorpay / Cashfree checkout + webhooks | Platform | T2 |
| INT-02 | WhatsApp Business API | Via a BSP (e.g. Meta Cloud API / Gupshup / Interakt) | Platform | T2 |
| INT-03 | Transactional email provider | Resend / Amazon SES / Postmark with custom SMTP for Supabase Auth | Platform | T2 |
| INT-04 | Video conferencing | Google Meet / Zoom links (Jitsi as free fallback) | Platform | T2 |
| INT-05 | SMS gateway | DLT-compliant provider (e.g. MSG91) | Platform | T3 |
| INT-06 | Accounting export | Tally-compatible export of vouchers | Finance | T3 |

## 15. AI Intelligence Layer

| ID | Capability | Short description | Primary user role | Tier |
|---|---|---|---|---|
| AI-01 | Insights | Plain-language weekly summary of finance & academics | Owner | T4 |
| AI-02 | Dropout / risk detection | Flag students at risk (attendance, dues, marks) | Admin | T4 |
| AI-03 | Natural-language queries | Ask questions of tenant data, scoped by RLS | Owner | T4 |
| AI-04 | Assistant | Help with drafting notices, reconciling, data entry | Staff | T4 |
| AI-05 | Collection forecasting | Predict cash inflow from dues | Owner | T4 |

## Capabilities intentionally NOT built in-house

For a solo-founder product, building these would cost months and add security/compliance burden with no competitive advantage. PULSE stores *links, references and statuses*; the specialist service does the hard part.

| Capability | Recommended approach | Why not build | Notes / trade-offs |
|---|---|---|---|
| **Video conferencing / live classroom** | Store a meeting link per timetable slot (today's model). Phase 2: optional Google Meet (Calendar API) or Zoom (Server-to-Server OAuth) to auto-create meetings and pull participant reports for attendance. Keep Jitsi (`meet.jit.si` or self-hosted) as free fallback. | Real-time video needs TURN/SFU servers, bandwidth, recording storage — expensive and hard to run reliably. | **Google Meet**: free with Workspace, familiar in Kerala, weak API for attendance unless Workspace edition supports it. **Zoom**: best attendance/recording API, paid per host. **Jitsi public (meet.jit.si)**: free, but moderators must sign in and embedding it inside another app is restricted to short demo calls (per Jitsi's 2023 policy — re-verify before relying on it); no reliable attendance data. Self-hosted Jitsi removes the limits but adds server cost/ops. Recommendation: link-only for T2, Zoom/Meet API in T3 only if customers ask. |
| **Payment gateway** | Razorpay or Cashfree hosted checkout / payment links; webhook → Edge Function → create receipt. | PCI-DSS scope, settlement, refunds, UPI mandates. | Never store card/UPI credentials. Webhook must be verified (signature) and idempotent. Tenant gets own merchant account (Route/sub-merchant) — decide model in C7. |
| **WhatsApp messaging** | Meta WhatsApp Cloud API directly, or a BSP (Interakt, AiSensy, Gupshup) per tenant. | Template approval, opt-in rules, number verification, delivery infra. | Each institute should own its WhatsApp number; PULSE stores template IDs and logs. Cost is per conversation. |
| **SMS** | DLT-registered provider (MSG91, Kaleyra). | TRAI DLT registration per sender. | Lower priority than WhatsApp in Kerala. |
| **Email delivery** | Resend / Amazon SES / Postmark; also configure Supabase Auth custom SMTP so invites/resets come from the product domain. | Deliverability, SPF/DKIM, bounce handling. | Supabase's built-in email has low rate limits and is not for production volume. |
| **File storage & virus scanning** | Supabase Storage (private buckets, tenant-prefixed paths); optional scanning via provider later. | Already provided. | Enforce size + MIME limits at bucket level. |
| **Authentication** | Supabase Auth (email, OAuth, MFA TOTP). | Already provided. | Add custom access-token hook only if needed for tenant claims (see 03 §C3). |
| **Error monitoring** | Sentry (free tier) or similar. | Not core. | Scrub personal data from events. |
| **Accounting statutory filing** | Export to Tally / CA-friendly Excel; do not build GST return filing. | Regulatory complexity. | T3 export only. |
| **AI models** | Use a hosted LLM API behind an Edge Function that only receives RLS-scoped data. | Training/hosting models is out of scope. | T4; must respect DPDP (no student PII sent without basis). |
