-- Read-only checks for migration 32 (bank_match_links, bank_sync_history).

-- Matched lines vs backfilled links.
select
  (select count(*) from public.bank_statement_lines
    where status = 'matched' and match_id is not null) as matched_lines,
  (select count(*) from public.bank_match_links where source = 'backfill') as backfill_links,
  (select count(*) from public.bank_match_links) as total_links;

-- a) Book entries that more than one matched line points to: the user must
--    split these entries (a book entry may link to only one bank line).
select l.match_kind, l.match_id, l.id as line_id, l.txn_date,
       l.deposit, l.withdrawal,
       count(*) over (partition by l.match_kind, l.match_id) as lines_on_entry
from public.bank_statement_lines l
where l.status = 'matched' and l.match_id is not null
  and (l.match_kind, l.match_id) in (
    select match_kind, match_id
    from public.bank_statement_lines
    where status = 'matched' and match_id is not null
    group by match_kind, match_id
    having count(*) > 1)
order by l.match_kind, l.match_id, l.id;

-- b) Matched lines that did NOT get a backfill link, with the reason.
select l.id as line_id, l.match_kind, l.match_id,
  case
    when l.match_kind is null then 'match_kind is null'
    when l.match_kind = 'collection'
         and not exists (select 1 from public.collections c where c.id = l.match_id)
      then 'collection no longer exists'
    when l.match_kind = 'expense'
         and not exists (select 1 from public.expenses e where e.id = l.match_id)
      then 'expense no longer exists'
    when l.match_kind = 'transfer'
         and not exists (select 1 from public.transfers t where t.id = l.match_id)
      then 'transfer no longer exists'
    else 'book entry already linked to another line (shared entry, see check a)'
  end as reason
from public.bank_statement_lines l
where l.status = 'matched' and l.match_id is not null
  and not exists (select 1 from public.bank_match_links k where k.line_id = l.id);

-- c) Links whose book entry no longer exists (expect 0 rows).
select k.id, k.line_id, k.book_kind, k.book_id
from public.bank_match_links k
where not exists (
  select 1 where
    (k.book_kind = 'collection' and exists (select 1 from public.collections c where c.id = k.book_id)) or
    (k.book_kind = 'expense'    and exists (select 1 from public.expenses e    where e.id = k.book_id)) or
    (k.book_kind = 'transfer'   and exists (select 1 from public.transfers t   where t.id = k.book_id)));

-- Policies on both tables.
select tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('bank_match_links', 'bank_sync_history')
order by tablename, cmd, policyname;

-- RLS enabled?
select relname, relrowsecurity
from pg_class
where oid in ('public.bank_match_links'::regclass, 'public.bank_sync_history'::regclass);

-- Column-level UPDATE grants on bank_sync_history (expect only undone_at).
select grantee, column_name, privilege_type
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'bank_sync_history'
  and privilege_type = 'UPDATE' and grantee in ('authenticated', 'anon');
