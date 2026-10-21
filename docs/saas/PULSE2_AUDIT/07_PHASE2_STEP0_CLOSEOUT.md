# 07 — Phase 2 Step 0: Phase 1 close-out (2026-10-21)

Status: **migration 49 and the 38 history row APPLIED on production 2026-10-21 (Anoop approved, backup confirmed). Verified: all 8 helpers anon=false, authenticated=true; anon-executable advisor warnings gone. `smart-endpoint` DELETED by Anoop and verified (only `create-user` remains). Owner smoke test passed. Pending: items e (leaked-password toggle) and f (repo privacy, nightly backup, restore drill).**

## Findings and actions

| Item | Finding | Action | State |
|---|---|---|---|
| a (DONE) | Edge function `smart-endpoint` (v1, hand-deployed, old copy of `create-user`) still ACTIVE on prod. Nothing in repo/app calls it (only `create-user` is invoked, `src/lib/data.js:317`). | Delete in Supabase dashboard -> Edge Functions (MCP has no delete tool). Then re-list to verify. | Needs Anoop's yes + dashboard click |
| b | 8 definer helpers executable by anon/PUBLIC. 38 policies are `TO public`, so anon requests to those tables will now get "permission denied" instead of an empty list (no data either way). App never reads as anon. | Migration `49_revoke_anon_policy_helpers.sql` (+ down file in `supabase/down/`). | Applied + tested on staging; prod pending |
| c | `collections_basic` and `exam_questions_public` are definer **on purpose**. `authenticated` has no SELECT on `collections` except column `id`, and none on `exam_questions`; the views are the only door and filter rows with `is_staff_or_admin()/my_student_ref()` and published + `my_batch()`. `exam_questions_public` has no `correct_index`. Making them invoker would force granting table SELECT and expose `account` / answer keys. | No behaviour change. Documented; will be on the catalog-guard allow-list (Step 2). Tests in `supabase/checks/49_step0_checks.sql`. | Done (tests green on staging) |
| d | Prod function bodies for migration 38 are live (identical to staging after stripping comments). Only the **history row** is missing on prod. Staging has an extra row `phase1_revoke_trigger_fn_authenticated` whose effect is already in migration 47 on prod (ACLs identical). Migration 39 is applied on prod (`adjustments_account`). `rls_auto_enable()` exists on prod only (Supabase event-trigger helper). | Insert history row for 38 on prod (SQL below). Baseline in Step 1 resolves the rest. | Pending approval |
| e | Leaked-password protection OFF (prod advisor, also staging). | Manual by Anoop (Pro plan). | Pending Anoop |
| f | Repo privacy decision, nightly backup, restore drill. | Ask Anoop; record answers here. | Pending Anoop |

### Extra low findings (not fixed yet, proposal only)
- `authenticated` can read `collections.id` for every row (count/ids only, no money or student data). By design for UPDATE/RETURNING; revisit in Phase 3.
- `anon` holds table-level INSERT/UPDATE/DELETE/TRUNCATE on all public tables (Supabase default). RLS blocks rows, and PostgREST cannot TRUNCATE, but a "revoke all from anon on public tables" migration is cleaner. Propose as migration 50 after Anoop approves.

## Exact SQL for production (after approval, in this order)
1. Fresh backup confirmed.
2. Migration 49 (same text as `supabase/49_revoke_anon_policy_helpers.sql`).
3. History row for 38:
```sql
insert into supabase_migrations.schema_migrations (version, name)
values ('20261021150126', '38_student_delete_any_status') on conflict do nothing;
```
4. Delete `smart-endpoint` in dashboard.
5. Re-run advisors; run smoke test per role.

Rollback for 49: `supabase/down/49_revoke_anon_policy_helpers.down.sql`.

## Staging results (migration 49 applied)
All checks PASS: anon blocked on all 8 helpers; admin/staff/faculty/student helpers work; admin reads expenses, student 0; student sees no other receipts via `collections_basic`; student cannot read `student_id/amount/account` of `collections`; 0 raw `exam_questions`; only own-batch published questions in `exam_questions_public`; no answer-key column. `npm run lint`, 385 unit tests, build all green (6 RLS tests skip without env).
Staging advisors: anon-executable definer warnings gone; remaining = 2 definer views (intended), authenticated-executable RPCs (intended app RPCs), leaked password.
