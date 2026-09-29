-- ============================================================
-- Migration 27: bulk create/update of students from an Excel upload
-- ============================================================
-- Run ONCE in the Supabase SQL Editor, after 26. Incremental, one purpose:
-- it adds a single RPC, bulk_upsert_students(), and changes no tables.
--
-- Contract
--   bulk_upsert_students(p_rows jsonb, p_dry_run boolean default true,
--                        p_confirm_blanks boolean default false) -> jsonb
--   * p_rows: JSON array (max 2000) of objects with keys
--       row (Excel row number, for messages), id, name, course, batch, status,
--       student_phone, student_email, parent_name, parent_phone, place,
--       address, registration_fee, course_fee, exam_fee, other_fee, waiver.
--   * Rows are matched to existing students by Student ID (trimmed,
--     case-insensitive). No match = a NEW student with that manual ID.
--   * dry_run = true  -> validates everything, writes nothing, returns the
--     preview: { updates, new, unchanged, errors, warnings, blank_overwrites,
--     rows: [{ row, id, action, errors[], warnings[] }] }.
--   * dry_run = false -> same validation, then applies ALL rows in this one
--     function call (= one transaction). Any error, or blank cells that
--     would clear existing values without p_confirm_blanks = true, raises and
--     rolls the whole upload back.
--
-- Rules enforced here (the browser's checks are a courtesy only)
--   * Owner/Admin only (is_admin()). Executive/staff, faculty and students are
--     refused, however they call it.
--   * Student ID, status and batch can never be changed by an upload: they are
--     not in the UPDATE's SET list. A file value that differs is reported as a
--     warning and ignored. (The id is also protected by the migration-26
--     trigger.)
--   * NEW students: ID must be <course code><digits> for the batch's course,
--     digits canonical (3 digits, or 4-9 digits with no leading zero — the
--     same shape format_student_id() produces); batch is required and must
--     exist; status is forced to 'Registered'; enrollment_date = today;
--     course defaults to the batch's course.
--   * A duplicate ID inside the file (every occurrence is flagged) is an
--     error. An ID already in the database is simply an update, so it can
--     never be inserted twice; the primary key backs this up.
--   * Blank cells overwrite: for an existing student a blank text cell clears
--     the stored value and a blank fee cell sets it to 0. Each such cell is
--     counted in blank_overwrites and shown as a warning; applying requires
--     p_confirm_blanks = true.
--   * Field validation mirrors the table CHECKs (10-digit phones, e-mail
--     shape) plus length limits and fees >= 0 with at most 2 decimals.
--   * The auto-ID "counter" is the highest number already in public.students
--     (see migration 26), so inserting a manual ID advances it with no extra
--     state and can never cause a later duplicate. Apply takes the per-prefix
--     advisory lock (lock_student_id_prefix) for every course touched, in
--     sorted order, so it serializes with enroll_student() without deadlock.
--   * created_by / updated_by come from auth.uid(), never from the payload.
--   * Apply writes ONE audit_log row (table 'students', row_id 0, action
--     'update' — the only non-delete value the table allows) listing the IDs
--     inserted and updated.
--
-- SECURITY DEFINER, search_path pinned to public, role re-checked inside,
-- EXECUTE revoked from public/anon.
--
-- Single-tenant assumption: one academy per database, so "admin" means an
-- admin of THE academy and IDs/course codes are unique table-wide.
--
-- Rollback (no data is changed by this migration):
--   drop function if exists public.bulk_upsert_students(jsonb, boolean, boolean);
-- ------------------------------------------------------------

begin;

create or replace function public.bulk_upsert_students(
  p_rows jsonb,
  p_dry_run boolean default true,
  p_confirm_blanks boolean default false
)
returns jsonb
language plpgsql volatile security definer set search_path = public
as $$
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
$$;

revoke all on function public.bulk_upsert_students(jsonb, boolean, boolean) from public, anon;
grant execute on function public.bulk_upsert_students(jsonb, boolean, boolean) to authenticated;

commit;
