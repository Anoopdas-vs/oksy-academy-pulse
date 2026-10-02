-- Migration 36: per-account bank links (inter-bank transfers), sync by line,
-- and private sync helpers
--
-- 1. Per-account links. An inter-bank transfer (e.g. ICICI -> HDFC) appears on
--    BOTH accounts' statements, but unique(book_kind, book_id) let only one
--    side link. New rule: a book entry links to at most ONE bank line PER
--    ACCOUNT.
--      * bank_match_links.account (text, not null), backfilled from the line;
--      * a BEFORE INSERT OR UPDATE trigger always sets it from the line (never
--        trusted from the client);
--      * unique(book_kind, book_id) -> unique(book_kind, book_id, account).
--    For collections and expenses nothing changes in practice: they belong to
--    one account, so they can only ever be on that account's statements.
--    save_bank_match_links (migration 34) needs no change: its insert still
--    trips the (now per-account) unique key and raises the same 23505 message.
--    The existence trigger, the cleanup triggers and RLS are unchanged.
--
-- 2. sync_bank_entries now takes line_id on every item and requires that exact
--    link (line_id, book_kind, book_id); the amount-diff, date and reference
--    rules use THAT line. A date change on a transfer linked in more than one
--    account is refused ("Transfer is linked in two accounts; correct its date
--    manually."), because the two bank lines may carry different dates.
--
-- 3. bank_sync_get_value / bank_sync_set_value move from public (exposed by
--    PostgREST) to schema private (not exposed), with the same bodies and
--    is_admin() checks; the public versions are dropped. sync_bank_entries and
--    undo_bank_sync call private.*.
--
-- Everything stays SECURITY INVOKER + set search_path = public with an
-- is_admin() check first. Execute: authenticated only.
-- Requires migrations 32-35. Single-tenant (one academy).
-- Idempotent: safe to re-run.
-- NOTE: after this migration, re-running migration 32's backfill would fail
-- (its ON CONFLICT names the old two-column key). 32 has already run, so this
-- only matters for a from-scratch rebuild; fold both into schema.sql during
-- Step 16.

-- ── 1. per-account links ────────────────────────────────────────────────
alter table public.bank_match_links
  add column if not exists account text;

update public.bank_match_links k
set account = l.account
from public.bank_statement_lines l
where l.id = k.line_id
  and k.account is distinct from l.account;

alter table public.bank_match_links
  alter column account set not null;

create or replace function public.bank_match_links_set_account()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  select l.account into new.account
  from public.bank_statement_lines l
  where l.id = new.line_id;
  if new.account is null then
    raise exception 'bank_match_links: bank line % not found', new.line_id;
  end if;
  return new;
end;
$$;

drop trigger if exists bank_match_links_set_account_trg on public.bank_match_links;
create trigger bank_match_links_set_account_trg
  before insert or update on public.bank_match_links
  for each row execute function public.bank_match_links_set_account();

alter table public.bank_match_links
  drop constraint if exists bank_match_links_book_kind_book_id_key;
alter table public.bank_match_links
  drop constraint if exists bank_match_links_book_account_key;
alter table public.bank_match_links
  add constraint bank_match_links_book_account_key unique (book_kind, book_id, account);

-- ── 3. private schema for the sync helpers ──────────────────────────────
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.bank_sync_get_value(p_kind text, p_id bigint, p_field text)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cur text;
  v_found boolean := false;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can sync bank details.';
  end if;
  if p_field not in ('bank_reference', 'date') then
    raise exception 'Invalid field: %', p_field;
  end if;

  if p_kind = 'collection' then
    perform id from public.collections where id = p_id for update;
    v_found := found;
    if v_found then
      select case p_field when 'date' then to_char(b.date, 'YYYY-MM-DD') else b.bank_reference end
        into v_cur from public.collections_basic b where b.id = p_id;
    end if;
  elsif p_kind = 'expense' then
    select case p_field when 'date' then to_char(e.date, 'YYYY-MM-DD') else e.bank_reference end
      into v_cur from public.expenses e where e.id = p_id for update;
    v_found := found;
  elsif p_kind = 'transfer' then
    select case p_field when 'date' then to_char(t.date, 'YYYY-MM-DD') else t.bank_reference end
      into v_cur from public.transfers t where t.id = p_id for update;
    v_found := found;
  else
    raise exception 'Invalid book kind: %', p_kind;
  end if;

  if not v_found then
    raise exception 'Entry % % not found.', p_kind, p_id using errcode = 'P0002';
  end if;
  return v_cur;
end;
$$;

create or replace function private.bank_sync_set_value(p_kind text, p_id bigint, p_field text, p_value text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can sync bank details.';
  end if;
  if p_field not in ('bank_reference', 'date') then
    raise exception 'Invalid field: %', p_field;
  end if;
  if p_field = 'date' and (p_value is null or p_value !~ '^\d{4}-\d{2}-\d{2}$') then
    raise exception 'Invalid date: %', p_value;
  end if;

  if p_kind = 'collection' then
    if p_field = 'date' then
      update public.collections set date = p_value::date where id = p_id;
    else
      update public.collections set bank_reference = p_value where id = p_id;
    end if;
  elsif p_kind = 'expense' then
    if p_field = 'date' then
      update public.expenses set date = p_value::date where id = p_id;
    else
      update public.expenses set bank_reference = p_value where id = p_id;
    end if;
  elsif p_kind = 'transfer' then
    if p_field = 'date' then
      update public.transfers set date = p_value::date where id = p_id;
    else
      update public.transfers set bank_reference = p_value where id = p_id;
    end if;
  else
    raise exception 'Invalid book kind: %', p_kind;
  end if;
  if not found then
    raise exception 'Entry % % not found.', p_kind, p_id using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function private.bank_sync_get_value(text, bigint, text) from public, anon;
revoke all on function private.bank_sync_set_value(text, bigint, text, text) from public, anon;
grant execute on function private.bank_sync_get_value(text, bigint, text) to authenticated;
grant execute on function private.bank_sync_set_value(text, bigint, text, text) to authenticated;

-- ── 2. sync by line ─────────────────────────────────────────────────────
-- p_items = jsonb array of
--   { "line_id": bigint, "book_kind": text, "book_id": bigint,
--     "field": 'bank_reference'|'date', "new_value": text,
--     "expected_old": text, "overwrite": boolean }
create or replace function public.sync_bank_entries(p_run_id uuid, p_items jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  it record;
  v_cur text;
  v_line record;
  v_total numeric;
  v_joined text;
  v_link_count integer;
  v_changed integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can sync bank details.';
  end if;
  if p_run_id is null then
    raise exception 'A run id is required.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Nothing to sync.';
  end if;

  for it in
    select * from jsonb_to_recordset(p_items)
      as x(line_id bigint, book_kind text, book_id bigint, field text,
           new_value text, expected_old text, overwrite boolean)
  loop
    if it.line_id is null
       or it.book_kind is null or it.book_kind not in ('collection', 'expense', 'transfer')
       or it.book_id is null or it.field is null or it.field not in ('bank_reference', 'date')
       or it.new_value is null then
      raise exception 'Invalid sync item.';
    end if;

    -- lock the entry and read its current value
    v_cur := private.bank_sync_get_value(it.book_kind, it.book_id, it.field);

    -- rule 1: this exact link exists; its line's amount equals the sum of ALL
    -- the entries linked to that line
    select l.* into v_line
    from public.bank_match_links k
    join public.bank_statement_lines l on l.id = k.line_id
    where k.line_id = it.line_id and k.book_kind = it.book_kind and k.book_id = it.book_id;
    if not found then
      raise exception 'Entry % % is not linked to bank line %.', it.book_kind, it.book_id, it.line_id;
    end if;

    select coalesce(sum(case k.book_kind
                          when 'collection' then c.amount
                          when 'expense' then e.amount
                          else t.amount end), 0)
      into v_total
    from public.bank_match_links k
    left join public.collections_basic c on k.book_kind = 'collection' and c.id = k.book_id
    left join public.expenses e on k.book_kind = 'expense' and e.id = k.book_id
    left join public.transfers t on k.book_kind = 'transfer' and t.id = k.book_id
    where k.line_id = v_line.id;

    if v_total <> (coalesce(v_line.deposit, 0) + coalesce(v_line.withdrawal, 0)) then
      raise exception 'Bank line amount does not equal the sum of its linked entries (amount difference).';
    end if;

    -- rule 2: stale protection
    if coalesce(v_cur, '') <> coalesce(it.expected_old, '') then
      raise exception 'Entry changed since the preview, refresh and try again.';
    end if;

    if it.field = 'date' then
      -- rule 3
      if it.book_kind = 'transfer' then
        select count(*) into v_link_count
        from public.bank_match_links k
        where k.book_kind = 'transfer' and k.book_id = it.book_id;
        if v_link_count > 1 then
          raise exception 'Transfer is linked in two accounts; correct its date manually.';
        end if;
      end if;
      if it.new_value !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'New date must be YYYY-MM-DD.';
      end if;
      if it.new_value::date is distinct from v_line.txn_date then
        raise exception 'New date must equal the bank line date.';
      end if;
    else
      -- rule 4
      if it.new_value = '' or char_length(it.new_value) > 500 then
        raise exception 'Bank reference must be 1 to 500 characters.';
      end if;
      v_joined := trim(concat_ws(' ', nullif(v_line.description, ''), nullif(v_line.reference, '')));
      if position(it.new_value in coalesce(v_line.description, '')) = 0
         and position(it.new_value in coalesce(v_line.reference, '')) = 0
         and position(it.new_value in v_joined) = 0 then
        raise exception 'Bank reference must come from the bank line text.';
      end if;
    end if;

    -- rule 5: unchanged -> skip; existing reference without overwrite -> skip
    if coalesce(v_cur, '') = it.new_value then
      continue;
    end if;
    if it.field = 'bank_reference' and coalesce(v_cur, '') <> '' and not coalesce(it.overwrite, false) then
      continue;
    end if;

    perform private.bank_sync_set_value(it.book_kind, it.book_id, it.field, it.new_value);
    insert into public.bank_sync_history (run_id, book_kind, book_id, field, old_value, new_value)
    values (p_run_id, it.book_kind, it.book_id, it.field, v_cur, it.new_value);
    v_changed := v_changed + 1;
  end loop;

  return v_changed;
end;
$$;

create or replace function public.undo_bank_sync(p_run_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  h record;
  v_cur text;
  v_restored integer := 0;
  v_skipped integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can undo a bank sync.';
  end if;
  if p_run_id is null or not exists (select 1 from public.bank_sync_history where run_id = p_run_id) then
    raise exception 'Sync run not found.';
  end if;

  for h in
    select * from public.bank_sync_history
    where run_id = p_run_id and undone_at is null
    order by synced_at desc, id
    for update
  loop
    begin
      v_cur := private.bank_sync_get_value(h.book_kind, h.book_id, h.field);
    exception
      when no_data_found then
        v_skipped := v_skipped + 1; -- the entry was deleted
        update public.bank_sync_history set undone_at = now() where id = h.id;
        continue;
    end;

    if coalesce(v_cur, '') = coalesce(h.new_value, '') then
      -- a date can never be null; a reference may go back to null
      perform private.bank_sync_set_value(h.book_kind, h.book_id, h.field, h.old_value);
      v_restored := v_restored + 1;
    else
      v_skipped := v_skipped + 1; -- changed again since the sync: leave it
    end if;
    update public.bank_sync_history set undone_at = now() where id = h.id;
  end loop;

  return jsonb_build_object('restored', v_restored, 'skipped', v_skipped);
end;
$$;

-- The helpers are no longer part of the API.
drop function if exists public.bank_sync_get_value(text, bigint, text);
drop function if exists public.bank_sync_set_value(text, bigint, text, text);

revoke all on function public.sync_bank_entries(uuid, jsonb) from public, anon;
revoke all on function public.undo_bank_sync(uuid) from public, anon;
grant execute on function public.sync_bank_entries(uuid, jsonb) to authenticated;
grant execute on function public.undo_bank_sync(uuid) to authenticated;

-- ROLLBACK (returns to migration 35's state; fails if any book entry is now
-- linked on two accounts -- unlink one side first):
--   drop trigger if exists bank_match_links_set_account_trg on public.bank_match_links;
--   drop function if exists public.bank_match_links_set_account();
--   alter table public.bank_match_links drop constraint if exists bank_match_links_book_account_key;
--   alter table public.bank_match_links add constraint bank_match_links_book_kind_book_id_key unique (book_kind, book_id);
--   alter table public.bank_match_links drop column if exists account;
--   -- then re-run migration 35 to restore public.bank_sync_get_value /
--   -- public.bank_sync_set_value and the line-less sync_bank_entries, and:
--   drop function if exists private.bank_sync_get_value(text, bigint, text);
--   drop function if exists private.bank_sync_set_value(text, bigint, text, text);
--   drop schema if exists private;  -- only if nothing else lives there
