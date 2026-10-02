-- Migration 32: many-to-many bank matching (bank_match_links) + sync history
--
-- Background: bank_statement_lines carries a single match_kind/match_id, so
-- one bank line can link to only one book entry. Group matching needs a link
-- table. Rule: ONE bank line may link to MANY book entries, but a book entry
-- links to only ONE bank line (many bank lines -> one book entry is handled
-- by splitting the book entry in the UI). Amount diff = bank amount minus the
-- SUM of its linked book amounts.
--
-- Changes (additive only):
--   * public.bank_match_links   — one row per (bank line, book entry) link
--   * public.bank_sync_history  — audit trail of bank_reference/date syncs so
--                                 a sync run can be undone
--   * Backfill: every existing status='matched' line gets one 'backfill' link
--   * Orphan cleanup: deleting a collection/expense/transfer removes its link
--   * bank_statement_lines.match_kind / match_id are kept for backward
--     compatibility; nothing existing is dropped or altered.
--
-- RLS follows bank_statement_lines: SELECT via can_view_financials(),
-- writes via is_admin(). bank_sync_history has no DELETE policy and only
-- undone_at is updatable (append-only; undo sets undone_at).
--
-- Assumption: single-tenant (one academy); there is no tenant column.
-- Idempotent: safe to re-run. No explicit transaction (the runner wraps one).
-- TODO: fold into schema.sql during Step 16.

-- ── bank_match_links ────────────────────────────────────────────────────
create table if not exists public.bank_match_links (
  id uuid primary key default gen_random_uuid(),
  line_id bigint not null references public.bank_statement_lines (id) on delete cascade,
  book_kind text not null check (book_kind in ('collection', 'expense', 'transfer')),
  book_id bigint not null,
  source text not null
    check (source in ('auto_utr', 'auto_exact', 'auto_group', 'manual', 'backfill')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (book_kind, book_id)
);

create index if not exists bank_match_links_line_idx
  on public.bank_match_links (line_id);

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

-- Deleting a book entry removes its link so no orphan links are left.
-- SECURITY DEFINER so the cleanup also runs when the deleting user could not
-- delete links themselves under RLS.
create or replace function public.bank_match_links_cleanup_book()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.bank_match_links
  where book_kind = case TG_TABLE_NAME
      when 'collections' then 'collection'
      when 'expenses' then 'expense'
      when 'transfers' then 'transfer'
    end
    and book_id = old.id;
  return old;
end;
$$;

drop trigger if exists bank_match_links_cleanup_trg on public.collections;
create trigger bank_match_links_cleanup_trg
  after delete on public.collections
  for each row execute function public.bank_match_links_cleanup_book();
drop trigger if exists bank_match_links_cleanup_trg on public.expenses;
create trigger bank_match_links_cleanup_trg
  after delete on public.expenses
  for each row execute function public.bank_match_links_cleanup_book();
drop trigger if exists bank_match_links_cleanup_trg on public.transfers;
create trigger bank_match_links_cleanup_trg
  after delete on public.transfers
  for each row execute function public.bank_match_links_cleanup_book();

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
-- Tamper-proofing: only undone_at may ever be changed.
revoke update on public.bank_sync_history from authenticated, anon;
grant update (undone_at) on public.bank_sync_history to authenticated;

-- ── Backfill existing 1:1 matches ───────────────────────────────────────
-- A book entry can link to only one line, so if several matched lines point
-- at the same entry the lowest line id wins; the rest are left unlinked and
-- are listed by supabase/checks/32_bank_match_links_checks.sql for splitting.
-- Lines pointing at a record that no longer exists are skipped.
insert into public.bank_match_links (line_id, book_kind, book_id, source)
select distinct on (l.match_kind, l.match_id) l.id, l.match_kind, l.match_id, 'backfill'
from public.bank_statement_lines l
where l.status = 'matched'
  and l.match_id is not null
  and l.match_kind is not null
  and (
    (l.match_kind = 'collection' and exists (select 1 from public.collections c where c.id = l.match_id)) or
    (l.match_kind = 'expense'    and exists (select 1 from public.expenses e    where e.id = l.match_id)) or
    (l.match_kind = 'transfer'   and exists (select 1 from public.transfers t   where t.id = l.match_id))
  )
order by l.match_kind, l.match_id, l.id
on conflict (book_kind, book_id) do nothing;

-- ROLLBACK:
--   drop trigger if exists bank_match_links_cleanup_trg on public.collections;
--   drop trigger if exists bank_match_links_cleanup_trg on public.expenses;
--   drop trigger if exists bank_match_links_cleanup_trg on public.transfers;
--   drop function if exists public.bank_match_links_cleanup_book();
--   drop table if exists public.bank_sync_history;
--   drop table if exists public.bank_match_links;  -- also drops its check trigger
--   drop function if exists public.bank_match_links_check_book();
