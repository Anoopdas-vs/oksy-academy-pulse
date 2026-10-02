-- Migration 35: sync bank reference + date correction from the bank statement,
-- with a history that supports undo (RPCs)
--
-- What it does
--   * public.sync_bank_entries(p_run_id, p_items)  -> integer (rows changed)
--       p_items = jsonb array of
--         { "book_kind": 'collection'|'expense'|'transfer', "book_id": bigint,
--           "field": 'bank_reference'|'date', "new_value": text,
--           "expected_old": text, "overwrite": boolean }
--       Edits ONLY collections / expenses / transfers .bank_reference or .date.
--       It never touches amount, student, category, bank lines or links.
--   * public.undo_bank_sync(p_run_id) -> jsonb { "restored": n, "skipped": n }
--   * two small helpers, bank_sync_get_value / bank_sync_set_value, shared by both.
--
-- Rules enforced for every item (all inside ONE transaction, so any raise
-- rolls back the whole run):
--   1. The entry must be linked (bank_match_links) to a bank line, and that
--      line's amount must equal the SUM of ALL its linked entries' amounts
--      (amount diff = 0).
--   2. Stale protection: the current value must equal expected_old (null and
--      '' count as equal), else "Entry changed since the preview, refresh and
--      try again."
--   3. field 'date': new_value must be the line's txn_date (YYYY-MM-DD).
--   4. field 'bank_reference': new_value must be non-empty, at most 500
--      characters, and appear in the line's description, its reference, or the
--      two joined by a space (the way the app writes it). A non-empty current
--      value is replaced ONLY when overwrite is true; otherwise the item is
--      skipped (not an error).
--   5. A new value equal to the current one is skipped. Every real change
--      writes one bank_sync_history row (run_id, old_value, new_value,
--      synced_by = auth.uid()).
-- Undo restores old_value only while the current value still equals the
-- recorded new_value (else the row is counted as skipped and left alone), and
-- stamps undone_at on every row it processed.
--
-- SECURITY INVOKER + set search_path = public, with an explicit is_admin()
-- check first; RLS stays in force. NOTE: authenticated can only SELECT the
-- `id` column of public.collections (migration 06), so collection values are
-- READ through public.collections_basic (which exposes date, amount and
-- bank_reference); the row itself is locked with `select id ... for update`
-- and written with a plain UPDATE.
--
-- Execute is granted to authenticated only (revoked from public and anon).
-- Requires migrations 32-34 (bank_match_links, bank_sync_history).
-- Single-tenant (one academy). Idempotent: CREATE OR REPLACE + re-runnable grants.
-- TODO: fold into schema.sql during Step 16.

-- ── helpers ─────────────────────────────────────────────────────────────

-- Locks the entry's row and returns the current value of `field` as text
-- ('YYYY-MM-DD' for date). Raises no_data_found (P0002) if the entry is gone.
create or replace function public.bank_sync_get_value(p_kind text, p_id bigint, p_field text)
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

-- Writes ONE column of ONE entry (date or bank_reference). Nothing else.
create or replace function public.bank_sync_set_value(p_kind text, p_id bigint, p_field text, p_value text)
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

-- ── sync ────────────────────────────────────────────────────────────────

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
      as x(book_kind text, book_id bigint, field text, new_value text, expected_old text, overwrite boolean)
  loop
    if it.book_kind is null or it.book_kind not in ('collection', 'expense', 'transfer')
       or it.book_id is null or it.field is null or it.field not in ('bank_reference', 'date')
       or it.new_value is null then
      raise exception 'Invalid sync item.';
    end if;

    -- lock the entry and read its current value
    v_cur := public.bank_sync_get_value(it.book_kind, it.book_id, it.field);

    -- rule 1: linked, and the line's amount equals the sum of ALL its linked entries
    select l.* into v_line
    from public.bank_match_links k
    join public.bank_statement_lines l on l.id = k.line_id
    where k.book_kind = it.book_kind and k.book_id = it.book_id;
    if not found then
      raise exception 'Entry % % is not linked to a bank line.', it.book_kind, it.book_id;
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

    perform public.bank_sync_set_value(it.book_kind, it.book_id, it.field, it.new_value);
    insert into public.bank_sync_history (run_id, book_kind, book_id, field, old_value, new_value)
    values (p_run_id, it.book_kind, it.book_id, it.field, v_cur, it.new_value);
    v_changed := v_changed + 1;
  end loop;

  return v_changed;
end;
$$;

-- ── undo ────────────────────────────────────────────────────────────────

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
      v_cur := public.bank_sync_get_value(h.book_kind, h.book_id, h.field);
    exception
      when no_data_found then
        v_skipped := v_skipped + 1; -- the entry was deleted
        update public.bank_sync_history set undone_at = now() where id = h.id;
        continue;
    end;

    if coalesce(v_cur, '') = coalesce(h.new_value, '') then
      -- a date can never be null; a reference may go back to null
      perform public.bank_sync_set_value(h.book_kind, h.book_id, h.field, h.old_value);
      v_restored := v_restored + 1;
    else
      v_skipped := v_skipped + 1; -- changed again since the sync: leave it
    end if;
    update public.bank_sync_history set undone_at = now() where id = h.id;
  end loop;

  return jsonb_build_object('restored', v_restored, 'skipped', v_skipped);
end;
$$;

revoke all on function public.bank_sync_get_value(text, bigint, text) from public, anon;
revoke all on function public.bank_sync_set_value(text, bigint, text, text) from public, anon;
revoke all on function public.sync_bank_entries(uuid, jsonb) from public, anon;
revoke all on function public.undo_bank_sync(uuid) from public, anon;
grant execute on function public.bank_sync_get_value(text, bigint, text) to authenticated;
grant execute on function public.bank_sync_set_value(text, bigint, text, text) to authenticated;
grant execute on function public.sync_bank_entries(uuid, jsonb) to authenticated;
grant execute on function public.undo_bank_sync(uuid) to authenticated;

-- ROLLBACK:
--   drop function if exists public.undo_bank_sync(uuid);
--   drop function if exists public.sync_bank_entries(uuid, jsonb);
--   drop function if exists public.bank_sync_set_value(text, bigint, text, text);
--   drop function if exists public.bank_sync_get_value(text, bigint, text);
