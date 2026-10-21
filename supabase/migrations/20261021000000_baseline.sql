-- ============================================================================
-- BASELINE: Oksy Academy Pulse production schema as of 2026-10-21
-- (after Phase 1 migrations 40-48 and Phase 2 step 0 migration 49).
-- Generated read-only with: supabase db dump --linked --schema public
-- plus the pieces pg_dump of `public` does not include (section B below).
-- This file replaces legacy supabase/00..49_*.sql as the starting point.
-- Production and staging already contain this state: mark it applied there with
--   supabase migration repair --status applied 20261021000000
-- (needs owner approval) - never run it against a populated database.
-- ============================================================================

-- ---------------------------------------------------------------- A. public



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."allocate_student_id"("p_code" "text") RETURNS "text"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if p_code is null or btrim(p_code) = '' then
    raise exception 'A course code is required to allocate a Student ID.';
  end if;
  perform public.lock_student_id_prefix(p_code);
  return public.format_student_id(p_code, public.student_id_next_number(p_code));
end;
$$;


ALTER FUNCTION "public"."allocate_student_id"("p_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assignment_submissions_no_self_grade"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.uid() is not null and not public.is_staff_or_admin() then
    new.marks     := null;
    new.feedback  := null;
    new.status    := 'submitted';
    new.graded_by := null;
    new.graded_at := null;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."assignment_submissions_no_self_grade"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bank_match_links_check_book"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."bank_match_links_check_book"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bank_match_links_cleanup_book"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."bank_match_links_cleanup_book"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bank_match_links_set_account"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."bank_match_links_set_account"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."batch_status_data_issues"() RETURNS TABLE("batch" "text", "start_date" "date", "end_date" "date", "students" bigint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not (public.is_admin() or (session_user = 'postgres' and auth.uid() is null)) then
    raise exception 'Only the Owner or an Admin can view batch date issues.'
      using errcode = '42501';
  end if;

  return query
    select b.name, b.start_date, b.end_date,
           (select count(*) from public.students s where s.batch = b.name)
    from public.batches b
    where b.end_date < b.start_date
    order by b.name;
end;
$$;


ALTER FUNCTION "public"."batch_status_data_issues"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."batch_status_for"("p_status" "text", "p_start" "date", "p_end" "date", "p_today" "date") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  select case
    when p_status = 'Dropped'                       then p_status
    when p_start is null                            then p_status
    when p_end is not null and p_end < p_start      then p_status
    when p_end is null and p_status = 'Completed'   then p_status
    when p_end is not null and p_today >= p_end     then 'Completed'
    when p_today < p_start                          then 'Registered'
    else 'Active'
  end
$$;


ALTER FUNCTION "public"."batch_status_for"("p_status" "text", "p_start" "date", "p_end" "date", "p_today" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."batch_status_targets"("p_today" "date") RETURNS TABLE("student_id" "text", "student_name" "text", "batch" "text", "old_status" "text", "new_status" "text", "batch_start" "date", "batch_end" "date")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select s.id, s.name, s.batch, s.status, f.new_status, b.start_date, b.end_date
  from public.students s
  join public.batches b on b.name = s.batch
  cross join lateral (
    select public.batch_status_for(s.status, b.start_date, b.end_date, p_today) as new_status
  ) f
  where f.new_status is distinct from s.status
  order by s.batch, s.id;
$$;


ALTER FUNCTION "public"."batch_status_targets"("p_today" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."batches_fee_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  if new.course_fee is distinct from old.course_fee
     or new.registration_fee is distinct from old.registration_fee
     or new.exam_fee is distinct from old.exam_fee then
    raise exception 'Only the Owner or an Admin can change batch fee amounts.' using errcode = '42501';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."batches_fee_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."batches_resync_students"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_today date := public.ist_today();
  v_changes jsonb;
  v_n int;
begin
  with u as (
    update public.students s
       set status = public.batch_status_for(s.status, new.start_date, new.end_date, v_today),
           updated_at = now(), updated_by = v_uid
     where s.batch = new.name
       and public.batch_status_for(s.status, new.start_date, new.end_date, v_today)
           is distinct from s.status
    returning s.id, s.status as new_status
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'to', new_status) order by id), '[]'::jsonb),
         count(*)
    into v_changes, v_n
    from u;

  if v_n > 0 then
    insert into public.audit_log (table_name, row_id, action, old_row, new_row, changed_by)
    values ('students', 0, 'update', null,
            jsonb_build_object('batch_status_automation', true, 'source', 'batch_trigger',
                               'run_date_ist', v_today, 'batch', new.name,
                               'old_start', old.start_date, 'new_start', new.start_date,
                               'old_end', old.end_date, 'new_end', new.end_date,
                               'total', v_n, 'changes', v_changes),
            v_uid);
  end if;
  return null;
end;
$$;


ALTER FUNCTION "public"."batches_resync_students"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bulk_upsert_students"("p_rows" "jsonb", "p_dry_run" boolean DEFAULT true, "p_confirm_blanks" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  c_max_rows constant int := 2000;
  v_uid uuid := auth.uid();
  v_n int;
  v_i int;
  r jsonb;
  s public.students;
  v_code text;
  v_lock_code text;
  v_rownum int;
  v_key text;
  v_digits text;
  v_is_new boolean;
  v_errs text[];
  v_warns text[];
  v_blanks int;
  v_changed boolean;
  -- normalised values
  n_id text; n_name text; n_course text; n_batch text; n_status text;
  n_sphone text; n_semail text; n_pname text; n_pphone text; n_place text; n_addr text;
  n_reg numeric; n_cfee numeric; n_efee numeric; n_ofee numeric; n_waiver numeric;
  v_txt text;
  v_action text;
  -- results
  key_counts jsonb := '{}'::jsonb;
  out_rows jsonb := '[]'::jsonb;
  ops jsonb := '[]'::jsonb;
  op jsonb;
  c_updates int := 0;
  c_new int := 0;
  c_unchanged int := 0;
  c_errors int := 0;
  c_warnings int := 0;
  c_blanks int := 0;
  v_ins_ids text[] := '{}';
  v_upd_ids text[] := '{}';
begin
  -- 1. Authorization — first, before touching the payload.
  if not public.is_admin() then
    raise exception 'Only the Owner or an Admin can upload student data.'
      using errcode = '42501';
  end if;

  -- 2. Payload shape.
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array of student rows.';
  end if;
  v_n := jsonb_array_length(p_rows);
  if v_n = 0 then
    raise exception 'The upload has no rows.';
  end if;
  if v_n > c_max_rows then
    raise exception 'An upload can have at most % rows (this one has %).', c_max_rows, v_n;
  end if;

  -- 3. Apply mode: serialize with enroll_student() per course prefix, in
  --    sorted order (no deadlocks), before anything is read.
  if not coalesce(p_dry_run, true) then
    for v_lock_code in
      select distinct c.code
      from (select distinct nullif(btrim(x->>'batch'), '') as bname
            from jsonb_array_elements(p_rows) x) rb
      join public.batches b on b.name = rb.bname
      join public.courses c on btrim(c.name) = btrim(coalesce(b.course_name, ''))
      where c.code is not null
      order by 1
    loop
      perform public.lock_student_id_prefix(v_lock_code);
    end loop;
  end if;

  -- 4. Count IDs so duplicates inside the file can be flagged on every row.
  for v_i in 0 .. v_n - 1 loop
    r := p_rows -> v_i;
    if jsonb_typeof(r) = 'object' then
      v_key := upper(btrim(coalesce(r->>'id', '')));
      if v_key <> '' then
        key_counts := jsonb_set(key_counts, array[v_key],
                                to_jsonb(coalesce((key_counts->>v_key)::int, 0) + 1));
      end if;
    end if;
  end loop;

  -- 5. Validate + classify every row.
  for v_i in 0 .. v_n - 1 loop
    r := p_rows -> v_i;
    v_errs := '{}'; v_warns := '{}'; v_blanks := 0; v_changed := false;
    v_action := 'error';
    v_is_new := false;
    s := null;
    v_code := null;

    if jsonb_typeof(r) <> 'object' then
      out_rows := out_rows || jsonb_build_object('row', v_i + 2, 'id', null,
        'action', 'error', 'errors', jsonb_build_array('Row is not a valid record.'),
        'warnings', '[]'::jsonb);
      c_errors := c_errors + 1;
      continue;
    end if;

    v_rownum := case when (r->>'row') ~ '^[0-9]{1,6}$' then (r->>'row')::int else v_i + 2 end;

    n_id     := nullif(btrim(r->>'id'), '');
    n_name   := nullif(btrim(r->>'name'), '');
    n_course := nullif(btrim(r->>'course'), '');
    n_batch  := nullif(btrim(r->>'batch'), '');
    n_status := nullif(btrim(r->>'status'), '');
    n_sphone := nullif(btrim(r->>'student_phone'), '');
    n_semail := nullif(btrim(r->>'student_email'), '');
    n_pname  := nullif(btrim(r->>'parent_name'), '');
    n_pphone := nullif(btrim(r->>'parent_phone'), '');
    n_place  := nullif(btrim(r->>'place'), '');
    n_addr   := nullif(btrim(r->>'address'), '');

    -- ---- field validation (mirrors the table CHECKs + length limits) ----
    if n_id is null then
      v_errs := v_errs || 'Student ID is required.'::text;
    else
      v_key := upper(n_id);
      if length(v_key) > 20 or v_key !~ '^[A-Z0-9]+$' then
        v_errs := v_errs || 'Student ID must be letters and digits only (max 20 characters).'::text;
      end if;
      if coalesce((key_counts->>v_key)::int, 0) > 1 then
        v_errs := v_errs || 'Duplicate Student ID: it appears more than once in the file.'::text;
      end if;
    end if;

    if n_name is null then v_errs := v_errs || 'Name is required.'::text;
    elsif length(n_name) > 100 then v_errs := v_errs || 'Name is longer than 100 characters.'::text; end if;
    if length(coalesce(n_course, '')) > 100 then v_errs := v_errs || 'Course is longer than 100 characters.'::text; end if;
    if length(coalesce(n_pname, '')) > 100 then v_errs := v_errs || 'Parent Name is longer than 100 characters.'::text; end if;
    if length(coalesce(n_place, '')) > 100 then v_errs := v_errs || 'Place is longer than 100 characters.'::text; end if;
    if length(coalesce(n_addr, '')) > 300 then v_errs := v_errs || 'Address is longer than 300 characters.'::text; end if;
    if n_sphone is not null and n_sphone !~ '^[0-9]{10}$' then
      v_errs := v_errs || 'Student Phone must be exactly 10 digits.'::text; end if;
    if n_pphone is not null and n_pphone !~ '^[0-9]{10}$' then
      v_errs := v_errs || 'Parent Phone must be exactly 10 digits.'::text; end if;
    if n_semail is not null and (length(n_semail) > 254
       or n_semail !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
      v_errs := v_errs || 'Student Email is not a valid e-mail address.'::text; end if;

    -- fees: blank = 0; else non-negative, at most 2 decimals
    n_reg := 0; n_cfee := 0; n_efee := 0; n_ofee := 0; n_waiver := 0;
    for v_txt in select unnest(array['registration_fee', 'course_fee', 'exam_fee', 'other_fee', 'waiver']) loop
      if nullif(btrim(coalesce(r->>v_txt, '')), '') is not null
         and btrim(r->>v_txt) !~ '^[0-9]{1,9}(\.[0-9]{1,2})?$' then
        v_errs := v_errs || (initcap(replace(v_txt, '_', ' ')) || ' must be a number of 0 or more (max 2 decimals).');
      end if;
    end loop;
    if not exists (select 1 from unnest(v_errs) e where e like '%must be a number%') then
      n_reg    := coalesce(nullif(btrim(r->>'registration_fee'), '')::numeric, 0);
      n_cfee   := coalesce(nullif(btrim(r->>'course_fee'), '')::numeric, 0);
      n_efee   := coalesce(nullif(btrim(r->>'exam_fee'), '')::numeric, 0);
      n_ofee   := coalesce(nullif(btrim(r->>'other_fee'), '')::numeric, 0);
      n_waiver := coalesce(nullif(btrim(r->>'waiver'), '')::numeric, 0);
    end if;

    -- ---- update or new? ----
    if n_id is not null and v_key ~ '^[A-Z0-9]+$' then
      if coalesce(p_dry_run, true) then
        select * into s from public.students where upper(btrim(id)) = v_key;
      else
        select * into s from public.students where upper(btrim(id)) = v_key for update;
      end if;
      v_is_new := not found;
    end if;

    if n_id is not null and not v_is_new and s.id is not null then
      -- ============ UPDATE of an existing student ============
      -- Immutable: id, status, batch. Differences are reported and ignored.
      if n_batch is not null and n_batch is distinct from btrim(coalesce(s.batch, '')) then
        v_warns := v_warns || format('Batch "%s" ignored — uploads cannot change a batch (stays "%s").', n_batch, coalesce(s.batch, ''));
      end if;
      if n_status is not null and n_status is distinct from s.status then
        v_warns := v_warns || format('Status "%s" ignored — uploads cannot change a status (stays "%s").', n_status, s.status);
      end if;

      -- blank cells that would clear a stored value
      if n_course is null and s.course is not null then v_blanks := v_blanks + 1; v_warns := v_warns || format('Course is blank — will clear "%s".', s.course); end if;
      if n_sphone is null and s.student_phone is not null then v_blanks := v_blanks + 1; v_warns := v_warns || format('Student Phone is blank — will clear "%s".', s.student_phone); end if;
      if n_semail is null and s.student_email is not null then v_blanks := v_blanks + 1; v_warns := v_warns || format('Student Email is blank — will clear "%s".', s.student_email); end if;
      if n_pname is null and s.parent_name is not null then v_blanks := v_blanks + 1; v_warns := v_warns || format('Parent Name is blank — will clear "%s".', s.parent_name); end if;
      if n_pphone is null and s.parent_phone is not null then v_blanks := v_blanks + 1; v_warns := v_warns || format('Parent Phone is blank — will clear "%s".', s.parent_phone); end if;
      if n_place is null and s.place is not null then v_blanks := v_blanks + 1; v_warns := v_warns || format('Place is blank — will clear "%s".', s.place); end if;
      if n_addr is null and s.address is not null then v_blanks := v_blanks + 1; v_warns := v_warns || 'Address is blank — will clear the stored address.'::text; end if;
      if nullif(btrim(coalesce(r->>'registration_fee', '')), '') is null and s.registration_fee <> 0 then v_blanks := v_blanks + 1; v_warns := v_warns || format('Registration Fee is blank — will reset %s to 0.', s.registration_fee); end if;
      if nullif(btrim(coalesce(r->>'course_fee', '')), '') is null and s.course_fee <> 0 then v_blanks := v_blanks + 1; v_warns := v_warns || format('Course Fee is blank — will reset %s to 0.', s.course_fee); end if;
      if nullif(btrim(coalesce(r->>'exam_fee', '')), '') is null and s.exam_fee <> 0 then v_blanks := v_blanks + 1; v_warns := v_warns || format('Exam Fee is blank — will reset %s to 0.', s.exam_fee); end if;
      if nullif(btrim(coalesce(r->>'other_fee', '')), '') is null and s.other_fee <> 0 then v_blanks := v_blanks + 1; v_warns := v_warns || format('Other Fee is blank — will reset %s to 0.', s.other_fee); end if;
      if nullif(btrim(coalesce(r->>'waiver', '')), '') is null and s.waiver <> 0 then v_blanks := v_blanks + 1; v_warns := v_warns || format('Waiver is blank — will reset %s to 0.', s.waiver); end if;

      v_changed :=
           n_name    is distinct from s.name
        or n_course  is distinct from s.course
        or n_sphone  is distinct from s.student_phone
        or n_semail  is distinct from s.student_email
        or n_pname   is distinct from s.parent_name
        or n_pphone  is distinct from s.parent_phone
        or n_place   is distinct from s.place
        or n_addr    is distinct from s.address
        or n_reg     is distinct from s.registration_fee
        or n_cfee    is distinct from s.course_fee
        or n_efee    is distinct from s.exam_fee
        or n_ofee    is distinct from s.other_fee
        or n_waiver  is distinct from s.waiver;
      v_action := case when v_changed then 'update' else 'unchanged' end;
    elsif n_id is not null and v_is_new then
      -- ============ NEW student with a manual ID ============
      if n_batch is null then
        v_errs := v_errs || 'Batch is required for a new student.'::text;
      else
        begin
          v_code := public.student_id_prefix_for_batch(n_batch);
        exception when others then
          v_errs := v_errs || sqlerrm;
        end;
      end if;
      if v_code is not null and v_key ~ '^[A-Z0-9]+$' then
        if left(v_key, length(v_code)) is distinct from upper(v_code) then
          v_errs := v_errs || format('Student ID must start with "%s" for the course of batch "%s".', upper(v_code), n_batch);
        else
          v_digits := substr(v_key, length(v_code) + 1);
          if v_digits !~ '^([0-9]{3}|[1-9][0-9]{3,8})$' then
            v_errs := v_errs || format('Student ID must be "%s" + a number of at least 3 digits, no leading zeros beyond that (e.g. %s).', upper(v_code), public.format_student_id(upper(v_code), 5));
          end if;
        end if;
      end if;
      if n_status is not null and n_status <> 'Registered' then
        v_warns := v_warns || format('Status "%s" ignored — new students start as "Registered".', n_status);
      end if;
      if n_course is null and n_batch is not null then
        select b.course_name into n_course from public.batches b where b.name = n_batch;
      end if;
      v_action := 'new';
    end if;

    if array_length(v_errs, 1) > 0 then
      v_action := 'error';
    end if;

    -- tallies
    c_warnings := c_warnings + coalesce(array_length(v_warns, 1), 0);
    c_blanks := c_blanks + v_blanks;
    if v_action = 'error' then c_errors := c_errors + 1;
    elsif v_action = 'new' then c_new := c_new + 1;
    elsif v_action = 'update' then c_updates := c_updates + 1;
    else c_unchanged := c_unchanged + 1; end if;

    out_rows := out_rows || jsonb_build_object(
      'row', v_rownum,
      'id', case when s.id is not null then s.id else upper(n_id) end,
      'action', v_action,
      'errors', to_jsonb(v_errs),
      'warnings', to_jsonb(v_warns));

    if v_action in ('new', 'update') then
      ops := ops || jsonb_build_object(
        'action', v_action,
        'id', case when v_action = 'update' then s.id else upper(n_id) end,
        'batch', n_batch, 'name', n_name, 'course', n_course,
        'student_phone', n_sphone, 'student_email', n_semail,
        'parent_name', n_pname, 'parent_phone', n_pphone,
        'place', n_place, 'address', n_addr,
        'registration_fee', n_reg, 'course_fee', n_cfee, 'exam_fee', n_efee,
        'other_fee', n_ofee, 'waiver', n_waiver);
    end if;
  end loop;

  -- 6. Apply (all-or-nothing: any raise below rolls back the whole call).
  if not coalesce(p_dry_run, true) then
    if c_errors > 0 then
      raise exception '% row(s) have errors; nothing was saved. Fix the file and try again.', c_errors;
    end if;
    if c_blanks > 0 and not coalesce(p_confirm_blanks, false) then
      raise exception '% blank cell(s) would clear existing values; confirm the overwrite to continue.', c_blanks;
    end if;

    for op in select * from jsonb_array_elements(ops) loop
      if op->>'action' = 'new' then
        insert into public.students (
          id, batch, name, course,
          registration_fee, course_fee, exam_fee, other_fee, waiver,
          status, enrollment_date,
          student_phone, student_email, parent_name, parent_phone, place, address,
          created_by, updated_by
        ) values (
          op->>'id', op->>'batch', op->>'name', op->>'course',
          (op->>'registration_fee')::numeric, (op->>'course_fee')::numeric,
          (op->>'exam_fee')::numeric, (op->>'other_fee')::numeric, (op->>'waiver')::numeric,
          'Registered', current_date,
          op->>'student_phone', op->>'student_email', op->>'parent_name',
          op->>'parent_phone', op->>'place', op->>'address',
          v_uid, v_uid
        );
        v_ins_ids := v_ins_ids || (op->>'id');
      else
        -- id, batch and status are deliberately absent from this SET list.
        update public.students set
          name = op->>'name',
          course = op->>'course',
          student_phone = op->>'student_phone',
          student_email = op->>'student_email',
          parent_name = op->>'parent_name',
          parent_phone = op->>'parent_phone',
          place = op->>'place',
          address = op->>'address',
          registration_fee = (op->>'registration_fee')::numeric,
          course_fee = (op->>'course_fee')::numeric,
          exam_fee = (op->>'exam_fee')::numeric,
          other_fee = (op->>'other_fee')::numeric,
          waiver = (op->>'waiver')::numeric,
          updated_at = now(),
          updated_by = v_uid
        where id = op->>'id';
        v_upd_ids := v_upd_ids || (op->>'id');
      end if;
    end loop;

    if c_new + c_updates > 0 then
      insert into public.audit_log (table_name, row_id, action, old_row, new_row, changed_by)
      values ('students', 0, 'update', null,
              jsonb_build_object('bulk_upload', true, 'inserted', to_jsonb(v_ins_ids), 'updated', to_jsonb(v_upd_ids)),
              v_uid);
    end if;
  end if;

  return jsonb_build_object(
    'dry_run', coalesce(p_dry_run, true),
    'updates', c_updates,
    'new', c_new,
    'unchanged', c_unchanged,
    'errors', c_errors,
    'warnings', c_warnings,
    'blank_overwrites', c_blanks,
    'rows', out_rows);
end;
$_$;


ALTER FUNCTION "public"."bulk_upsert_students"("p_rows" "jsonb", "p_dry_run" boolean, "p_confirm_blanks" boolean) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "batch_name" "text" NOT NULL,
    "faculty_id" "uuid",
    "title" "text" NOT NULL,
    "description" "text",
    "max_marks" integer DEFAULT 100 NOT NULL,
    "due_date" "date",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "published_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "assignments_max_marks_check" CHECK (("max_marks" > 0)),
    CONSTRAINT "assignments_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'published'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."assignments" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_manage_assignment"("a" "public"."assignments") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select public.is_staff_or_admin()
      or a.created_by = auth.uid()
      or public.teaches_batch(a.batch_name);
$$;


ALTER FUNCTION "public"."can_manage_assignment"("a" "public"."assignments") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."exams" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "batch_name" "text" NOT NULL,
    "title" "text" NOT NULL,
    "duration_minutes" integer DEFAULT 30 NOT NULL,
    "passing_score" integer DEFAULT 50 NOT NULL,
    "opens_at" timestamp with time zone,
    "closes_at" timestamp with time zone,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "results_released" boolean DEFAULT false NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "exams_duration_minutes_check" CHECK (("duration_minutes" > 0)),
    CONSTRAINT "exams_passing_score_check" CHECK ((("passing_score" >= 0) AND ("passing_score" <= 100))),
    CONSTRAINT "exams_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'published'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."exams" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_manage_exam"("e" "public"."exams") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select public.is_staff_or_admin()
      or e.created_by = auth.uid()
      or public.teaches_batch(e.batch_name);
$$;


ALTER FUNCTION "public"."can_manage_exam"("e" "public"."exams") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_view_financials"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
                              select coalesce(
                                  (select is_approved and (role = 'admin' or can_view_financials)
                                       from public.profiles where id = auth.uid()),
                                           false
                                             );
                                             $$;


ALTER FUNCTION "public"."can_view_financials"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."clear_my_must_change_password"() RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  update public.profiles set must_change_password = false where id = auth.uid();
$$;


ALTER FUNCTION "public"."clear_my_must_change_password"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_mistaken_student"("p_id" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  s public.students;
  v_blockers text[] := '{}';
begin
  if not public.is_admin() then
    raise exception 'Only the Owner or an Admin can delete a student record.'
      using errcode = '42501';
  end if;
  select * into s from public.students where id = p_id for update;
  if not found then
    raise exception 'Student "%" was not found.', p_id;
  end if;
  if exists (select 1 from public.collections c where c.student_id = s.id) then
    v_blockers := v_blockers || 'fee receipts (delete the receipts first)'::text;
  end if;
  if exists (select 1 from public.profiles p where p.student_ref = s.id) then
    v_blockers := v_blockers || 'a linked student login (attendance, exams, assignments, reviews)'::text;
  end if;
  if array_length(v_blockers, 1) > 0 then
    raise exception 'Student % cannot be deleted because it has %. Set the status to Dropped instead.',
      s.id, array_to_string(v_blockers, ', ');
  end if;
  insert into public.audit_log (table_name, row_id, action, old_row, new_row, changed_by)
  values ('students', 0, 'delete', to_jsonb(s), null, auth.uid());
  delete from public.students where id = s.id;
end;
$$;


ALTER FUNCTION "public"."delete_mistaken_student"("p_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_batch_name_rule"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $_$
begin
  if (tg_op = 'INSERT' or new.name is distinct from old.name)
     and new.name !~ '^[A-Z0-9/&.()_-]+( [A-Z0-9/&.()_-]+)*$' then
    raise exception 'Batch name may use only capital letters, digits, single spaces between words, and - / & . ( ) _ (no lowercase, no leading or trailing space).'
      using errcode = 'check_violation', constraint = 'batches_name_format';
  end if;
  return new;
end;
$_$;


ALTER FUNCTION "public"."enforce_batch_name_rule"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enroll_student"("p_student" "jsonb") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_batch text := nullif(btrim(p_student->>'batch'), '');
  v_name text := nullif(btrim(p_student->>'name'), '');
  v_code text;
  v_id text;
begin
  if not public.is_staff_or_admin() then
    raise exception 'Only Owner, Admin or Executive logins can enrol students.'
      using errcode = '42501';
  end if;
  if v_name is null then
    raise exception 'Student name is required.';
  end if;

  v_code := public.student_id_prefix_for_batch(v_batch);
  v_id := public.allocate_student_id(v_code);

  insert into public.students (
    id, batch, name, course,
    registration_fee, course_fee, exam_fee, other_fee, waiver,
    status, enrollment_date,
    student_phone, student_email, parent_name, parent_phone,
    guardian_relation, place, address, date_of_birth, lead_source,
    created_by, updated_by
  ) values (
    v_id, v_batch, v_name,
    coalesce(nullif(btrim(p_student->>'course'), ''),
             (select b.course_name from public.batches b where b.name = v_batch)),
    coalesce(nullif(p_student->>'registration_fee', '')::numeric, 0),
    coalesce(nullif(p_student->>'course_fee', '')::numeric, 0),
    coalesce(nullif(p_student->>'exam_fee', '')::numeric, 0),
    coalesce(nullif(p_student->>'other_fee', '')::numeric, 0),
    coalesce(nullif(p_student->>'waiver', '')::numeric, 0),
    coalesce(nullif(p_student->>'status', ''), 'Registered'),
    nullif(p_student->>'enrollment_date', '')::date,
    nullif(btrim(p_student->>'student_phone'), ''),
    nullif(btrim(p_student->>'student_email'), ''),
    nullif(btrim(p_student->>'parent_name'), ''),
    nullif(btrim(p_student->>'parent_phone'), ''),
    nullif(btrim(p_student->>'guardian_relation'), ''),
    nullif(btrim(p_student->>'place'), ''),
    nullif(btrim(p_student->>'address'), ''),
    nullif(p_student->>'date_of_birth', '')::date,
    nullif(btrim(p_student->>'lead_source'), ''),
    auth.uid(), auth.uid()
  );

  return v_id;
end;
$$;


ALTER FUNCTION "public"."enroll_student"("p_student" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."exam_attempts_no_forged_result"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.uid() is not null and not public.is_staff_or_admin() then
    new.submitted_at := null;
    new.score        := null;
    new.total        := null;
    new.percentage   := null;
    new.passed       := null;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."exam_attempts_no_forged_result"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."format_student_id"("p_code" "text", "p_number" numeric) RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  select p_code || case
    when length(p_number::text) < 3 then lpad(p_number::text, 3, '0')
    else p_number::text
  end;
$$;


ALTER FUNCTION "public"."format_student_id"("p_code" "text", "p_number" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
                                             begin
                                               insert into public.profiles (id, email, full_name)
                                                 values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
                                                   return new;
                                                   end;
                                                   $$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(
    (select role in ('admin', 'super_admin') and is_approved
     from public.profiles where id = auth.uid()),
    false
  );
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_approved_user"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
                            select coalesce((select is_approved from public.profiles where id = auth.uid()), false);
                            $$;


ALTER FUNCTION "public"."is_approved_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_staff_or_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(
    (select is_approved and role in ('super_admin', 'admin', 'staff')
     from public.profiles where id = auth.uid()),
    false
  );
$$;


ALTER FUNCTION "public"."is_staff_or_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_super_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(
    (select role = 'super_admin' and is_approved
     from public.profiles where id = auth.uid()),
    false
  );
$$;


ALTER FUNCTION "public"."is_super_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ist_today"() RETURNS "date"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$ select (now() at time zone 'Asia/Kolkata')::date $$;


ALTER FUNCTION "public"."ist_today"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lock_student_id_prefix"("p_code" "text") RETURNS "void"
    LANGUAGE "sql"
    SET "search_path" TO 'public'
    AS $$
  select pg_advisory_xact_lock(hashtext('public.students.id'), hashtext(p_code));
$$;


ALTER FUNCTION "public"."lock_student_id_prefix"("p_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_financial_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if (tg_op = 'UPDATE') then
    insert into public.audit_log (table_name, row_id, action, old_row, new_row, changed_by)
    values (tg_table_name, new.id, 'update', to_jsonb(old), to_jsonb(new), auth.uid());
    return new;
  elsif (tg_op = 'DELETE') then
    insert into public.audit_log (table_name, row_id, action, old_row, new_row, changed_by)
    values (tg_table_name, old.id, 'delete', to_jsonb(old), null, auth.uid());
    return old;
  end if;
  return null;
end;
$$;


ALTER FUNCTION "public"."log_financial_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_batch"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select batch_name from public.profiles where id = auth.uid();
$$;


ALTER FUNCTION "public"."my_batch"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_student_ref"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select student_ref from public.profiles
  where id = auth.uid() and is_approved;
$$;


ALTER FUNCTION "public"."my_student_ref"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_batch"("p_batch" "text", "p_type" "text", "p_title" "text", "p_body" "text", "p_link" "text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare n integer;
begin
  if not (public.is_staff_or_admin()
          or (public.is_approved_user() and public.teaches_batch(p_batch))) then
    raise exception 'Not allowed to notify this batch.' using errcode = '42501';
  end if;

  insert into public.notifications (recipient_id, type, title, body, link_tab)
  select id, p_type, p_title, p_body, p_link
  from public.profiles
  where batch_name = p_batch and is_approved and role in ('student','professional');
  get diagnostics n = row_count;
  return n;
end;
$$;


ALTER FUNCTION "public"."notify_batch"("p_batch" "text", "p_type" "text", "p_title" "text", "p_body" "text", "p_link" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."preview_batch_status_changes"("p_as_of" "date" DEFAULT NULL::"date") RETURNS TABLE("student_id" "text", "student_name" "text", "batch" "text", "old_status" "text", "new_status" "text", "batch_start" "date", "batch_end" "date", "is_revert" boolean)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not (public.is_admin() or (session_user = 'postgres' and auth.uid() is null)) then
    raise exception 'Only the Owner or an Admin can preview automatic status changes.'
      using errcode = '42501';
  end if;

  return query
    select t.student_id, t.student_name, t.batch, t.old_status, t.new_status,
           t.batch_start, t.batch_end,
           (case t.new_status when 'Registered' then 1 when 'Active' then 2 else 3 end)
             < (case t.old_status when 'Registered' then 1 when 'Active' then 2 else 3 end)
    from public.batch_status_targets(coalesce(p_as_of, public.ist_today())) t;
end;
$$;


ALTER FUNCTION "public"."preview_batch_status_changes"("p_as_of" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."preview_student_id"("p_batch" "text") RETURNS "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_code text;
begin
  if not public.is_staff_or_admin() then
    raise exception 'Only Owner, Admin or Executive logins can enrol students.'
      using errcode = '42501';
  end if;
  v_code := public.student_id_prefix_for_batch(p_batch);
  return public.format_student_id(v_code, public.student_id_next_number(v_code));
end;
$$;


ALTER FUNCTION "public"."preview_student_id"("p_batch" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."remove_bank_match_links"("p_line_id" bigint, "p_status" "text" DEFAULT 'unmatched'::"text") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."remove_bank_match_links"("p_line_id" bigint, "p_status" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."assignment_submissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "assignment_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "link" "text",
    "notes" "text",
    "submitted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_late" boolean DEFAULT false NOT NULL,
    "marks" integer,
    "feedback" "text",
    "status" "text" DEFAULT 'submitted'::"text" NOT NULL,
    "graded_by" "uuid",
    "graded_at" timestamp with time zone,
    "file_path" "text",
    CONSTRAINT "assignment_submissions_status_check" CHECK (("status" = ANY (ARRAY['submitted'::"text", 'graded'::"text", 'returned'::"text"])))
);


ALTER TABLE "public"."assignment_submissions" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resubmit_assignment"("p_assignment_id" "uuid", "p_link" "text", "p_notes" "text", "p_file_path" "text", "p_is_late" boolean) RETURNS "public"."assignment_submissions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  r public.assignment_submissions;
begin
  update public.assignment_submissions
     set link = p_link,
         notes = p_notes,
         file_path = p_file_path,
         is_late = p_is_late,
         submitted_at = now()
   where assignment_id = p_assignment_id
     and student_id = auth.uid()
     and status = 'submitted'
  returning * into r;

  if r is null then
    raise exception 'no editable submission found (already graded, or none exists)';
  end if;

  return r;
end;
$$;


ALTER FUNCTION "public"."resubmit_assignment"("p_assignment_id" "uuid", "p_link" "text", "p_notes" "text", "p_file_path" "text", "p_is_late" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."run_batch_status_automation"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_today date := public.ist_today();
  v_changes jsonb;
  v_reg int; v_act int; v_comp int;
begin
  if not (public.is_admin() or (session_user = 'postgres' and v_uid is null)) then
    raise exception 'Only the Owner or an Admin can run automatic status changes.'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('run_batch_status_automation'));

  with t as (
    select * from public.batch_status_targets(v_today)
  ), u as (
    update public.students s
       set status = t.new_status, updated_at = now(), updated_by = v_uid
      from t
     where s.id = t.student_id and s.status = t.old_status
    returning s.id, t.batch, t.old_status, t.new_status
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'batch', batch, 'from', old_status, 'to', new_status) order by batch, id), '[]'::jsonb),
         count(*) filter (where new_status = 'Registered'),
         count(*) filter (where new_status = 'Active'),
         count(*) filter (where new_status = 'Completed')
    into v_changes, v_reg, v_act, v_comp
    from u;

  if v_reg + v_act + v_comp > 0 then
    insert into public.audit_log (table_name, row_id, action, old_row, new_row, changed_by)
    values ('students', 0, 'update', null,
            jsonb_build_object('batch_status_automation', true, 'source', 'run',
                               'run_date_ist', v_today,
                               'to_registered', v_reg, 'to_active', v_act, 'to_completed', v_comp,
                               'changes', v_changes),
            v_uid);
  end if;

  return jsonb_build_object('run_date', v_today,
                            'to_registered', v_reg, 'to_active', v_act, 'to_completed', v_comp,
                            'total', v_reg + v_act + v_comp);
end;
$$;


ALTER FUNCTION "public"."run_batch_status_automation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_bank_match_links"("p_line_id" bigint, "p_links" "jsonb", "p_source" "text", "p_status" "text" DEFAULT 'matched'::"text") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
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

  perform 1 from public.bank_statement_lines where id = p_line_id for update;
  if not found then
    raise exception 'Bank statement line % not found.', p_line_id;
  end if;

  v_first_kind := p_links -> 0 ->> 'book_kind';
  v_first_id := (p_links -> 0 ->> 'book_id')::bigint;

  delete from public.bank_match_links l
  where l.line_id = p_line_id
    and not exists (
      select 1
      from jsonb_to_recordset(p_links) as x(book_kind text, book_id bigint, source text)
      where x.book_kind = l.book_kind and x.book_id = l.book_id
    );

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


ALTER FUNCTION "public"."save_bank_match_links"("p_line_id" bigint, "p_links" "jsonb", "p_source" "text", "p_status" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."exam_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "exam_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "submitted_at" timestamp with time zone,
    "score" integer,
    "total" integer,
    "percentage" integer,
    "passed" boolean
);


ALTER TABLE "public"."exam_attempts" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."score_exam_attempt"("p_attempt" "uuid") RETURNS "public"."exam_attempts"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  a public.exam_attempts;
  v_total integer;
  v_score integer;
  v_pass  integer;
begin
  select * into a from public.exam_attempts where id = p_attempt;
  if a is null then raise exception 'attempt not found'; end if;
  if a.student_id <> auth.uid() then raise exception 'not your attempt'; end if;
  if a.submitted_at is not null then return a; end if;

  select coalesce(sum(q.marks), 0),
         coalesce(sum(case when ans.chosen_index = q.correct_index then q.marks else 0 end), 0)
    into v_total, v_score
  from public.exam_questions q
  left join public.exam_answers ans
    on ans.question_id = q.id and ans.attempt_id = p_attempt
  where q.exam_id = a.exam_id;

  select passing_score into v_pass from public.exams where id = a.exam_id;

  update public.exam_attempts set
    submitted_at = now(),
    score = v_score,
    total = v_total,
    percentage = case when v_total > 0 then round(v_score * 100.0 / v_total) else 0 end,
    passed = case when v_total > 0 then round(v_score * 100.0 / v_total) >= v_pass else false end
  where id = p_attempt
  returning * into a;

  return a;
end;
$$;


ALTER FUNCTION "public"."score_exam_attempt"("p_attempt" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."session_in_my_batch"("p_session" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.live_sessions ls
    join public.timetable_slots s on s.id = ls.slot_id
    where ls.id = p_session
      and s.batch_name is not null
      and s.batch_name = public.my_batch()
  );
$$;


ALTER FUNCTION "public"."session_in_my_batch"("p_session" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."student_id_next_number"("p_code" "text") RETURNS numeric
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $_$
  select coalesce(max(substr(upper(btrim(s.id)), length(p_code) + 1)::numeric), 0) + 1
  from public.students s
  where left(upper(btrim(s.id)), length(p_code)) = p_code
    and substr(upper(btrim(s.id)), length(p_code) + 1) ~ '^[0-9]+$';
$_$;


ALTER FUNCTION "public"."student_id_next_number"("p_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."student_id_prefix_for_batch"("p_batch" "text") RETURNS "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_course text;
  v_code text;
begin
  if p_batch is null or btrim(p_batch) = '' then
    raise exception 'Choose a batch first — the Student ID comes from the batch''s course code.';
  end if;

  select b.course_name into v_course from public.batches b where b.name = p_batch;
  if not found then
    raise exception 'Batch "%" was not found.', p_batch;
  end if;

  select c.code into v_code
  from public.courses c
  where btrim(c.name) = btrim(coalesce(v_course, ''))
  order by c.id
  limit 1;
  if not found then
    raise exception 'Batch "%" has course "%", which is not in the Courses list, so no Student ID can be assigned. Add the course with a code in Admin first.',
      p_batch, btrim(coalesce(v_course, ''));
  end if;
  if v_code is null then
    raise exception 'Course "%" has no course code, so no Student ID can be assigned. Set its code in Admin first.',
      btrim(v_course);
  end if;

  return v_code;
end;
$$;


ALTER FUNCTION "public"."student_id_prefix_for_batch"("p_batch" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."students_fee_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_collected numeric;
  v_max_waiver numeric;
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if new.registration_fee is distinct from old.registration_fee
     or new.course_fee   is distinct from old.course_fee
     or new.exam_fee     is distinct from old.exam_fee
     or new.other_fee    is distinct from old.other_fee then
    raise exception 'Only the Owner or an Admin can change fee amounts.' using errcode = '42501';
  end if;

  if new.waiver is distinct from old.waiver then
    select coalesce(sum(c.amount), 0) into v_collected
    from public.collections c where c.student_id = new.id;
    v_max_waiver := greatest(old.waiver,
      greatest(0, coalesce(new.registration_fee,0) + coalesce(new.course_fee,0)
                + coalesce(new.exam_fee,0) + coalesce(new.other_fee,0) - v_collected));
    if not (new.status = 'Dropped'
            and new.waiver >= old.waiver
            and new.waiver <= v_max_waiver) then
      raise exception 'Only the Owner or an Admin can change the waiver.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."students_fee_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."students_follow_batch_dates"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  b record;
  v_new text;
begin
  if new.status = 'Dropped' or new.batch is null then
    return new;
  end if;

  select start_date, end_date into b from public.batches where name = new.batch;
  if not found then
    return new;
  end if;

  v_new := public.batch_status_for(new.status, b.start_date, b.end_date, public.ist_today());
  if v_new is distinct from new.status then
    insert into public.audit_log (table_name, row_id, action, old_row, new_row, changed_by)
    values ('students', 0, 'update', null,
            jsonb_build_object('batch_status_automation', true, 'source', 'student_trigger',
                               'run_date_ist', public.ist_today(),
                               'id', new.id, 'batch', new.batch,
                               'from', new.status, 'to', v_new, 'op', tg_op),
            auth.uid());
    new.status := v_new;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."students_follow_batch_dates"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."students_id_immutable"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if new.id is distinct from old.id then
    raise exception 'A Student ID can never be changed (% -> %).', old.id, new.id;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."students_id_immutable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_bank_entries"("p_run_id" "uuid", "p_items" "jsonb") RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $_$
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

    v_cur := private.bank_sync_get_value(it.book_kind, it.book_id, it.field);

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

    if coalesce(v_cur, '') <> coalesce(it.expected_old, '') then
      raise exception 'Entry changed since the preview, refresh and try again.';
    end if;

    if it.field = 'date' then
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
$_$;


ALTER FUNCTION "public"."sync_bank_entries"("p_run_id" "uuid", "p_items" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."teaches_batch"("b" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (select 1 from public.faculty_batches
    where faculty_id = auth.uid() and batch_name = b);
$$;


ALTER FUNCTION "public"."teaches_batch"("b" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."timetable_no_conflict"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if new.status = 'cancelled' then return new; end if;
  if exists (
    select 1 from public.timetable_slots s
    where s.id <> new.id
      and s.status <> 'cancelled'
      and s.day_of_week = new.day_of_week
      and new.starts_at < s.ends_at and s.starts_at < new.ends_at
      and (s.batch_name = new.batch_name
           or (new.faculty_id is not null and s.faculty_id = new.faculty_id))
  ) then
    raise exception 'Timetable clash: that batch or faculty already has a class in this slot';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."timetable_no_conflict"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."undo_bank_sync"("p_run_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
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
        v_skipped := v_skipped + 1;
        update public.bank_sync_history set undone_at = now() where id = h.id;
        continue;
    end;

    if coalesce(v_cur, '') = coalesce(h.new_value, '') then
      perform private.bank_sync_set_value(h.book_kind, h.book_id, h.field, h.old_value);
      v_restored := v_restored + 1;
    else
      v_skipped := v_skipped + 1;
    end if;
    update public.bank_sync_history set undone_at = now() where id = h.id;
  end loop;

  return jsonb_build_object('restored', v_restored, 'skipped', v_skipped);
end;
$$;


ALTER FUNCTION "public"."undo_bank_sync"("p_run_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_settings" (
    "id" integer DEFAULT 1 NOT NULL,
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    CONSTRAINT "app_settings_singleton" CHECK (("id" = 1))
);


ALTER TABLE "public"."app_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."attendance" (
    "session_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "present" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."attendance" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_log" (
    "id" bigint NOT NULL,
    "table_name" "text" NOT NULL,
    "row_id" bigint NOT NULL,
    "action" "text" NOT NULL,
    "old_row" "jsonb",
    "new_row" "jsonb",
    "changed_by" "uuid",
    "changed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "audit_log_action_check" CHECK (("action" = ANY (ARRAY['update'::"text", 'delete'::"text"])))
);


ALTER TABLE "public"."audit_log" OWNER TO "postgres";


ALTER TABLE "public"."audit_log" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."audit_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."bank_match_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "line_id" bigint NOT NULL,
    "book_kind" "text" NOT NULL,
    "book_id" bigint NOT NULL,
    "source" "text" NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "account" "text" NOT NULL,
    CONSTRAINT "bank_match_links_book_kind_check" CHECK (("book_kind" = ANY (ARRAY['collection'::"text", 'expense'::"text", 'transfer'::"text"]))),
    CONSTRAINT "bank_match_links_source_check" CHECK (("source" = ANY (ARRAY['auto_utr'::"text", 'auto_exact'::"text", 'auto_name'::"text", 'auto_group'::"text", 'manual'::"text", 'backfill'::"text", 'legacy_backfill'::"text"])))
);


ALTER TABLE "public"."bank_match_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bank_statement_lines" (
    "id" bigint NOT NULL,
    "statement_id" bigint NOT NULL,
    "account" "text" NOT NULL,
    "seq" integer,
    "txn_date" "date" NOT NULL,
    "description" "text",
    "reference" "text",
    "withdrawal" numeric DEFAULT 0 NOT NULL,
    "deposit" numeric DEFAULT 0 NOT NULL,
    "running_balance" numeric,
    "status" "text" DEFAULT 'unmatched'::"text" NOT NULL,
    "match_kind" "text",
    "match_id" bigint,
    "matched_at" timestamp with time zone,
    "matched_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "match_score" numeric,
    CONSTRAINT "bank_statement_lines_account_check" CHECK (("account" = ANY (ARRAY['HDFC'::"text", 'ICICI'::"text", 'Cash'::"text"]))),
    CONSTRAINT "bank_statement_lines_match_kind_check" CHECK (("match_kind" = ANY (ARRAY['collection'::"text", 'expense'::"text", 'transfer'::"text"]))),
    CONSTRAINT "bank_statement_lines_status_check" CHECK (("status" = ANY (ARRAY['unmatched'::"text", 'matched'::"text", 'classified'::"text", 'ignored'::"text", 'review'::"text"])))
);


ALTER TABLE "public"."bank_statement_lines" OWNER TO "postgres";


ALTER TABLE "public"."bank_statement_lines" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."bank_statement_lines_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."bank_statements" (
    "id" bigint NOT NULL,
    "account" "text" NOT NULL,
    "period_start" "date",
    "period_end" "date",
    "opening_balance" numeric,
    "closing_balance" numeric,
    "file_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    CONSTRAINT "bank_statements_account_check" CHECK (("account" = ANY (ARRAY['HDFC'::"text", 'ICICI'::"text", 'Cash'::"text"])))
);


ALTER TABLE "public"."bank_statements" OWNER TO "postgres";


ALTER TABLE "public"."bank_statements" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."bank_statements_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."bank_sync_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "run_id" "uuid" NOT NULL,
    "book_kind" "text" NOT NULL,
    "book_id" bigint NOT NULL,
    "field" "text" NOT NULL,
    "old_value" "text",
    "new_value" "text",
    "synced_by" "uuid" DEFAULT "auth"."uid"(),
    "synced_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "undone_at" timestamp with time zone,
    CONSTRAINT "bank_sync_history_book_kind_check" CHECK (("book_kind" = ANY (ARRAY['collection'::"text", 'expense'::"text", 'transfer'::"text"]))),
    CONSTRAINT "bank_sync_history_field_check" CHECK (("field" = ANY (ARRAY['bank_reference'::"text", 'date'::"text"])))
);


ALTER TABLE "public"."bank_sync_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."batches" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "course_name" "text",
    "course_fee" numeric DEFAULT 0 NOT NULL,
    "start_date" "date",
    "end_date" "date",
    "duration" "text",
    "notes" "text",
    "archived" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "registration_fee" numeric DEFAULT 0 NOT NULL,
    "exam_fee" numeric DEFAULT 0 NOT NULL,
    CONSTRAINT "batches_exam_fee_nonneg" CHECK (("exam_fee" >= (0)::numeric)),
    CONSTRAINT "batches_registration_fee_nonneg" CHECK (("registration_fee" >= (0)::numeric))
);


ALTER TABLE "public"."batches" OWNER TO "postgres";


ALTER TABLE "public"."batches" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."batches_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."collections" (
    "id" bigint NOT NULL,
    "student_id" "text" NOT NULL,
    "student_name" "text",
    "date" "date" NOT NULL,
    "type" "text" NOT NULL,
    "account" "text" NOT NULL,
    "amount" numeric NOT NULL,
    "reference" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_at" timestamp with time zone,
    "updated_by" "uuid",
    "bank_reference" "text",
    CONSTRAINT "collections_account_check" CHECK (("account" = ANY (ARRAY['HDFC'::"text", 'ICICI'::"text", 'Cash'::"text", 'Healthcare'::"text"]))),
    CONSTRAINT "collections_amount_check" CHECK (("amount" > (0)::numeric))
);


ALTER TABLE "public"."collections" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."collections_basic" AS
 SELECT "id",
    "student_id",
    "student_name",
    "date",
    "type",
    "amount",
    "reference",
        CASE
            WHEN ("public"."can_view_financials"() OR ("created_by" = "auth"."uid"())) THEN "account"
            ELSE NULL::"text"
        END AS "account",
    "bank_reference"
   FROM "public"."collections"
  WHERE ("public"."is_staff_or_admin"() OR ("student_id" = "public"."my_student_ref"()));


ALTER VIEW "public"."collections_basic" OWNER TO "postgres";


ALTER TABLE "public"."collections" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."collections_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."courses" (
    "id" bigint NOT NULL,
    "code" "text",
    "name" "text" NOT NULL,
    "archived" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "courses_code_format" CHECK ((("code" = "upper"("btrim"("code"))) AND ("code" <> ''::"text")))
);


ALTER TABLE "public"."courses" OWNER TO "postgres";


ALTER TABLE "public"."courses" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."courses_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."exam_answers" (
    "attempt_id" "uuid" NOT NULL,
    "question_id" "uuid" NOT NULL,
    "chosen_index" integer
);


ALTER TABLE "public"."exam_answers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."exam_questions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "exam_id" "uuid" NOT NULL,
    "position" integer DEFAULT 1 NOT NULL,
    "question" "text" NOT NULL,
    "options" "jsonb" NOT NULL,
    "correct_index" integer NOT NULL,
    "marks" integer DEFAULT 1 NOT NULL
);


ALTER TABLE "public"."exam_questions" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."exam_questions_public" WITH ("security_invoker"='false') AS
 SELECT "q"."id",
    "q"."exam_id",
    "q"."position",
    "q"."question",
    "q"."options",
    "q"."marks"
   FROM ("public"."exam_questions" "q"
     JOIN "public"."exams" "e" ON (("e"."id" = "q"."exam_id")))
  WHERE (("e"."status" = 'published'::"text") AND (("e"."batch_name" = "public"."my_batch"()) OR "public"."can_manage_exam"("e".*)));


ALTER VIEW "public"."exam_questions_public" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."expense_categories" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "archived" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid"
);


ALTER TABLE "public"."expense_categories" OWNER TO "postgres";


ALTER TABLE "public"."expense_categories" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."expense_categories_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."expenses" (
    "id" bigint NOT NULL,
    "date" "date" NOT NULL,
    "category" "text" NOT NULL,
    "account" "text" NOT NULL,
    "amount" numeric NOT NULL,
    "reference" "text",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_at" timestamp with time zone,
    "updated_by" "uuid",
    "bank_reference" "text",
    CONSTRAINT "expenses_account_check" CHECK (("account" = ANY (ARRAY['HDFC'::"text", 'ICICI'::"text", 'Cash'::"text", 'Healthcare'::"text"]))),
    CONSTRAINT "expenses_amount_check" CHECK (("amount" > (0)::numeric))
);


ALTER TABLE "public"."expenses" OWNER TO "postgres";


ALTER TABLE "public"."expenses" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."expenses_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."faculty_batches" (
    "faculty_id" "uuid" NOT NULL,
    "batch_name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."faculty_batches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."faculty_reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "faculty_id" "uuid",
    "faculty_name" "text" NOT NULL,
    "subject" "text",
    "rating" integer NOT NULL,
    "clarity" integer NOT NULL,
    "punctuality" integer NOT NULL,
    "comment" "text",
    "student_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "faculty_reviews_clarity_check" CHECK ((("clarity" >= 1) AND ("clarity" <= 5))),
    CONSTRAINT "faculty_reviews_punctuality_check" CHECK ((("punctuality" >= 1) AND ("punctuality" <= 5))),
    CONSTRAINT "faculty_reviews_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5)))
);


ALTER TABLE "public"."faculty_reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."live_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slot_id" "uuid" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ended_at" timestamp with time zone,
    "host_id" "uuid"
);


ALTER TABLE "public"."live_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "recipient_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text",
    "link_tab" "text",
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text",
    "full_name" "text",
    "role" "text" DEFAULT 'staff'::"text" NOT NULL,
    "can_view_financials" boolean DEFAULT false NOT NULL,
    "is_approved" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "batch_name" "text",
    "student_ref" "text",
    "must_change_password" boolean DEFAULT false NOT NULL,
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['super_admin'::"text", 'admin'::"text", 'staff'::"text", 'student'::"text", 'faculty'::"text", 'professional'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."students" (
    "id" "text" NOT NULL,
    "batch" "text",
    "name" "text" NOT NULL,
    "course" "text",
    "registration_fee" numeric DEFAULT 0 NOT NULL,
    "course_fee" numeric DEFAULT 0 NOT NULL,
    "exam_fee" numeric DEFAULT 0 NOT NULL,
    "other_fee" numeric DEFAULT 0 NOT NULL,
    "waiver" numeric DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'Registered'::"text" NOT NULL,
    "enrollment_date" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    "student_phone" "text",
    "student_email" "text",
    "parent_name" "text",
    "parent_phone" "text",
    "guardian_relation" "text",
    "place" "text",
    "address" "text",
    "date_of_birth" "date",
    "lead_source" "text",
    CONSTRAINT "students_guardian_relation_valid" CHECK ((("guardian_relation" IS NULL) OR ("guardian_relation" = ANY (ARRAY['Father'::"text", 'Mother'::"text", 'Other'::"text"])))),
    CONSTRAINT "students_parent_phone_format" CHECK ((("parent_phone" IS NULL) OR ("parent_phone" ~ '^[0-9]{10}$'::"text"))),
    CONSTRAINT "students_status_check" CHECK (("status" = ANY (ARRAY['Registered'::"text", 'Active'::"text", 'Completed'::"text", 'Dropped'::"text"]))),
    CONSTRAINT "students_student_email_format" CHECK ((("student_email" IS NULL) OR ("student_email" ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'::"text"))),
    CONSTRAINT "students_student_phone_format" CHECK ((("student_phone" IS NULL) OR ("student_phone" ~ '^[0-9]{10}$'::"text")))
);


ALTER TABLE "public"."students" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."timetable_slots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "batch_name" "text" NOT NULL,
    "faculty_id" "uuid",
    "subject" "text" NOT NULL,
    "day_of_week" "text" NOT NULL,
    "starts_at" time without time zone NOT NULL,
    "ends_at" time without time zone NOT NULL,
    "mode" "text" DEFAULT 'live'::"text" NOT NULL,
    "room" "text",
    "join_link" "text",
    "status" "text" DEFAULT 'scheduled'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "timetable_slots_check" CHECK (("ends_at" > "starts_at")),
    CONSTRAINT "timetable_slots_day_of_week_check" CHECK (("day_of_week" = ANY (ARRAY['Monday'::"text", 'Tuesday'::"text", 'Wednesday'::"text", 'Thursday'::"text", 'Friday'::"text", 'Saturday'::"text", 'Sunday'::"text"]))),
    CONSTRAINT "timetable_slots_mode_check" CHECK (("mode" = ANY (ARRAY['live'::"text", 'in_person'::"text"]))),
    CONSTRAINT "timetable_slots_status_check" CHECK (("status" = ANY (ARRAY['scheduled'::"text", 'cancelled'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."timetable_slots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transfers" (
    "id" bigint NOT NULL,
    "date" "date" NOT NULL,
    "from_account" "text" NOT NULL,
    "to_account" "text" NOT NULL,
    "amount" numeric NOT NULL,
    "purpose" "text",
    "reference" "text",
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "bank_reference" "text",
    CONSTRAINT "transfers_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "transfers_distinct_accounts" CHECK (("from_account" <> "to_account")),
    CONSTRAINT "transfers_from_account_check" CHECK (("from_account" = ANY (ARRAY['HDFC'::"text", 'ICICI'::"text", 'Cash'::"text", 'Healthcare'::"text", 'Adjustments'::"text"]))),
    CONSTRAINT "transfers_to_account_check" CHECK (("to_account" = ANY (ARRAY['HDFC'::"text", 'ICICI'::"text", 'Cash'::"text", 'Healthcare'::"text", 'Adjustments'::"text"])))
);


ALTER TABLE "public"."transfers" OWNER TO "postgres";


ALTER TABLE "public"."transfers" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."transfers_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE ONLY "public"."app_settings"
    ADD CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."assignment_submissions"
    ADD CONSTRAINT "assignment_submissions_assignment_id_student_id_key" UNIQUE ("assignment_id", "student_id");



ALTER TABLE ONLY "public"."assignment_submissions"
    ADD CONSTRAINT "assignment_submissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."assignments"
    ADD CONSTRAINT "assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_pkey" PRIMARY KEY ("session_id", "student_id");



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bank_match_links"
    ADD CONSTRAINT "bank_match_links_book_account_key" UNIQUE ("book_kind", "book_id", "account");



ALTER TABLE ONLY "public"."bank_match_links"
    ADD CONSTRAINT "bank_match_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bank_statement_lines"
    ADD CONSTRAINT "bank_statement_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bank_statements"
    ADD CONSTRAINT "bank_statements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bank_sync_history"
    ADD CONSTRAINT "bank_sync_history_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."batches"
    ADD CONSTRAINT "batches_course_fee_nonneg" CHECK (("course_fee" >= (0)::numeric)) NOT VALID;



ALTER TABLE "public"."batches"
    ADD CONSTRAINT "batches_end_after_start" CHECK ((("end_date" IS NULL) OR ("start_date" IS NULL) OR ("end_date" >= "start_date"))) NOT VALID;



ALTER TABLE ONLY "public"."batches"
    ADD CONSTRAINT "batches_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."batches"
    ADD CONSTRAINT "batches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."collections"
    ADD CONSTRAINT "collections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."exam_answers"
    ADD CONSTRAINT "exam_answers_pkey" PRIMARY KEY ("attempt_id", "question_id");



ALTER TABLE ONLY "public"."exam_attempts"
    ADD CONSTRAINT "exam_attempts_exam_id_student_id_key" UNIQUE ("exam_id", "student_id");



ALTER TABLE ONLY "public"."exam_attempts"
    ADD CONSTRAINT "exam_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."exam_questions"
    ADD CONSTRAINT "exam_questions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."exams"
    ADD CONSTRAINT "exams_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."expense_categories"
    ADD CONSTRAINT "expense_categories_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."expense_categories"
    ADD CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."faculty_batches"
    ADD CONSTRAINT "faculty_batches_pkey" PRIMARY KEY ("faculty_id", "batch_name");



ALTER TABLE ONLY "public"."faculty_reviews"
    ADD CONSTRAINT "faculty_reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."live_sessions"
    ADD CONSTRAINT "live_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."students"
    ADD CONSTRAINT "students_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."timetable_slots"
    ADD CONSTRAINT "timetable_slots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transfers"
    ADD CONSTRAINT "transfers_pkey" PRIMARY KEY ("id");



CREATE INDEX "audit_log_table_row_idx" ON "public"."audit_log" USING "btree" ("table_name", "row_id");



CREATE INDEX "bank_match_links_line_idx" ON "public"."bank_match_links" USING "btree" ("line_id");



CREATE INDEX "bank_statement_lines_statement_idx" ON "public"."bank_statement_lines" USING "btree" ("statement_id");



CREATE INDEX "bank_sync_history_book_idx" ON "public"."bank_sync_history" USING "btree" ("book_kind", "book_id");



CREATE INDEX "bank_sync_history_run_idx" ON "public"."bank_sync_history" USING "btree" ("run_id");



CREATE INDEX "collections_date_idx" ON "public"."collections" USING "btree" ("date");



CREATE INDEX "collections_student_id_idx" ON "public"."collections" USING "btree" ("student_id");



CREATE INDEX "expenses_date_idx" ON "public"."expenses" USING "btree" ("date");



CREATE INDEX "notifications_recipient_idx" ON "public"."notifications" USING "btree" ("recipient_id", "created_at" DESC);



CREATE INDEX "transfers_date_idx" ON "public"."transfers" USING "btree" ("date");



CREATE OR REPLACE TRIGGER "assignment_submissions_no_self_grade" BEFORE INSERT ON "public"."assignment_submissions" FOR EACH ROW EXECUTE FUNCTION "public"."assignment_submissions_no_self_grade"();



CREATE OR REPLACE TRIGGER "bank_match_links_check_book_trg" BEFORE INSERT OR UPDATE OF "book_kind", "book_id" ON "public"."bank_match_links" FOR EACH ROW EXECUTE FUNCTION "public"."bank_match_links_check_book"();



CREATE OR REPLACE TRIGGER "bank_match_links_cleanup_trg" AFTER DELETE ON "public"."collections" FOR EACH ROW EXECUTE FUNCTION "public"."bank_match_links_cleanup_book"();



CREATE OR REPLACE TRIGGER "bank_match_links_cleanup_trg" AFTER DELETE ON "public"."expenses" FOR EACH ROW EXECUTE FUNCTION "public"."bank_match_links_cleanup_book"();



CREATE OR REPLACE TRIGGER "bank_match_links_cleanup_trg" AFTER DELETE ON "public"."transfers" FOR EACH ROW EXECUTE FUNCTION "public"."bank_match_links_cleanup_book"();



CREATE OR REPLACE TRIGGER "bank_match_links_set_account_trg" BEFORE INSERT OR UPDATE ON "public"."bank_match_links" FOR EACH ROW EXECUTE FUNCTION "public"."bank_match_links_set_account"();



CREATE OR REPLACE TRIGGER "batches_fee_guard" BEFORE UPDATE OF "course_fee", "registration_fee", "exam_fee" ON "public"."batches" FOR EACH ROW EXECUTE FUNCTION "public"."batches_fee_guard"();



CREATE OR REPLACE TRIGGER "batches_name_rule" BEFORE INSERT OR UPDATE OF "name" ON "public"."batches" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_batch_name_rule"();



CREATE OR REPLACE TRIGGER "batches_resync_students" AFTER UPDATE OF "start_date", "end_date" ON "public"."batches" FOR EACH ROW WHEN ((("old"."start_date" IS DISTINCT FROM "new"."start_date") OR ("old"."end_date" IS DISTINCT FROM "new"."end_date"))) EXECUTE FUNCTION "public"."batches_resync_students"();



CREATE OR REPLACE TRIGGER "collections_audit" AFTER DELETE OR UPDATE ON "public"."collections" FOR EACH ROW EXECUTE FUNCTION "public"."log_financial_change"();



CREATE OR REPLACE TRIGGER "exam_attempts_no_forged_result" BEFORE INSERT ON "public"."exam_attempts" FOR EACH ROW EXECUTE FUNCTION "public"."exam_attempts_no_forged_result"();



CREATE OR REPLACE TRIGGER "expenses_audit" AFTER DELETE OR UPDATE ON "public"."expenses" FOR EACH ROW EXECUTE FUNCTION "public"."log_financial_change"();



CREATE OR REPLACE TRIGGER "students_fee_guard" BEFORE UPDATE OF "registration_fee", "course_fee", "exam_fee", "other_fee", "waiver" ON "public"."students" FOR EACH ROW EXECUTE FUNCTION "public"."students_fee_guard"();



CREATE OR REPLACE TRIGGER "students_follow_batch_dates" BEFORE INSERT OR UPDATE OF "batch", "status" ON "public"."students" FOR EACH ROW EXECUTE FUNCTION "public"."students_follow_batch_dates"();



CREATE OR REPLACE TRIGGER "students_id_immutable" BEFORE UPDATE OF "id" ON "public"."students" FOR EACH ROW EXECUTE FUNCTION "public"."students_id_immutable"();



CREATE OR REPLACE TRIGGER "timetable_no_conflict_t" BEFORE INSERT OR UPDATE ON "public"."timetable_slots" FOR EACH ROW EXECUTE FUNCTION "public"."timetable_no_conflict"();



CREATE OR REPLACE TRIGGER "transfers_audit" AFTER DELETE OR UPDATE ON "public"."transfers" FOR EACH ROW EXECUTE FUNCTION "public"."log_financial_change"();



ALTER TABLE ONLY "public"."app_settings"
    ADD CONSTRAINT "app_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."assignment_submissions"
    ADD CONSTRAINT "assignment_submissions_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."assignment_submissions"
    ADD CONSTRAINT "assignment_submissions_graded_by_fkey" FOREIGN KEY ("graded_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."assignment_submissions"
    ADD CONSTRAINT "assignment_submissions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."assignments"
    ADD CONSTRAINT "assignments_batch_name_fkey" FOREIGN KEY ("batch_name") REFERENCES "public"."batches"("name") ON UPDATE CASCADE;



ALTER TABLE ONLY "public"."assignments"
    ADD CONSTRAINT "assignments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."assignments"
    ADD CONSTRAINT "assignments_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."live_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."bank_match_links"
    ADD CONSTRAINT "bank_match_links_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "public"."bank_statement_lines"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bank_statement_lines"
    ADD CONSTRAINT "bank_statement_lines_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."bank_statement_lines"
    ADD CONSTRAINT "bank_statement_lines_matched_by_fkey" FOREIGN KEY ("matched_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."bank_statement_lines"
    ADD CONSTRAINT "bank_statement_lines_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "public"."bank_statements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bank_statements"
    ADD CONSTRAINT "bank_statements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."batches"
    ADD CONSTRAINT "batches_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."collections"
    ADD CONSTRAINT "collections_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."collections"
    ADD CONSTRAINT "collections_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id");



ALTER TABLE ONLY "public"."collections"
    ADD CONSTRAINT "collections_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."exam_answers"
    ADD CONSTRAINT "exam_answers_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "public"."exam_attempts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."exam_answers"
    ADD CONSTRAINT "exam_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."exam_questions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."exam_attempts"
    ADD CONSTRAINT "exam_attempts_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."exam_attempts"
    ADD CONSTRAINT "exam_attempts_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."exam_questions"
    ADD CONSTRAINT "exam_questions_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."exams"
    ADD CONSTRAINT "exams_batch_name_fkey" FOREIGN KEY ("batch_name") REFERENCES "public"."batches"("name") ON UPDATE CASCADE;



ALTER TABLE ONLY "public"."exams"
    ADD CONSTRAINT "exams_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."expense_categories"
    ADD CONSTRAINT "expense_categories_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_category_fkey" FOREIGN KEY ("category") REFERENCES "public"."expense_categories"("name") ON UPDATE CASCADE;



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."faculty_batches"
    ADD CONSTRAINT "faculty_batches_batch_name_fkey" FOREIGN KEY ("batch_name") REFERENCES "public"."batches"("name") ON UPDATE CASCADE;



ALTER TABLE ONLY "public"."faculty_batches"
    ADD CONSTRAINT "faculty_batches_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."faculty_reviews"
    ADD CONSTRAINT "faculty_reviews_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."faculty_reviews"
    ADD CONSTRAINT "faculty_reviews_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."live_sessions"
    ADD CONSTRAINT "live_sessions_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."live_sessions"
    ADD CONSTRAINT "live_sessions_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "public"."timetable_slots"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_batch_name_fkey" FOREIGN KEY ("batch_name") REFERENCES "public"."batches"("name") ON UPDATE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_student_ref_fkey" FOREIGN KEY ("student_ref") REFERENCES "public"."students"("id");



ALTER TABLE ONLY "public"."students"
    ADD CONSTRAINT "students_batch_fkey" FOREIGN KEY ("batch") REFERENCES "public"."batches"("name") ON UPDATE CASCADE;



ALTER TABLE ONLY "public"."students"
    ADD CONSTRAINT "students_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."students"
    ADD CONSTRAINT "students_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."timetable_slots"
    ADD CONSTRAINT "timetable_slots_batch_name_fkey" FOREIGN KEY ("batch_name") REFERENCES "public"."batches"("name") ON UPDATE CASCADE;



ALTER TABLE ONLY "public"."timetable_slots"
    ADD CONSTRAINT "timetable_slots_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."timetable_slots"
    ADD CONSTRAINT "timetable_slots_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."transfers"
    ADD CONSTRAINT "transfers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



CREATE POLICY "ans_manager_read" ON "public"."exam_answers" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."exam_attempts" "t"
     JOIN "public"."exams" "e" ON (("e"."id" = "t"."exam_id")))
  WHERE (("t"."id" = "exam_answers"."attempt_id") AND "public"."can_manage_exam"("e".*)))));



CREATE POLICY "ans_student_rw" ON "public"."exam_answers" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."exam_attempts" "t"
  WHERE (("t"."id" = "exam_answers"."attempt_id") AND ("t"."student_id" = "auth"."uid"()) AND ("t"."submitted_at" IS NULL))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."exam_attempts" "t"
  WHERE (("t"."id" = "exam_answers"."attempt_id") AND ("t"."student_id" = "auth"."uid"()) AND ("t"."submitted_at" IS NULL)))));



ALTER TABLE "public"."app_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "app_settings_approved_select" ON "public"."app_settings" FOR SELECT USING ("public"."is_approved_user"());



CREATE POLICY "app_settings_super_admin_insert" ON "public"."app_settings" FOR INSERT WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "app_settings_super_admin_write" ON "public"."app_settings" FOR UPDATE USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "asg_delete" ON "public"."assignments" FOR DELETE TO "authenticated" USING ("public"."can_manage_assignment"("assignments".*));



CREATE POLICY "asg_insert" ON "public"."assignments" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_staff_or_admin"() OR "public"."teaches_batch"("batch_name")));



CREATE POLICY "asg_read" ON "public"."assignments" FOR SELECT TO "authenticated" USING (("public"."is_staff_or_admin"() OR "public"."teaches_batch"("batch_name") OR (("status" = 'published'::"text") AND ("batch_name" = "public"."my_batch"()))));



CREATE POLICY "asg_update" ON "public"."assignments" FOR UPDATE TO "authenticated" USING ("public"."can_manage_assignment"("assignments".*)) WITH CHECK ("public"."can_manage_assignment"("assignments".*));



ALTER TABLE "public"."assignment_submissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."assignments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "attempt_read" ON "public"."exam_attempts" FOR SELECT TO "authenticated" USING ((("student_id" = "auth"."uid"()) OR "public"."is_staff_or_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."exams" "e"
  WHERE (("e"."id" = "exam_attempts"."exam_id") AND "public"."can_manage_exam"("e".*))))));



CREATE POLICY "attempt_student_insert" ON "public"."exam_attempts" FOR INSERT TO "authenticated" WITH CHECK ((("student_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."exams" "e"
  WHERE (("e"."id" = "exam_attempts"."exam_id") AND ("e"."status" = 'published'::"text") AND ("e"."batch_name" = "public"."my_batch"()) AND (("e"."opens_at" IS NULL) OR ("now"() >= "e"."opens_at")) AND (("e"."closes_at" IS NULL) OR ("now"() <= "e"."closes_at")))))));



CREATE POLICY "attend_read" ON "public"."attendance" FOR SELECT TO "authenticated" USING ((("student_id" = "auth"."uid"()) OR "public"."is_staff_or_admin"() OR (EXISTS ( SELECT 1
   FROM ("public"."live_sessions" "ls"
     JOIN "public"."timetable_slots" "s" ON (("s"."id" = "ls"."slot_id")))
  WHERE (("ls"."id" = "attendance"."session_id") AND ("s"."faculty_id" = "auth"."uid"()))))));



CREATE POLICY "attend_self_insert" ON "public"."attendance" FOR INSERT TO "authenticated" WITH CHECK ((("student_id" = "auth"."uid"()) AND "public"."session_in_my_batch"("session_id")));



CREATE POLICY "attend_staff_write" ON "public"."attendance" TO "authenticated" USING (("public"."is_staff_or_admin"() OR (EXISTS ( SELECT 1
   FROM ("public"."live_sessions" "ls"
     JOIN "public"."timetable_slots" "s" ON (("s"."id" = "ls"."slot_id")))
  WHERE (("ls"."id" = "attendance"."session_id") AND ("s"."faculty_id" = "auth"."uid"())))))) WITH CHECK (("public"."is_staff_or_admin"() OR (EXISTS ( SELECT 1
   FROM ("public"."live_sessions" "ls"
     JOIN "public"."timetable_slots" "s" ON (("s"."id" = "ls"."slot_id")))
  WHERE (("ls"."id" = "attendance"."session_id") AND ("s"."faculty_id" = "auth"."uid"()))))));



ALTER TABLE "public"."attendance" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_log_financial_viewer_select" ON "public"."audit_log" FOR SELECT USING ("public"."can_view_financials"());



ALTER TABLE "public"."bank_match_links" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bank_match_links_admin_delete" ON "public"."bank_match_links" FOR DELETE USING ("public"."is_admin"());



CREATE POLICY "bank_match_links_admin_insert" ON "public"."bank_match_links" FOR INSERT WITH CHECK ("public"."is_admin"());



CREATE POLICY "bank_match_links_admin_update" ON "public"."bank_match_links" FOR UPDATE USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "bank_match_links_financial_viewer_select" ON "public"."bank_match_links" FOR SELECT USING ("public"."can_view_financials"());



ALTER TABLE "public"."bank_statement_lines" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bank_statement_lines_admin_insert" ON "public"."bank_statement_lines" FOR INSERT WITH CHECK ("public"."is_admin"());



CREATE POLICY "bank_statement_lines_admin_update" ON "public"."bank_statement_lines" FOR UPDATE USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "bank_statement_lines_financial_viewer_select" ON "public"."bank_statement_lines" FOR SELECT USING ("public"."can_view_financials"());



ALTER TABLE "public"."bank_statements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bank_statements_admin_delete" ON "public"."bank_statements" FOR DELETE USING ("public"."is_admin"());



CREATE POLICY "bank_statements_admin_insert" ON "public"."bank_statements" FOR INSERT WITH CHECK ("public"."is_admin"());



CREATE POLICY "bank_statements_admin_update" ON "public"."bank_statements" FOR UPDATE USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "bank_statements_financial_viewer_select" ON "public"."bank_statements" FOR SELECT USING ("public"."can_view_financials"());



ALTER TABLE "public"."bank_sync_history" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bank_sync_history_admin_insert" ON "public"."bank_sync_history" FOR INSERT WITH CHECK ("public"."is_admin"());



CREATE POLICY "bank_sync_history_admin_update" ON "public"."bank_sync_history" FOR UPDATE USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "bank_sync_history_financial_viewer_select" ON "public"."bank_sync_history" FOR SELECT USING ("public"."can_view_financials"());



ALTER TABLE "public"."batches" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "batches_admin_delete" ON "public"."batches" FOR DELETE USING ("public"."is_admin"());



CREATE POLICY "batches_approved_select" ON "public"."batches" FOR SELECT USING ("public"."is_approved_user"());



CREATE POLICY "batches_staff_insert" ON "public"."batches" FOR INSERT WITH CHECK ("public"."is_staff_or_admin"());



CREATE POLICY "batches_staff_update" ON "public"."batches" FOR UPDATE USING ("public"."is_staff_or_admin"()) WITH CHECK ("public"."is_staff_or_admin"());



ALTER TABLE "public"."collections" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "collections_admin_delete" ON "public"."collections" FOR DELETE USING ("public"."is_admin"());



CREATE POLICY "collections_admin_update" ON "public"."collections" FOR UPDATE USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "collections_approved_select" ON "public"."collections" FOR SELECT USING ("public"."is_approved_user"());



CREATE POLICY "collections_staff_insert" ON "public"."collections" FOR INSERT WITH CHECK ("public"."is_staff_or_admin"());



ALTER TABLE "public"."courses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "courses_admin_delete" ON "public"."courses" FOR DELETE USING ("public"."is_admin"());



CREATE POLICY "courses_approved_select" ON "public"."courses" FOR SELECT USING ("public"."is_approved_user"());



CREATE POLICY "courses_staff_insert" ON "public"."courses" FOR INSERT WITH CHECK ("public"."is_staff_or_admin"());



CREATE POLICY "courses_staff_update" ON "public"."courses" FOR UPDATE USING ("public"."is_staff_or_admin"()) WITH CHECK ("public"."is_staff_or_admin"());



ALTER TABLE "public"."exam_answers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."exam_attempts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."exam_questions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "exam_read" ON "public"."exams" FOR SELECT TO "authenticated" USING (("public"."is_staff_or_admin"() OR "public"."teaches_batch"("batch_name") OR (("status" = 'published'::"text") AND ("batch_name" = "public"."my_batch"()))));



CREATE POLICY "exam_write" ON "public"."exams" TO "authenticated" USING ("public"."can_manage_exam"("exams".*)) WITH CHECK ("public"."can_manage_exam"("exams".*));



ALTER TABLE "public"."exams" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."expense_categories" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "expense_categories_admin_delete" ON "public"."expense_categories" FOR DELETE USING ("public"."is_admin"());



CREATE POLICY "expense_categories_approved_select" ON "public"."expense_categories" FOR SELECT USING ("public"."is_approved_user"());



CREATE POLICY "expense_categories_staff_insert" ON "public"."expense_categories" FOR INSERT WITH CHECK ("public"."is_staff_or_admin"());



CREATE POLICY "expense_categories_staff_update" ON "public"."expense_categories" FOR UPDATE USING ("public"."is_staff_or_admin"()) WITH CHECK ("public"."is_staff_or_admin"());



ALTER TABLE "public"."expenses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "expenses_admin_delete" ON "public"."expenses" FOR DELETE USING ("public"."is_admin"());



CREATE POLICY "expenses_admin_update" ON "public"."expenses" FOR UPDATE USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "expenses_approved_select" ON "public"."expenses" FOR SELECT TO "authenticated" USING ("public"."is_staff_or_admin"());



CREATE POLICY "expenses_staff_insert" ON "public"."expenses" FOR INSERT WITH CHECK ("public"."is_staff_or_admin"());



ALTER TABLE "public"."faculty_batches" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "faculty_batches_read" ON "public"."faculty_batches" FOR SELECT TO "authenticated" USING ((("faculty_id" = "auth"."uid"()) OR "public"."is_staff_or_admin"()));



CREATE POLICY "faculty_batches_write" ON "public"."faculty_batches" TO "authenticated" USING ("public"."is_staff_or_admin"()) WITH CHECK ("public"."is_staff_or_admin"());



ALTER TABLE "public"."faculty_reviews" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "live_read" ON "public"."live_sessions" FOR SELECT TO "authenticated" USING (("public"."is_staff_or_admin"() OR ("host_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."timetable_slots" "s"
  WHERE (("s"."id" = "live_sessions"."slot_id") AND ("s"."batch_name" = "public"."my_batch"()))))));



