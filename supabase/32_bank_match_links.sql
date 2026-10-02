-- Migration 32: many-to-many bank matching (bank_match_links) + sync history
--
-- Background: bank_statement_lines carries a single match_kind/match_id, so
-- one bank line can link to only one book entry. Group matching (one bank
-- line <-> several collections, or several bank lines <-> one book entry)
-- needs a link table. Lines and book entries that belong to the same
-- reconciled group share one group_key.
--
-- Changes (additive only):
--   * public.bank_match_links   — one row per (bank line, book entry) link
--   * public.bank_sync_history  — audit trail of bank_reference/date syncs so
--                                 a sync run can be undone
--   * Backfill: every existing status='matched' line gets one 'backfill' link
--   * bank_statement_lines.match_kind / match_id are kept for backward
--     compatibility; nothing existing is dropped or altered.
--
-- RLS follows bank_statement_lines: SELECT via can_view_financials(),
-- writes via is_admin(). bank_sync_history has no DELETE policy (append-only;
-- undo sets undone_at).
--
-- Assumption: single-tenant (one academy); there is no tenant column.
-- Idempotent: safe to re-run.
-- TODO: fold into schema.sql during Step 16.

begin;

-- ── bank_match_links ────────────────────────────────────────────────────
create table if not exists public.bank_match_links (
  id uuid primary key default gen_random_uuid(),
  line_id bigint not null references public.bank_statement_lines (id) on delete cascade,
  group_key uuid not null,
  book_kind text not null check (book_kind in ('collection', 'expense', 'transfer')),
  book_id bigint not null,
  source text not null
    check (source in ('auto_utr', 'auto_exact', 'auto_group', 'manual', 'backfill')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (line_id, book_kind, book_id)
);

create index if not exists bank_match_links_group_idx
  on public.bank_match_links (group_key);
create index if not exists bank_match_links_book_idx
  on public.bank_match_links (book_kind, book_id);

-- book_id is polymorphic (no FK possible), so verify it exists in the table
-- named by book_kind.
create or replace function public.bank_match_links_check_book()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.book_kind = 'collection' then
    if not exists (select 1 from public.collections where id = new.book_id) then
      raise exception 'bank_match_links: collection % does not exist', new.book_id;
    end if;
  elsif new.book_kind = 'expense' then
    if not exists (select 1 from public.expenses where id = new.book_id) then
      raise exception 'bank_match_links: expense % does not exist', new.book_id;
    end if;
  elsif new.book_kind = 'transfer' then
    if not exists (select 1 from public.transfers where id = new.book_id) then
      raise exception 'bank_match_links: transfer % does not exist', new.book_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists bank_match_links_check_book_trg on public.bank_match_links;
create trigger bank_match_links_check_book_trg
  before insert or update of book_kind, book_id on public.bank_match_links
  for each row execute function public.bank_match_links_check_book();

alter table public.bank_match_links enable row level security;

drop policy if exists "bank_match_links_financial_viewer_select" on public.bank_match_links;
create policy "bank_match_links_financial_viewer_select" on public.bank_match_links
  for select using (public.can_view_financials());
drop policy if exists "bank_match_links_admin_insert" on public.bank_match_links;
create policy "bank_match_links_admin_insert" on public.bank_match_links
  for insert with check (public.is_admin());
drop policy if exists "bank_match_links_admin_update" on public.bank_match_links;
create policy "bank_match_links_admin_update" on public.bank_match_links
  for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "bank_match_links_admin_delete" on public.bank_match_links;
create policy "bank_match_links_admin_delete" on public.bank_match_links
  for delete using (public.is_admin());

-- ── bank_sync_history ───────────────────────────────────────────────────
create table if not exists public.bank_sync_history (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  book_kind text not null check (book_kind in ('collection', 'expense', 'transfer')),
  book_id bigint not null,
  field text not null check (field in ('bank_reference', 'date')),
  old_value text,
  new_value text,
  synced_by uuid default auth.uid(),
  synced_at timestamptz not null default now(),
  undone_at timestamptz
);

create index if not exists bank_sync_history_run_idx
  on public.bank_sync_history (run_id);
create index if not exists bank_sync_history_book_idx
  on public.bank_sync_history (book_kind, book_id);

alter table public.bank_sync_history enable row level security;

drop policy if exists "bank_sync_history_financial_viewer_select" on public.bank_sync_history;
create policy "bank_sync_history_financial_viewer_select" on public.bank_sync_history
  for select using (public.can_view_financials());
drop policy if exists "bank_sync_history_admin_insert" on public.bank_sync_history;
create policy "bank_sync_history_admin_insert" on public.bank_sync_history
  for insert with check (public.is_admin());
-- UPDATE exists only so undo can stamp undone_at. No DELETE policy.
drop policy if exists "bank_sync_history_admin_update" on public.bank_sync_history;
create policy "bank_sync_history_admin_update" on public.bank_sync_history
  for update using (public.is_admin()) with check (public.is_admin());

-- ── Backfill existing 1:1 matches ───────────────────────────────────────
-- One group per line. Lines whose match_id points at a record that no longer
-- exists are skipped (the trigger would reject them).
insert into public.bank_match_links (line_id, group_key, book_kind, book_id, source)
select l.id, gen_random_uuid(), l.match_kind, l.match_id, 'backfill'
from public.bank_statement_lines l
where l.status = 'matched'
  and l.match_id is not null
  and l.match_kind is not null
  and (
    (l.match_kind = 'collection' and exists (select 1 from public.collections c where c.id = l.match_id)) or
    (l.match_kind = 'expense'    and exists (select 1 from public.expenses e    where e.id = l.match_id)) or
    (l.match_kind = 'transfer'   and exists (select 1 from public.transfers t   where t.id = l.match_id))
  )
on conflict (line_id, book_kind, book_id) do nothing;

commit;

-- ROLLBACK:
--   begin;
--   drop table if exists public.bank_sync_history;
--   drop table if exists public.bank_match_links;
--   drop function if exists public.bank_match_links_check_book();
--   commit;
