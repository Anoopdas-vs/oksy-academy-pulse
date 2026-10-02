-- Read-only checks for migration 36 (per-account links, sync by line, private helpers).

-- bank_match_links.account exists and is NOT NULL.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'bank_match_links' and column_name = 'account';

-- Unique keys on bank_match_links: expect (book_kind, book_id, account), not (book_kind, book_id).
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.bank_match_links'::regclass and contype = 'u'
order by conname;

-- Triggers on bank_match_links (expect check_book + set_account).
select tgname
from pg_trigger
where tgrelid = 'public.bank_match_links'::regclass and not tgisinternal
order by tgname;

-- Every link's account equals its line's account (expect 0 rows).
select k.id, k.account as link_account, l.account as line_account
from public.bank_match_links k
join public.bank_statement_lines l on l.id = k.line_id
where k.account is distinct from l.account;

-- Book entries linked on more than one account (inter-bank transfers only expected).
select book_kind, book_id, array_agg(account order by account) as accounts
from public.bank_match_links
group by book_kind, book_id
having count(*) > 1;

-- Sync functions: schema, SECURITY INVOKER (security_definer = false), search_path.
-- Expect sync_bank_entries / undo_bank_sync in public, the two helpers in private only.
select n.nspname as schema, p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as security_definer,
       p.proconfig as settings
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.proname in ('sync_bank_entries', 'undo_bank_sync', 'bank_sync_get_value', 'bank_sync_set_value')
order by n.nspname, p.proname;

-- Execute grants: authenticated = true, anon = false.
select n.nspname as schema, p.proname,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.proname in ('sync_bank_entries', 'undo_bank_sync', 'bank_sync_get_value', 'bank_sync_set_value')
order by n.nspname, p.proname;

-- Schema private: authenticated has USAGE, anon does not.
select has_schema_privilege('authenticated', 'private', 'usage') as authenticated_usage,
       has_schema_privilege('anon', 'private', 'usage') as anon_usage;
