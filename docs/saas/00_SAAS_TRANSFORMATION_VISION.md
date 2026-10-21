# SaaS Transformation Vision — Pulse → Multi-Tenant Institute Platform

> This document SUPERSEDES `02_MULTI_TENANT_PRODUCT_VISION.md` from the "Oksy Academy Pulse — Features & UI"
> project. The decision has been made: multi-tenancy is now active work, not a future idea.

## 1. Core principle

We are NOT building a new app from zero. We are transforming the existing Pulse application
(`pulse.oksyacademy.in`, repo `oksy-academy-pulse`) into a secure, multi-tenant SaaS product.

- One codebase, one database. No fork, no second repo.
- Oksy Academy becomes **Tenant #001** — a customer of the product, not its identity.
- The product gets its own brand later (candidates: Acadex, Campuzo). Until decided, use the internal
  name **PULSE 2.0**. Never hard-code "Oksy Academy" into architecture, logic, or schema.

## 2. Business goal

- First outside institute sale: **January 2027**.
- Long-term: 25+ institutes, then 100+.
- Positioning: "The Operating System for Modern Institutes" — admissions to reporting in one platform.

## 3. Scope — what is needed for January vs. later

### Must have before first sale (MVP)
1. Multi-tenant foundation: `tenants` table, `tenant_id` on all tenant-owned data, RLS isolation.
2. Tenant-aware users & roles (Platform Super Admin, Institute Owner, Institute Admin, Finance Staff, Faculty).
3. Existing features working per-tenant: students, batches, courses, fees & collections, expenses,
   bank reconciliation, reports.
4. Tenant settings & branding config (name, logo, colors, contact info) — from one config point.
5. Onboarding flow: create a new institute, its owner account, and starter configuration.
6. Platform admin panel: list/create/suspend tenants.
7. Oksy Academy data migrated safely into Tenant #001.

### After first sale (add in order of customer demand)
Attendance, assignments, timetable, exams, certificates, faculty/class review, communication
(WhatsApp/email/SMS), student/parent portals, subscription billing.

### Last
AI intelligence layer (insights, risk detection, natural-language queries, assistant).

## 4. Non-negotiables

- **Tenant isolation is enforced in the database (RLS), never only in the frontend.**
  Every tenant-owned table must be tested: a user of Tenant A must not read/write Tenant B data.
- Production data changes require: backup → staging test → explicit owner approval → apply.
- Super-admin access to a tenant must be audit-logged.
- Per-tenant data export and deletion must be possible (offboarding).
- Respect India's DPDP Act for student personal data.

## 5. Way of working

Audit first. Then one-purpose-per-phase. No phase starts until the previous one is tested and signed off.

### Phase 0 — Audit (read-only, no code changes)
Produce:
A. Current architecture
B. Existing feature map
C. Oksy-specific dependencies (hard-coded names, logos, domains, assumptions)
D. Multi-tenant conversion plan
E. Recommended SaaS architecture (shared schema + tenant_id vs. alternatives, with reasoning)
F. Database changes required (table by table)
G. Authentication / authorization changes
H. Feature roadmap
I. Migration strategy for Oksy production data
J. Risks / technical debt

Each existing item classified as **KEEP / MODIFY / REFACTOR / REMOVE / ADD**.

### Later phases (to be finalised after the audit)
1. Tenant foundation (schema + RLS + memberships) — security-critical
2. Oksy data backfill into Tenant #001
3. Tenant-aware app layer (queries, storage buckets, edge functions)
4. Branding & settings config
5. Platform admin + onboarding
6. Pilot with second institute

## 6. Success definition

A completely different institute can be onboarded, configure itself, add courses, batches, staff and
students, and run fees/expenses/reports — with zero Oksy Academy-specific dependency and zero
possibility of seeing another tenant's data.

## 7. Coordination with the old project

The "Oksy Academy Pulse — Features & UI" project uses the same repo. While transformation is in
progress, that project handles only small fixes for Oksy's daily operations. No large new features
there, to avoid code conflicts.
