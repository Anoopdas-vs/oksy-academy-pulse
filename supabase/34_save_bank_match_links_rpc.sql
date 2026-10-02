-- Migration 34: atomic save / remove of bank match links (RPCs)
--
-- Background: the app used to save a line's links as several client calls
-- (delete stale, insert new, update the line), which is not atomic. These
-- two functions do the whole change in ONE transaction (a function body is a
-- single transaction), so a unique violation or a bad record leaves nothing
-- half-written.
--
--   * public.save_bank_match_links(p_line_id, p_links, p_source, p_status)
--       p_links = jsonb array of { "book_kind": text, "book_id": bigint,
--                                  "source": text (optional, defaults to p_source) }
--       Replaces the line's links with exactly p_links, then mirrors the
--       FIRST link into bank_statement_lines.match_kind / match_id (legacy
--       columns), and sets status, matched_at = now(), matched_by = auth.uid().
--   * public.remove_bank_match_links(p_line_id, p_status)
--       Deletes every link of the line and clears the mirror columns.
--
-- SECURITY INVOKER: RLS on bank_match_links and bank_statement_lines stays in
-- force. Each function also checks is_admin() first, so a non-admin gets a
-- clear error rather than a silent zero-row result.
-- A book entry already linked to another bank line raises 23505 with the
-- message "This entry is already linked to another bank line."
--
-- Requires migrations 32 and 33. Single-tenant (one academy).
-- Idempotent: CREATE OR REPLACE + re-runnable grants.
-- TODO: fold into schema.sql during Step 16.

create or replace function public.save_bank_match_links(
  p_line_id bigint,
  p_links jsonb,
  p_source text,
  p_status text default 'matched'
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_first_kind text;
  v_first_id bigint;
  v_sources text[] := array['auto_utr', 'auto_exact', 'auto_name', 'auto_group', 'manual', 'backfill'];
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change bank matches.';
  end if;
  if p_status is null or p_status not in ('matched', 'classified', 'ignored', 'unmatched') then
    raise exception 'Invalid status: %', p_status;
  end if;
  if p_source is null or not (p_source = any (v_sources)) then
    raise exception 'Invalid source: %', p_source;
  end if;
  if p_links is null or jsonb_typeof(p_links) <> 'array' or jsonb_array_length(p_links) = 0 then
    raise exception 'At least one book entry is required.';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_links) as x(book_kind text, book_id bigint, source text)
    where x.book_kind is null
       or x.book_kind not in ('collection', 'expense', 'transfer')
       or x.book_id is null
       or (x.source is not null and not (x.source = any (v_sources)))
  ) then
    raise exception 'Invalid link list.';
  end if;

  -- Serialise concurrent edits of the same line.
  perform 1 from public.bank_statement_lines where id = p_line_id for update;
  if not found then
    raise exception 'Bank statement line % not found.', p_line_id;
  end if;

  v_first_kind := p_links -> 0 ->> 'book_kind';
  v_first_id := (p_links -> 0 ->> 'book_id')::bigint;

  -- Drop this line's links that are not in the new list.
  delete from public.bank_match_links l
  where l.line_id = p_line_id
    and not exists (
      select 1
      from jsonb_to_recordset(p_links) as x(book_kind text, book_id bigint, source text)
      where x.book_kind = l.book_kind and x.book_id = l.book_id
    );

  -- Add the missing ones. Links this line already holds are left alone; an
  -- entry held by another line trips unique(book_kind, book_id).
  begin
    insert into public.bank_match_links (line_id, book_kind, book_id, source)
    select p_line_id, x.book_kind, x.book_id, coalesce(x.source, p_source)
    from jsonb_to_recordset(p_links) as x(book_kind text, book_id bigint, source text)
    where not exists (
      select 1 from public.bank_match_links k
      where k.line_id = p_line_id and k.book_kind = x.book_kind and k.book_id = x.book_id
    );
  exception
    when unique_violation then
      raise exception 'This entry is already linked to another bank line.' using errcode = '23505';
  end;

  update public.bank_statement_lines
  set status = p_status,
      match_kind = v_first_kind,
      match_id = v_first_id,
      matched_at = now(),
      matched_by = auth.uid()
  where id = p_line_id;
end;
$$;

create or replace function public.remove_bank_match_links(
  p_line_id bigint,
  p_status text default 'unmatched'
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change bank matches.';
  end if;
  if p_status is null or p_status not in ('matched', 'classified', 'ignored', 'unmatched') then
    raise exception 'Invalid status: %', p_status;
  end if;

  perform 1 from public.bank_statement_lines where id = p_line_id for update;
  if not found then
    raise exception 'Bank statement line % not found.', p_line_id;
  end if;

  delete from public.bank_match_links where line_id = p_line_id;

  update public.bank_statement_lines
  set status = p_status,
      match_kind = null,
      match_id = null,
      matched_at = null,
      matched_by = null
  where id = p_line_id;
end;
$$;

revoke all on function public.save_bank_match_links(bigint, jsonb, text, text) from public, anon;
revoke all on function public.remove_bank_match_links(bigint, text) from public, anon;
grant execute on function public.save_bank_match_links(bigint, jsonb, text, text) to authenticated;
grant execute on function public.remove_bank_match_links(bigint, text) to authenticated;

-- ROLLBACK:
--   drop function if exists public.save_bank_match_links(bigint, jsonb, text, text);
--   drop function if exists public.remove_bank_match_links(bigint, text);
