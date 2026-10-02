-- Read-only checks for migration 34 (save_bank_match_links / remove_bank_match_links).

-- Functions exist, are SECURITY INVOKER (prosecdef = false) and pin search_path.
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as security_definer,
       p.proconfig as settings
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('save_bank_match_links', 'remove_bank_match_links')
order by p.proname;

-- Execute grants: authenticated = true; anon and public-via-anon = false.
select p.proname,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('save_bank_match_links', 'remove_bank_match_links')
order by p.proname;

-- Raw ACLs (expect an entry for authenticated and the owner, none for anon / PUBLIC).
select p.proname, p.proacl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('save_bank_match_links', 'remove_bank_match_links');
