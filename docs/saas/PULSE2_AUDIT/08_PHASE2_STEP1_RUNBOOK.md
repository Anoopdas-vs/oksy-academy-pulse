# 08 — Phase 2 Step 1: baseline, CI, Sentry (runbook)

Status 2026-10-21: CI workflow and Sentry code done on branch `phase2/step0-closeout` (not pushed).
Baseline dump waits for Docker + Supabase CLI on the Mac.

## Why the baseline is not hand-written
A schema typed by hand from catalog queries can silently differ from production.
The baseline must come from `supabase db dump` (real pg_dump). Catalog facts already
gathered read-only from prod (2026-10-21): 26 tables, 266 columns, 81 policies
(public+storage), 49 functions, 17 triggers on public tables (+ `on_auth_user_created` on
auth.users), 43 indexes, 2 views, 9 identity sequences, 1 cron job
(`batch-auto-student-status`, `35 18 * * *`), bucket `submissions` (10 MB, 11 MIME types),
extensions pg_cron, pgcrypto, uuid-ossp, supabase_vault, pg_stat_statements.
Specials the dump must keep: `collections` has column-level SELECT for `authenticated`
on `id` only; `bank_sync_history` has UPDATE on `undone_at` only and no UPDATE/DELETE for
anon/authenticated otherwise; event trigger `ensure_rls` -> `rls_auto_enable()` exists only on prod.

## Commands (once Docker Desktop is running)
```bash
brew install supabase/tap/supabase          # CLI
supabase init                               # creates supabase/config.toml (keep existing SQL files)
supabase login                              # opens browser
supabase link --project-ref lkkbaosujkkakoglxmah   # asks DB password (Anoop types it, never shared)
supabase db dump --linked --schema public -f /tmp/prod_public.sql   # read-only
```
Then Claude turns the dump into `supabase/migrations/00000000000000_baseline.sql`,
adds 49 as the next migration, runs `npm run db:reset` locally and compares the local
catalog with prod using the drift script (Step 2 item 3).

## Reconciling repo vs prod history
| Area | State |
|---|---|
| Prod history | starts at 28; 00–27 were applied by hand before CLI use |
| Staging history | has 00–48 plus `staging_stub_*`, `staging_shim_*`, duplicate `28`/`28b`/`36`, extra `phase1_revoke_trigger_fn_authenticated` |
| Repo | loose `supabase/NN_*.sql` (00–49), no 37 file, `28b` x2, 3 big schema files |
Decision: the baseline replaces 00–48 as the starting point. Old files move to
`supabase/legacy/` (reference only). From now on every change is
`supabase/migrations/<timestamp>_name.sql` + `supabase/down/…down.sql`.

## Rebuilding staging from the baseline (needs Anoop's OK first)
Staging currently holds test users and data. Plan: do the rebuild locally first (free),
prove local == prod with the drift script, and only then decide whether staging needs a
reset at all or is simply drift-checked. No staging wipe without approval.

## Monitoring (Sentry)
Code: `src/lib/monitoring.js`; DSN only via `VITE_SENTRY_DSN`; release = git SHA
(`VITE_APP_RELEASE`, set in `vite.config.js` from `VERCEL_GIT_COMMIT_SHA`). Sentry code is
lazy-loaded only when a DSN exists. Test: open the app, browser console, run
`window.pulseSentryTest()`, see the event in Sentry.

## CI
`.github/workflows/ci.yml`: lint + test + build, npm audit (high), gitleaks secret scan.
Branch protection (Anoop): GitHub > repo > Settings > Branches > Add rule for `main`:
require PR, require status checks `lint + test + build`, `npm audit`, `secret scan`,
block force pushes, block deletions.
