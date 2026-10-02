-- Read-only checks for migration 35 (bank sync + undo RPCs).

-- Functions exist, are SECURITY INVOKER (security_definer = false), search_path pinned.
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as security_definer,
       p.proconfig as settings
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('sync_bank_entries', 'undo_bank_sync', 'bank_sync_get_value', 'bank_sync_set_value')
order by p.proname;

-- Execute grants: authenticated = true, anon = false.
select p.proname,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('sync_bank_entries', 'undo_bank_sync', 'bank_sync_get_value', 'bank_sync_set_value')
order by p.proname;

-- Raw ACLs (expect owner + authenticated only).
select p.proname, p.proacl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('sync_bank_entries', 'undo_bank_sync', 'bank_sync_get_value', 'bank_sync_set_value');

-- Recent sync runs (read-only view of the history).
select run_id, min(synced_at) as synced_at, count(*) as changes,
       count(*) filter (where undone_at is not null) as undone
from public.bank_sync_history
group by run_id
order by min(synced_at) desc
limit 20;