ALTER TABLE "public"."live_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "live_write" ON "public"."live_sessions" TO "authenticated" USING (("public"."is_staff_or_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."timetable_slots" "s"
  WHERE (("s"."id" = "live_sessions"."slot_id") AND ("s"."faculty_id" = "auth"."uid"())))))) WITH CHECK (("public"."is_staff_or_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."timetable_slots" "s"
  WHERE (("s"."id" = "live_sessions"."slot_id") AND ("s"."faculty_id" = "auth"."uid"()))))));



CREATE POLICY "notif_read" ON "public"."notifications" FOR SELECT TO "authenticated" USING (("recipient_id" = "auth"."uid"()));



CREATE POLICY "notif_update_own" ON "public"."notifications" FOR UPDATE TO "authenticated" USING (("recipient_id" = "auth"."uid"())) WITH CHECK (("recipient_id" = "auth"."uid"()));



ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_self_select" ON "public"."profiles" FOR SELECT USING (("id" = "auth"."uid"()));



CREATE POLICY "profiles_super_admin_select_all" ON "public"."profiles" FOR SELECT USING ("public"."is_super_admin"());



CREATE POLICY "profiles_super_admin_update_all" ON "public"."profiles" FOR UPDATE USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "q_manager_read" ON "public"."exam_questions" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."exams" "e"
  WHERE (("e"."id" = "exam_questions"."exam_id") AND "public"."can_manage_exam"("e".*)))));



