-- Migration 37: backfill bank_match_links for lines that only have a legacy match
--
-- Purpose (one): give every legacy-matched bank line its missing link row, so
-- "Sync to books" and the RPCs (which require a bank_match_links row) work.
--
-- Why 32/36 left these lines out
--   * 32's backfill only took status = 'matched', so every 'classified' line
--     (a record created from the line) was never linked.
--   * 32 used DISTINCT ON (match_kind, match_id) under a one-link-per-entry
--     key: when several lines pointed at one entry only the lowest id got a
--     link. Migration 36 relaxed that key to one link PER ACCOUNT but did not
--     re-run the backfill, so those lines (e.g. an inter-bank transfer's
--     second account) stayed unlinked.
--   * Rows added after 32 by the old single-column path never got a link row.
--
-- What it does
--   * Inserts one bank_match_links row per eligible line, source
--     'legacy_backfill' (this migration widens the source check, as 33 did, so
--     the rows can be told apart from 32's 'backfill' rows and undone alone).
--   * Eligible = status in ('matched', 'classified'), match_kind + match_id
--     set, the line has NO link row at all, the book entry still exists, and
--     the entry is not already linked to a different line IN THE SAME ACCOUNT
--     (the unique key is (book_kind, book_id, account)). If several eligible
--     lines compete for one entry in an account, the lowest line id wins.
--   * `account` is set by the bank_match_links_set_account trigger from the
--     line (migration 36); created_by/created_at use their defaults; the
--     existence trigger from 32 re-checks the book entry.
--   * Never touches bank_statement_lines or any book table. Existing rows are
--     never changed. Idempotent: a second run finds no eligible lines.
--   * Run it as an admin session (RLS insert policy needs is_admin()).
--
-- PREVIEW (read-only; run before applying). Eligible rows with counts:
--   with legacy as (
--     select l.id as line_id, l.account, l.match_kind, l.match_id, l.status,
--            case
--              when not exists (select 1 from public.collections c where l.match_kind = 'collection' and c.id = l.match_id)
--               and not exists (select 1 from public.expenses e    where l.match_kind = 'expense'    and e.id = l.match_id)
--               and not exists (select 1 from public.transfers t   where l.match_kind = 'transfer'   and t.id = l.match_id)
--                then 'book entry no longer exists'
--              when exists (select 1 from public.bank_match_links k
--                           where k.book_kind = l.match_kind and k.book_id = l.match_id and k.account = l.account)
--                then 'entry already linked to a different line in this account'
--              when l.id <> min(l.id) over (partition by l.match_kind, l.match_id, l.account)
--                then 'another legacy line in this account has the lowest id'
--            end as skip_reason
--     from public.bank_statement_lines l
--     where l.status in ('matched', 'classified')
--       and l.match_kind in ('collection', 'expense', 'transfer')
--       and l.match_id is not null
--       and not exists (select 1 from public.bank_match_links k0 where k0.line_id = l.id)
--   )
--   select match_kind, count(*) filter (where skip_reason is null) as will_insert,
--          count(*) filter (where skip_reason is not null) as will_skip
--   from legacy group by match_kind order by match_kind;
--   -- and the line-level detail (same CTE), skipped lines with their reason:
--   --   select line_id, account, match_kind, match_id, status, coalesce(skip_reason, 'WILL INSERT') from legacy order by skip_reason nulls first, line_id;
--   NOTE: the "lowest id" window above runs over the legacy lines only, as the
--   INSERT below does.
--
-- UNDO (deletes only what this migration inserted; link rows are the only
-- thing it created, so nothing else needs reverting):
--   delete from public.bank_match_links where source = 'legacy_backfill';
--   -- optionally restore the old check afterwards (only after the delete):
--   -- alter table public.bank_match_links drop constraint if exists bank_match_links_source_check;
--   -- alter table public.bank_match_links add constraint bank_match_links_source_check
--   --   check (source in ('auto_utr','auto_exact','auto_name','auto_group','manual','backfill'));
--
-- Requires migrations 32-36. Single-tenant (one academy).
-- TODO: fold into schema.sql during Step 16 (the widened source check, plus
-- this one-off data fix, which a from-scratch rebuild does not need).

begin;

alter table public.bank_match_links
  drop constraint if exists bank_match_links_source_check;
alter table public.bank_match_links
  add constraint bank_match_links_source_check
  check (source in ('auto_utr', 'auto_exact', 'auto_name', 'auto_group', 'manual', 'backfill', 'legacy_backfill'));

insert into public.bank_match_links (line_id, book_kind, book_id, source)
select distinct on (l.match_kind, l.match_id, l.account)
       l.id, l.match_kind, l.match_id, 'legacy_backfill'
from public.bank_statement_lines l
where l.status in ('matched', 'classified')
  and l.match_kind in ('collection', 'expense', 'transfer')
  and l.match_id is not null
  -- the line has no link row at all
  and not exists (select 1 from public.bank_match_links k0 where k0.line_id = l.id)
  -- the book entry still exists
  and (
    (l.match_kind = 'collection' and exists (select 1 from public.collections c where c.id = l.match_id)) or
    (l.match_kind = 'expense'    and exists (select 1 from public.expenses e    where e.id = l.match_id)) or
    (l.match_kind = 'transfer'   and exists (select 1 from public.transfers t   where t.id = l.match_id))
  )
  -- not already linked to another line in this account
  and not exists (
    select 1 from public.bank_match_links k
    where k.book_kind = l.match_kind and k.book_id = l.match_id and k.account = l.account
  )
order by l.match_kind, l.match_id, l.account, l.id
on conflict (book_kind, book_id, account) do nothing;

commit;
