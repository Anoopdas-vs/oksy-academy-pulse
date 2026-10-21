# 06 - Phase 1 production runbook (NOT YET EXECUTED)

Production project: `lkkbaosujkkakoglxmah`. Staging: `mgiowjacjyhdtvrlhaaa` (40-48 applied and verified).
Rule: production changes only after Anoop's explicit go-ahead in chat.

## Pre-conditions
1. Fresh backup: GitHub repo > Actions > "Nightly database backup" > Run workflow; wait for green; confirm an artifact `db-backup-*` exists. (Also confirm the scheduled runs were green.)
2. Optional safety: note current production state of the objects touched (policy/function texts were captured 2026-10-06 and re-read 2026-10-21; see undo blocks at the bottom of each migration file).
3. Anoop says "apply to production".

## Apply order (one migration at a time, check the result before the next)
40 -> 41 -> 42 -> 43 -> 44 -> 45 -> 46 -> 47 -> 48 (files in `supabase/`, bodies identical to staging).
Use `apply_migration` with the migration name = file name. Then apply the final patch (revoke `authenticated` on trigger functions) - it is already folded into files 43, 47 and 48 as committed.
Note: 38 and 39 are already on production; do not re-apply.

## Post-apply checks on production (read-only / rolled-back)
- Re-run the structural checks only (no fixtures): policies `expenses_approved_select` uses is_staff_or_admin; view `collections_basic` filter; `notify_batch` has the guard and no anon EXECUTE; bucket `submissions` limit 10485760; triggers exist; advisor shows no anon-executable definer function except the policy helpers.
- Smoke test on pulse.oksyacademy.in as Owner: Dashboard, one report, Fee Collection list, Expenses list. As Executive: Enrollment edit of a non-fee field.
- Do NOT run the data-writing checks file on production.

## Rollback
Per-migration UNDO block at the bottom of each file; worst case restore from the backup.

## Manual steps (Anoop): M-1 leaked-password protection, M-2 repo private, M-3 backup confirmed, M-4 delete `smart-endpoint` (see 04 section 9).