CREATE POLICY "q_manager_write" ON "public"."exam_questions" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."exams" "e"
  WHERE (("e"."id" = "exam_questions"."exam_id") AND "public"."can_manage_exam"("e".*))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."exams" "e"
  WHERE (("e"."id" = "exam_questions"."exam_id") AND "public"."can_manage_exam"("e".*)))));



CREATE POLICY "rev_admin_delete" ON "public"."faculty_reviews" FOR DELETE TO "authenticated" USING ("public"."is_staff_or_admin"());



CREATE POLICY "rev_read" ON "public"."faculty_reviews" FOR SELECT TO "authenticated" USING ((("student_id" = "auth"."uid"()) OR ("faculty_id" = "auth"."uid"()) OR "public"."is_staff_or_admin"()));



CREATE POLICY "rev_student_insert" ON "public"."faculty_reviews" FOR INSERT TO "authenticated" WITH CHECK (("student_id" = "auth"."uid"()));



CREATE POLICY "rev_student_update" ON "public"."faculty_reviews" FOR UPDATE TO "authenticated" USING (("student_id" = "auth"."uid"())) WITH CHECK (("student_id" = "auth"."uid"()));



CREATE POLICY "slots_read" ON "public"."timetable_slots" FOR SELECT TO "authenticated" USING (("public"."is_staff_or_admin"() OR ("faculty_id" = "auth"."uid"()) OR ("batch_name" = "public"."my_batch"())));



