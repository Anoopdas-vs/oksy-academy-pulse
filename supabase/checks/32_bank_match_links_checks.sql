-- Read-only checks for migration 32 (bank_match_links, bank_sync_history).

-- Matched lines vs backfilled links (links may be fewer only if a matched
-- line points at a record that no longer exists).
select
  (select count(*) from public.bank_statement_lines
    where status = 'matched' and match_id is not null) as matched_lines,
  (select count(*) from public.bank_match_links where source = 'backfill') as backfill_links,
  (select count(*) from public.bank_match_links) as total_links;

-- Matched lines with no link.
select l.id, l.match_kind, l.match_id
from public.bank_statement_lines l
where l.status = 'matched' and l.match_id is not null
  and not exists (select 1 from public.bank_match_links k where k.line_id = l.id);

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