CREATE POLICY "slots_write" ON "public"."timetable_slots" TO "authenticated" USING ("public"."is_staff_or_admin"()) WITH CHECK ("public"."is_staff_or_admin"());



ALTER TABLE "public"."students" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "students_staff_insert" ON "public"."students" FOR INSERT WITH CHECK ("public"."is_staff_or_admin"());



CREATE POLICY "students_staff_or_own_select" ON "public"."students" FOR SELECT USING (("public"."is_staff_or_admin"() OR ("id" = "public"."my_student_ref"())));



CREATE POLICY "students_staff_update" ON "public"."students" FOR UPDATE USING ("public"."is_staff_or_admin"()) WITH CHECK ("public"."is_staff_or_admin"());



CREATE POLICY "sub_grader_update" ON "public"."assignment_submissions" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."assignments" "a"
  WHERE (("a"."id" = "assignment_submissions"."assignment_id") AND "public"."can_manage_assignment"("a".*))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."assignments" "a"
  WHERE (("a"."id" = "assignment_submissions"."assignment_id") AND "public"."can_manage_assignment"("a".*)))));



CREATE POLICY "sub_read" ON "public"."assignment_submissions" FOR SELECT TO "authenticated" USING ((("student_id" = "auth"."uid"()) OR "public"."is_staff_or_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."assignments" "a"
  WHERE (("a"."id" = "assignment_submissions"."assignment_id") AND "public"."can_manage_assignment"("a".*))))));



CREATE POLICY "sub_student_insert" ON "public"."assignment_submissions" FOR INSERT TO "authenticated" WITH CHECK ((("student_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."assignments" "a"
  WHERE (("a"."id" = "assignment_submissions"."assignment_id") AND ("a"."status" = 'published'::"text") AND ("a"."batch_name" = "public"."my_batch"()))))));



ALTER TABLE "public"."timetable_slots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transfers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "transfers_admin_delete" ON "public"."transfers" FOR DELETE USING ("public"."is_admin"());



CREATE POLICY "transfers_admin_insert" ON "public"."transfers" FOR INSERT WITH CHECK ("public"."is_admin"());



CREATE POLICY "transfers_admin_update" ON "public"."transfers" FOR UPDATE USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "transfers_financial_viewer_select" ON "public"."transfers" FOR SELECT USING ("public"."can_view_financials"());



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."allocate_student_id"("p_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."allocate_student_id"("p_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."assignment_submissions_no_self_grade"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."assignment_submissions_no_self_grade"() TO "service_role";



GRANT ALL ON FUNCTION "public"."bank_match_links_check_book"() TO "anon";
GRANT ALL ON FUNCTION "public"."bank_match_links_check_book"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."bank_match_links_check_book"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."bank_match_links_cleanup_book"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."bank_match_links_cleanup_book"() TO "service_role";



GRANT ALL ON FUNCTION "public"."bank_match_links_set_account"() TO "anon";
GRANT ALL ON FUNCTION "public"."bank_match_links_set_account"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."bank_match_links_set_account"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."batch_status_data_issues"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."batch_status_data_issues"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."batch_status_for"("p_status" "text", "p_start" "date", "p_end" "date", "p_today" "date") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."batch_status_targets"("p_today" "date") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."batches_fee_guard"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."batches_fee_guard"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."batches_resync_students"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."bulk_upsert_students"("p_rows" "jsonb", "p_dry_run" boolean, "p_confirm_blanks" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."bulk_upsert_students"("p_rows" "jsonb", "p_dry_run" boolean, "p_confirm_blanks" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."bulk_upsert_students"("p_rows" "jsonb", "p_dry_run" boolean, "p_confirm_blanks" boolean) TO "service_role";



GRANT ALL ON TABLE "public"."assignments" TO "anon";
GRANT ALL ON TABLE "public"."assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."assignments" TO "service_role";



GRANT ALL ON FUNCTION "public"."can_manage_assignment"("a" "public"."assignments") TO "anon";
GRANT ALL ON FUNCTION "public"."can_manage_assignment"("a" "public"."assignments") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_manage_assignment"("a" "public"."assignments") TO "service_role";



GRANT ALL ON TABLE "public"."exams" TO "anon";
GRANT ALL ON TABLE "public"."exams" TO "authenticated";
GRANT ALL ON TABLE "public"."exams" TO "service_role";



GRANT ALL ON FUNCTION "public"."can_manage_exam"("e" "public"."exams") TO "anon";
GRANT ALL ON FUNCTION "public"."can_manage_exam"("e" "public"."exams") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_manage_exam"("e" "public"."exams") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_view_financials"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_view_financials"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_view_financials"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."clear_my_must_change_password"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."clear_my_must_change_password"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."clear_my_must_change_password"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_mistaken_student"("p_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_mistaken_student"("p_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_mistaken_student"("p_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_batch_name_rule"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_batch_name_rule"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_batch_name_rule"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."enroll_student"("p_student" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enroll_student"("p_student" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."enroll_student"("p_student" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."exam_attempts_no_forged_result"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."exam_attempts_no_forged_result"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."format_student_id"("p_code" "text", "p_number" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."format_student_id"("p_code" "text", "p_number" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_approved_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_approved_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_approved_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_staff_or_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_staff_or_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_staff_or_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_super_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."ist_today"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."lock_student_id_prefix"("p_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."lock_student_id_prefix"("p_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_financial_change"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_financial_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."my_batch"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_batch"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_batch"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."my_student_ref"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_student_ref"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_student_ref"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."notify_batch"("p_batch" "text", "p_type" "text", "p_title" "text", "p_body" "text", "p_link" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify_batch"("p_batch" "text", "p_type" "text", "p_title" "text", "p_body" "text", "p_link" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_batch"("p_batch" "text", "p_type" "text", "p_title" "text", "p_body" "text", "p_link" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."preview_batch_status_changes"("p_as_of" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."preview_batch_status_changes"("p_as_of" "date") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."preview_student_id"("p_batch" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."preview_student_id"("p_batch" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."preview_student_id"("p_batch" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."remove_bank_match_links"("p_line_id" bigint, "p_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."remove_bank_match_links"("p_line_id" bigint, "p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."remove_bank_match_links"("p_line_id" bigint, "p_status" "text") TO "service_role";



GRANT ALL ON TABLE "public"."assignment_submissions" TO "anon";
GRANT ALL ON TABLE "public"."assignment_submissions" TO "authenticated";
GRANT ALL ON TABLE "public"."assignment_submissions" TO "service_role";



REVOKE ALL ON FUNCTION "public"."resubmit_assignment"("p_assignment_id" "uuid", "p_link" "text", "p_notes" "text", "p_file_path" "text", "p_is_late" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resubmit_assignment"("p_assignment_id" "uuid", "p_link" "text", "p_notes" "text", "p_file_path" "text", "p_is_late" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."resubmit_assignment"("p_assignment_id" "uuid", "p_link" "text", "p_notes" "text", "p_file_path" "text", "p_is_late" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rls_auto_enable"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."run_batch_status_automation"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."run_batch_status_automation"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."save_bank_match_links"("p_line_id" bigint, "p_links" "jsonb", "p_source" "text", "p_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_bank_match_links"("p_line_id" bigint, "p_links" "jsonb", "p_source" "text", "p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_bank_match_links"("p_line_id" bigint, "p_links" "jsonb", "p_source" "text", "p_status" "text") TO "service_role";



GRANT ALL ON TABLE "public"."exam_attempts" TO "anon";
GRANT ALL ON TABLE "public"."exam_attempts" TO "authenticated";
GRANT ALL ON TABLE "public"."exam_attempts" TO "service_role";



REVOKE ALL ON FUNCTION "public"."score_exam_attempt"("p_attempt" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."score_exam_attempt"("p_attempt" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."score_exam_attempt"("p_attempt" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."session_in_my_batch"("p_session" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."session_in_my_batch"("p_session" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."session_in_my_batch"("p_session" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."student_id_next_number"("p_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."student_id_next_number"("p_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."student_id_prefix_for_batch"("p_batch" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."student_id_prefix_for_batch"("p_batch" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."students_fee_guard"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."students_fee_guard"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."students_follow_batch_dates"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."students_id_immutable"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."students_id_immutable"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_bank_entries"("p_run_id" "uuid", "p_items" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_bank_entries"("p_run_id" "uuid", "p_items" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_bank_entries"("p_run_id" "uuid", "p_items" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."teaches_batch"("b" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."teaches_batch"("b" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."teaches_batch"("b" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."timetable_no_conflict"() TO "anon";
GRANT ALL ON FUNCTION "public"."timetable_no_conflict"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."timetable_no_conflict"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."undo_bank_sync"("p_run_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."undo_bank_sync"("p_run_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."undo_bank_sync"("p_run_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."app_settings" TO "anon";
GRANT ALL ON TABLE "public"."app_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."app_settings" TO "service_role";



GRANT ALL ON TABLE "public"."attendance" TO "anon";
GRANT ALL ON TABLE "public"."attendance" TO "authenticated";
GRANT ALL ON TABLE "public"."attendance" TO "service_role";



GRANT ALL ON TABLE "public"."audit_log" TO "anon";
GRANT ALL ON TABLE "public"."audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."audit_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."audit_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."audit_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."bank_match_links" TO "anon";
GRANT ALL ON TABLE "public"."bank_match_links" TO "authenticated";
GRANT ALL ON TABLE "public"."bank_match_links" TO "service_role";



GRANT ALL ON TABLE "public"."bank_statement_lines" TO "anon";
GRANT ALL ON TABLE "public"."bank_statement_lines" TO "authenticated";
GRANT ALL ON TABLE "public"."bank_statement_lines" TO "service_role";



GRANT ALL ON SEQUENCE "public"."bank_statement_lines_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."bank_statement_lines_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."bank_statement_lines_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."bank_statements" TO "anon";
GRANT ALL ON TABLE "public"."bank_statements" TO "authenticated";
GRANT ALL ON TABLE "public"."bank_statements" TO "service_role";



GRANT ALL ON SEQUENCE "public"."bank_statements_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."bank_statements_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."bank_statements_id_seq" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."bank_sync_history" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."bank_sync_history" TO "authenticated";
GRANT ALL ON TABLE "public"."bank_sync_history" TO "service_role";



GRANT UPDATE("undone_at") ON TABLE "public"."bank_sync_history" TO "authenticated";



GRANT ALL ON TABLE "public"."batches" TO "anon";
GRANT ALL ON TABLE "public"."batches" TO "authenticated";
GRANT ALL ON TABLE "public"."batches" TO "service_role";



GRANT ALL ON SEQUENCE "public"."batches_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."batches_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."batches_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."collections" TO "anon";
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."collections" TO "authenticated";
GRANT ALL ON TABLE "public"."collections" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."collections" TO "authenticated";



GRANT ALL ON TABLE "public"."collections_basic" TO "anon";
GRANT ALL ON TABLE "public"."collections_basic" TO "authenticated";
GRANT ALL ON TABLE "public"."collections_basic" TO "service_role";



GRANT ALL ON SEQUENCE "public"."collections_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."collections_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."collections_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."courses" TO "anon";
GRANT ALL ON TABLE "public"."courses" TO "authenticated";
GRANT ALL ON TABLE "public"."courses" TO "service_role";



GRANT ALL ON SEQUENCE "public"."courses_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."courses_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."courses_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."exam_answers" TO "anon";
GRANT ALL ON TABLE "public"."exam_answers" TO "authenticated";
GRANT ALL ON TABLE "public"."exam_answers" TO "service_role";



GRANT ALL ON TABLE "public"."exam_questions" TO "anon";
GRANT ALL ON TABLE "public"."exam_questions" TO "authenticated";
GRANT ALL ON TABLE "public"."exam_questions" TO "service_role";



GRANT ALL ON TABLE "public"."exam_questions_public" TO "anon";
GRANT ALL ON TABLE "public"."exam_questions_public" TO "authenticated";
GRANT ALL ON TABLE "public"."exam_questions_public" TO "service_role";



GRANT ALL ON TABLE "public"."expense_categories" TO "anon";
GRANT ALL ON TABLE "public"."expense_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."expense_categories" TO "service_role";



GRANT ALL ON SEQUENCE "public"."expense_categories_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."expense_categories_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."expense_categories_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."expenses" TO "anon";
GRANT ALL ON TABLE "public"."expenses" TO "authenticated";
GRANT ALL ON TABLE "public"."expenses" TO "service_role";



GRANT ALL ON SEQUENCE "public"."expenses_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."expenses_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."expenses_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."faculty_batches" TO "anon";
GRANT ALL ON TABLE "public"."faculty_batches" TO "authenticated";
GRANT ALL ON TABLE "public"."faculty_batches" TO "service_role";



GRANT ALL ON TABLE "public"."faculty_reviews" TO "anon";
GRANT ALL ON TABLE "public"."faculty_reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."faculty_reviews" TO "service_role";



GRANT ALL ON TABLE "public"."live_sessions" TO "anon";
GRANT ALL ON TABLE "public"."live_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."live_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."students" TO "anon";
GRANT ALL ON TABLE "public"."students" TO "authenticated";
GRANT ALL ON TABLE "public"."students" TO "service_role";



GRANT ALL ON TABLE "public"."timetable_slots" TO "anon";
GRANT ALL ON TABLE "public"."timetable_slots" TO "authenticated";
GRANT ALL ON TABLE "public"."timetable_slots" TO "service_role";



GRANT ALL ON TABLE "public"."transfers" TO "anon";
GRANT ALL ON TABLE "public"."transfers" TO "authenticated";
GRANT ALL ON TABLE "public"."transfers" TO "service_role";



GRANT ALL ON SEQUENCE "public"."transfers_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."transfers_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."transfers_id_seq" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";








-- ------------------------------------------- B. outside the public schema
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

-- new auth user -> profile row
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- storage: private bucket for assignment submissions (10 MB, fixed MIME list)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('submissions', 'submissions', false, 10485760, array[
  'application/pdf','application/zip','application/x-zip-compressed','application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png','image/jpeg','text/plain','text/csv'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy submissions_read on storage.objects as permissive for select to authenticated
  using (((bucket_id = 'submissions'::text) AND (((storage.foldername(name))[2] = (auth.uid())::text) OR public.is_staff_or_admin() OR (EXISTS ( SELECT 1
   FROM public.assignments a
  WHERE (((a.id)::text = (storage.foldername(objects.name))[1]) AND public.can_manage_assignment(a.*)))))));
create policy submissions_student_update on storage.objects as permissive for update to authenticated
  using (((bucket_id = 'submissions'::text) AND ((storage.foldername(name))[2] = (auth.uid())::text)));
create policy submissions_student_write on storage.objects as permissive for insert to authenticated
  with check (((bucket_id = 'submissions'::text) AND ((storage.foldername(name))[2] = (auth.uid())::text)));

-- nightly batch status automation (18:35 UTC = 00:05 IST)
create extension if not exists pg_cron;
select cron.schedule('batch-auto-student-status', '35 18 * * *', 'select public.run_batch_status_automation();');

-- NOT included on purpose: event trigger ensure_rls -> rls_auto_enable() exists only on
-- production (Supabase-created); documented as known drift in docs/saas.

-- --------------------------------------------------------- C. exact privileges
-- pg_dump relies on default privileges and does not record revocations, so a fresh
-- database would be far more open than production (e.g. anon could run every function,
-- students could read raw collections). These statements are generated from the live ACLs
-- (scripts/db/generate-grants.sql) and make every environment identical.
revoke all on table public.app_settings from public, anon, authenticated, service_role;
revoke all on table public.assignment_submissions from public, anon, authenticated, service_role;
revoke all on table public.assignments from public, anon, authenticated, service_role;
revoke all on table public.attendance from public, anon, authenticated, service_role;
revoke all on table public.audit_log from public, anon, authenticated, service_role;
revoke all on table public.bank_match_links from public, anon, authenticated, service_role;
revoke all on table public.bank_statement_lines from public, anon, authenticated, service_role;
revoke all on table public.bank_statements from public, anon, authenticated, service_role;
revoke all on table public.bank_sync_history from public, anon, authenticated, service_role;
revoke all on table public.batches from public, anon, authenticated, service_role;
revoke all on table public.collections from public, anon, authenticated, service_role;
revoke all on table public.collections_basic from public, anon, authenticated, service_role;
revoke all on table public.courses from public, anon, authenticated, service_role;
revoke all on table public.exam_answers from public, anon, authenticated, service_role;
revoke all on table public.exam_attempts from public, anon, authenticated, service_role;
revoke all on table public.exam_questions from public, anon, authenticated, service_role;
revoke all on table public.exam_questions_public from public, anon, authenticated, service_role;
revoke all on table public.exams from public, anon, authenticated, service_role;
revoke all on table public.expense_categories from public, anon, authenticated, service_role;
revoke all on table public.expenses from public, anon, authenticated, service_role;
revoke all on table public.faculty_batches from public, anon, authenticated, service_role;
revoke all on table public.faculty_reviews from public, anon, authenticated, service_role;
revoke all on table public.live_sessions from public, anon, authenticated, service_role;
revoke all on table public.notifications from public, anon, authenticated, service_role;
revoke all on table public.profiles from public, anon, authenticated, service_role;
revoke all on table public.students from public, anon, authenticated, service_role;
revoke all on table public.timetable_slots from public, anon, authenticated, service_role;
revoke all on table public.transfers from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.app_settings to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.app_settings to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.app_settings to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.assignment_submissions to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.assignment_submissions to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.assignment_submissions to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.assignments to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.assignments to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.assignments to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.attendance to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.attendance to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.attendance to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.audit_log to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.audit_log to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.audit_log to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.bank_match_links to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.bank_match_links to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.bank_match_links to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.bank_statement_lines to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.bank_statement_lines to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.bank_statement_lines to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.bank_statements to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.bank_statements to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.bank_statements to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE on table public.bank_sync_history to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE on table public.bank_sync_history to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.bank_sync_history to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.batches to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.batches to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.batches to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.collections_basic to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.collections_basic to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.collections_basic to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.collections to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE, UPDATE on table public.collections to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.collections to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.courses to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.courses to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.courses to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.exam_answers to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.exam_answers to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.exam_answers to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.exam_attempts to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.exam_attempts to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.exam_attempts to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.exam_questions_public to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.exam_questions_public to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.exam_questions_public to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.exam_questions to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.exam_questions to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.exam_questions to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.exams to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.exams to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.exams to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.expense_categories to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.expense_categories to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.expense_categories to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.expenses to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.expenses to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.expenses to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.faculty_batches to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.faculty_batches to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.faculty_batches to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.faculty_reviews to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.faculty_reviews to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.faculty_reviews to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.live_sessions to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.live_sessions to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.live_sessions to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.notifications to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.notifications to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.notifications to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.profiles to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.profiles to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.profiles to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.students to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.students to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.students to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.timetable_slots to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.timetable_slots to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.timetable_slots to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.transfers to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.transfers to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.transfers to service_role;
grant UPDATE(undone_at) on table public.bank_sync_history to authenticated;
grant SELECT(id) on table public.collections to authenticated;
revoke all on function public.allocate_student_id(text) from public, anon, authenticated, service_role;
revoke all on function public.assignment_submissions_no_self_grade() from public, anon, authenticated, service_role;
revoke all on function public.bank_match_links_check_book() from public, anon, authenticated, service_role;
revoke all on function public.bank_match_links_cleanup_book() from public, anon, authenticated, service_role;
revoke all on function public.bank_match_links_set_account() from public, anon, authenticated, service_role;
revoke all on function public.batch_status_data_issues() from public, anon, authenticated, service_role;
revoke all on function public.batch_status_for(text,date,date,date) from public, anon, authenticated, service_role;
revoke all on function public.batch_status_targets(date) from public, anon, authenticated, service_role;
revoke all on function public.batches_fee_guard() from public, anon, authenticated, service_role;
revoke all on function public.batches_resync_students() from public, anon, authenticated, service_role;
revoke all on function public.bulk_upsert_students(jsonb,boolean,boolean) from public, anon, authenticated, service_role;
revoke all on function public.can_manage_assignment(public.assignments) from public, anon, authenticated, service_role;
revoke all on function public.can_manage_exam(public.exams) from public, anon, authenticated, service_role;
revoke all on function public.can_view_financials() from public, anon, authenticated, service_role;
revoke all on function public.clear_my_must_change_password() from public, anon, authenticated, service_role;
revoke all on function public.delete_mistaken_student(text) from public, anon, authenticated, service_role;
revoke all on function public.enforce_batch_name_rule() from public, anon, authenticated, service_role;
revoke all on function public.enroll_student(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.exam_attempts_no_forged_result() from public, anon, authenticated, service_role;
revoke all on function public.format_student_id(text,numeric) from public, anon, authenticated, service_role;
revoke all on function public.handle_new_user() from public, anon, authenticated, service_role;
revoke all on function public.is_admin() from public, anon, authenticated, service_role;
revoke all on function public.is_approved_user() from public, anon, authenticated, service_role;
revoke all on function public.is_staff_or_admin() from public, anon, authenticated, service_role;
revoke all on function public.is_super_admin() from public, anon, authenticated, service_role;
revoke all on function public.ist_today() from public, anon, authenticated, service_role;
revoke all on function public.lock_student_id_prefix(text) from public, anon, authenticated, service_role;
revoke all on function public.log_financial_change() from public, anon, authenticated, service_role;
revoke all on function public.my_batch() from public, anon, authenticated, service_role;
revoke all on function public.my_student_ref() from public, anon, authenticated, service_role;
revoke all on function public.notify_batch(text,text,text,text,text) from public, anon, authenticated, service_role;
revoke all on function public.preview_batch_status_changes(date) from public, anon, authenticated, service_role;
revoke all on function public.preview_student_id(text) from public, anon, authenticated, service_role;
revoke all on function public.remove_bank_match_links(bigint,text) from public, anon, authenticated, service_role;
revoke all on function public.resubmit_assignment(uuid,text,text,text,boolean) from public, anon, authenticated, service_role;
revoke all on function public.rls_auto_enable() from public, anon, authenticated, service_role;
revoke all on function public.run_batch_status_automation() from public, anon, authenticated, service_role;
revoke all on function public.save_bank_match_links(bigint,jsonb,text,text) from public, anon, authenticated, service_role;
revoke all on function public.score_exam_attempt(uuid) from public, anon, authenticated, service_role;
revoke all on function public.session_in_my_batch(uuid) from public, anon, authenticated, service_role;
revoke all on function public.student_id_next_number(text) from public, anon, authenticated, service_role;
revoke all on function public.student_id_prefix_for_batch(text) from public, anon, authenticated, service_role;
revoke all on function public.students_fee_guard() from public, anon, authenticated, service_role;
revoke all on function public.students_follow_batch_dates() from public, anon, authenticated, service_role;
revoke all on function public.students_id_immutable() from public, anon, authenticated, service_role;
revoke all on function public.sync_bank_entries(uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.teaches_batch(text) from public, anon, authenticated, service_role;
revoke all on function public.timetable_no_conflict() from public, anon, authenticated, service_role;
revoke all on function public.undo_bank_sync(uuid) from public, anon, authenticated, service_role;
grant execute on function public.allocate_student_id(text) to service_role;
grant execute on function public.assignment_submissions_no_self_grade() to service_role;
grant execute on function public.bank_match_links_check_book() to public;
grant execute on function public.bank_match_links_check_book() to anon;
grant execute on function public.bank_match_links_check_book() to authenticated;
grant execute on function public.bank_match_links_check_book() to service_role;
grant execute on function public.bank_match_links_cleanup_book() to service_role;
grant execute on function public.bank_match_links_set_account() to public;
grant execute on function public.bank_match_links_set_account() to anon;
grant execute on function public.bank_match_links_set_account() to authenticated;
grant execute on function public.bank_match_links_set_account() to service_role;
grant execute on function public.batch_status_data_issues() to authenticated;
grant execute on function public.batches_fee_guard() to service_role;
grant execute on function public.bulk_upsert_students(jsonb,boolean,boolean) to authenticated;
grant execute on function public.bulk_upsert_students(jsonb,boolean,boolean) to service_role;
grant execute on function public.can_manage_assignment(public.assignments) to public;
grant execute on function public.can_manage_assignment(public.assignments) to anon;
grant execute on function public.can_manage_assignment(public.assignments) to authenticated;
grant execute on function public.can_manage_assignment(public.assignments) to service_role;
grant execute on function public.can_manage_exam(public.exams) to public;
grant execute on function public.can_manage_exam(public.exams) to anon;
grant execute on function public.can_manage_exam(public.exams) to authenticated;
grant execute on function public.can_manage_exam(public.exams) to service_role;
grant execute on function public.can_view_financials() to authenticated;
grant execute on function public.can_view_financials() to service_role;
grant execute on function public.clear_my_must_change_password() to authenticated;
grant execute on function public.clear_my_must_change_password() to service_role;
grant execute on function public.delete_mistaken_student(text) to authenticated;
grant execute on function public.delete_mistaken_student(text) to service_role;
grant execute on function public.enforce_batch_name_rule() to public;
grant execute on function public.enforce_batch_name_rule() to anon;
grant execute on function public.enforce_batch_name_rule() to authenticated;
grant execute on function public.enforce_batch_name_rule() to service_role;
grant execute on function public.enroll_student(jsonb) to authenticated;
grant execute on function public.enroll_student(jsonb) to service_role;
grant execute on function public.exam_attempts_no_forged_result() to service_role;
grant execute on function public.format_student_id(text,numeric) to service_role;
grant execute on function public.handle_new_user() to service_role;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_admin() to service_role;
grant execute on function public.is_approved_user() to authenticated;
grant execute on function public.is_approved_user() to service_role;
grant execute on function public.is_staff_or_admin() to authenticated;
grant execute on function public.is_staff_or_admin() to service_role;
grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.is_super_admin() to service_role;
grant execute on function public.lock_student_id_prefix(text) to service_role;
grant execute on function public.log_financial_change() to service_role;
grant execute on function public.my_batch() to authenticated;
grant execute on function public.my_batch() to service_role;
grant execute on function public.my_student_ref() to authenticated;
grant execute on function public.my_student_ref() to service_role;
grant execute on function public.notify_batch(text,text,text,text,text) to authenticated;
grant execute on function public.notify_batch(text,text,text,text,text) to service_role;
grant execute on function public.preview_batch_status_changes(date) to authenticated;
grant execute on function public.preview_student_id(text) to authenticated;
grant execute on function public.preview_student_id(text) to service_role;
grant execute on function public.remove_bank_match_links(bigint,text) to authenticated;
grant execute on function public.remove_bank_match_links(bigint,text) to service_role;
grant execute on function public.resubmit_assignment(uuid,text,text,text,boolean) to authenticated;
grant execute on function public.resubmit_assignment(uuid,text,text,text,boolean) to service_role;
grant execute on function public.rls_auto_enable() to service_role;
grant execute on function public.run_batch_status_automation() to authenticated;
grant execute on function public.save_bank_match_links(bigint,jsonb,text,text) to authenticated;
grant execute on function public.save_bank_match_links(bigint,jsonb,text,text) to service_role;
grant execute on function public.score_exam_attempt(uuid) to authenticated;
grant execute on function public.score_exam_attempt(uuid) to service_role;
grant execute on function public.session_in_my_batch(uuid) to authenticated;
grant execute on function public.session_in_my_batch(uuid) to service_role;
grant execute on function public.student_id_next_number(text) to service_role;
grant execute on function public.student_id_prefix_for_batch(text) to service_role;
grant execute on function public.students_fee_guard() to service_role;
grant execute on function public.students_id_immutable() to service_role;
grant execute on function public.sync_bank_entries(uuid,jsonb) to authenticated;
grant execute on function public.sync_bank_entries(uuid,jsonb) to service_role;
grant execute on function public.teaches_batch(text) to authenticated;
grant execute on function public.teaches_batch(text) to service_role;
grant execute on function public.timetable_no_conflict() to public;
grant execute on function public.timetable_no_conflict() to anon;
grant execute on function public.timetable_no_conflict() to authenticated;
grant execute on function public.timetable_no_conflict() to service_role;
grant execute on function public.undo_bank_sync(uuid) to authenticated;
grant execute on function public.undo_bank_sync(uuid) to service_role;
