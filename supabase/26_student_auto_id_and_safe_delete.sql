-- ============================================================
-- Migration 26: auto-assigned Student ID + safe delete of mistaken enrolments
-- ============================================================
-- Run ONCE in the Supabase SQL Editor, after 25.
--
-- Student ID rule (Phase D):
--   ID = course code + number, zero-padded to at least 3 digits
--   (DBHM117, ODHM016; past 999 it simply grows: DBHM1000).
--   The course code comes from courses.code, found via
--   batches.course_name = courses.name (both sides trimmed — a legacy row
--   has a trailing space; no data is modified here).
--   Next number = highest existing number for that prefix + 1. Gaps are
--   never filled. There is no counter table: the "counter" is always the
--   highest ID already in public.students, so any ID inserted another way
--   (e.g. the later Excel upload with manual IDs) automatically advances it.
--
-- Future course codes: avoid a code that is another code plus digits
-- (e.g. DB and DB1). "DB1005" would then count as DB number 1005, pushing
-- DB's counter higher than expected. It can never produce a duplicate (the
-- primary key forbids that); DBHM/ODHM don't overlap today.
--
-- Uniqueness is guaranteed by the database, never the frontend:
--   * students.id stays the primary key (a duplicate can never be stored);
--   * enroll_student() takes a per-prefix transaction advisory lock before
--     reading the highest number and holds it until its INSERT commits, so
--     two simultaneous enrolments into the same course serialize and get
--     consecutive IDs instead of one failing. Different prefixes don't block
--     each other.
--   * Verification note: the advisory-lock serialization was verified by
--     design/code review (standard pg_advisory_xact_lock semantics), NOT by
--     a true parallel-session test — the Phase D environment had no
--     dblink/psql/CLI access. Staging tests confirmed sequential enrolments
--     get distinct, consecutive IDs; watch for duplicate-key errors on
--     students_pkey after go-live.
--   * A later bulk upload must allocate through allocate_student_id() (or
--     call lock_student_id_prefix() before inserting a manual ID) so it
--     serializes with the enrolment form.
--
-- Student IDs are immutable: a trigger rejects any UPDATE that changes
-- students.id (editing a student never changes the ID).
--
-- Safe delete (mistake correction): delete_mistaken_student() —
--   Owner/Admin only (is_admin()), status must be 'Registered', and the
--   student must have no linked records:
--     * collections.student_id          (fee receipts, FK)
--     * audit_log rows for collections   (a receipt that was since deleted)
--     * profiles.student_ref            (a linked login, FK). attendance,
--       exam_attempts, assignment_submissions, faculty_reviews and
--       notifications all hang off that login's profiles.id — never off
--       students.id — so a student without a linked login cannot own any.
--   Otherwise it refuses and suggests setting the status to Dropped.
--   There is still NO DELETE policy on public.students: the RPC is the only
--   way to delete a row as an app user. Dropped students keep their record
--   and ID forever.
--
-- SECURITY DEFINER functions: all pin search_path = public, re-check the
-- caller's role explicitly (they bypass RLS), and the internal helpers have
-- EXECUTE revoked from every client role.
--
-- Single-tenant assumption: one academy per database, so course codes and
-- Student IDs are unique across the whole table and "Admin/staff" means
-- staff of THE academy. Multi-tenancy would need academy_id in the lock key,
-- the max() scan, and the role checks.
--
-- Rollback (no data is changed by this migration, so this is clean; revert
-- the frontend to the previous release at the same time — it inserts
-- students directly with a typed ID):
--   drop function if exists public.delete_mistaken_student(text);
--   drop function if exists public.enroll_student(jsonb);
--   drop function if exists public.preview_student_id(text);
--   drop function if exists public.allocate_student_id(text);
--   drop function if exists public.lock_student_id_prefix(text);
--   drop function if exists public.student_id_next_number(text);
--   drop function if exists public.format_student_id(text, numeric);
--   drop function if exists public.student_id_prefix_for_batch(text);
--   drop trigger if exists students_id_immutable on public.students;
--   drop function if exists public.students_id_immutable();
-- ------------------------------------------------------------

begin;

-- ---------- 1. Course code for a batch (raises a clear message if none) ----------
create or replace function public.student_id_prefix_for_batch(p_batch text)
returns text
language plpgsql stable security definer set search_path = public
as $$
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

-- ---------- 2. Formatting + highest-number lookup ----------
-- lpad() would TRUNCATE numbers longer than 3 digits, so only pad short ones.
create or replace function public.format_student_id(p_code text, p_number numeric)
returns text
language sql immutable set search_path = public
as $$
  select p_code || case
    when length(p_number::text) < 3 then lpad(p_number::text, 3, '0')
    else p_number::text
  end;
$$;

-- Highest number + 1 among IDs of the exact form <code><digits>. Compared
-- trimmed/upper-cased so a stray lower-case or padded legacy ID still counts.
-- Prefix matched with left() rather than a regex so a code can never be
-- read as a pattern.
create or replace function public.student_id_next_number(p_code text)
returns numeric
language sql stable set search_path = public
as $$
  select coalesce(max(substr(upper(btrim(s.id)), length(p_code) + 1)::numeric), 0) + 1
  from public.students s
  where left(upper(btrim(s.id)), length(p_code)) = p_code
    and substr(upper(btrim(s.id)), length(p_code) + 1) ~ '^[0-9]+$';
$$;

-- ---------- 3. Per-prefix lock + allocation (reusable by bulk upload) ----------
-- Transaction-scoped: released automatically at COMMIT/ROLLBACK, i.e. only
-- after the INSERT using the allocated ID is visible to the next caller.
create or replace function public.lock_student_id_prefix(p_code text)
returns void
language sql volatile set search_path = public
as $$
  select pg_advisory_xact_lock(hashtext('public.students.id'), hashtext(p_code));
$$;

-- Must be called inside the transaction that inserts the returned ID.
create or replace function public.allocate_student_id(p_code text)
returns text
language plpgsql volatile set search_path = public
as $$
begin
  if p_code is null or btrim(p_code) = '' then
    raise exception 'A course code is required to allocate a Student ID.';
  end if;
  perform public.lock_student_id_prefix(p_code);
  return public.format_student_id(p_code, public.student_id_next_number(p_code));
end;
$$;

-- ---------- 4. Preview (read-only, no lock) ----------
-- Shown in the enrolment form once a batch is picked. Only a preview: the
-- final ID is allocated by enroll_student() at save time and can differ if
-- someone else enrols into the same course first.
create or replace function public.preview_student_id(p_batch text)
returns text
language plpgsql stable security definer set search_path = public
as $$
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

-- ---------- 5. Enrol: allocate the ID and insert in one transaction ----------
-- Any "id" in the payload is ignored. created_by/updated_by come from the
-- session (auth.uid()), not the client. Table CHECK constraints (status,
-- phone/email formats, guardian relation) and the batch FK still apply.
-- SECURITY DEFINER bypasses RLS, so the insert policy's rule
-- (students_staff_insert: is_staff_or_admin()) is re-checked here.
create or replace function public.enroll_student(p_student jsonb)
returns text
language plpgsql volatile security definer set search_path = public
as $$
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

-- ---------- 6. Student IDs never change ----------
create or replace function public.students_id_immutable()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'A Student ID can never be changed (% -> %).', old.id, new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists students_id_immutable on public.students;
create trigger students_id_immutable
  before update of id on public.students
  for each row execute function public.students_id_immutable();

-- ---------- 7. Safe delete of a mistaken enrolment ----------
create or replace function public.delete_mistaken_student(p_id text)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  s public.students;
  v_blockers text[] := '{}';
begin
  if not public.is_admin() then
    raise exception 'Only the Owner or an Admin can delete a student record.'
      using errcode = '42501';
  end if;

  -- Row lock first: a concurrent fee receipt insert (which needs a KEY SHARE
  -- lock on this row for its FK) either finishes before our checks run or
  -- waits and then fails its FK after the delete.
  select * into s from public.students where id = p_id for update;
  if not found then
    raise exception 'Student "%" was not found.', p_id;
  end if;

  if s.status is distinct from 'Registered' then
    raise exception 'Student % is "%". Only a Registered enrolment made by mistake can be deleted — set the status to Dropped instead.',
      s.id, s.status;
  end if;

  if exists (select 1 from public.collections c where c.student_id = s.id) then
    v_blockers := v_blockers || 'fee receipts'::text;
  end if;
  if exists (
    select 1 from public.audit_log a
    where a.table_name = 'collections'
      and (a.old_row->>'student_id' = s.id or a.new_row->>'student_id' = s.id)
  ) then
    v_blockers := v_blockers || 'fee receipt history'::text;
  end if;
  if exists (select 1 from public.profiles p where p.student_ref = s.id) then
    v_blockers := v_blockers || 'a linked student login (attendance, exams, assignments, reviews)'::text;
  end if;

  if array_length(v_blockers, 1) > 0 then
    raise exception 'Student % cannot be deleted because it has %. Set the status to Dropped instead.',
      s.id, array_to_string(v_blockers, ', ');
  end if;

  -- Leave a trace. audit_log.row_id is bigint and student IDs are text, so
  -- row_id is 0 here and the ID is in old_row->>'id'.
  insert into public.audit_log (table_name, row_id, action, old_row, new_row, changed_by)
  values ('students', 0, 'delete', to_jsonb(s), null, auth.uid());

  delete from public.students where id = s.id;
end;
$$;

-- ---------- 8. Privileges ----------
-- Internal helpers: callable only from the functions above (they run as the
-- function owner), never directly by a client.
revoke all on function public.student_id_prefix_for_batch(text) from public, anon, authenticated;
revoke all on function public.format_student_id(text, numeric) from public, anon, authenticated;
revoke all on function public.student_id_next_number(text) from public, anon, authenticated;
revoke all on function public.lock_student_id_prefix(text) from public, anon, authenticated;
revoke all on function public.allocate_student_id(text) from public, anon, authenticated;
revoke all on function public.students_id_immutable() from public, anon, authenticated;

-- Client RPCs: signed-in users only; role checked inside each function.
revoke all on function public.preview_student_id(text) from public, anon;
revoke all on function public.enroll_student(jsonb) from public, anon;
revoke all on function public.delete_mistaken_student(text) from public, anon;
grant execute on function public.preview_student_id(text) to authenticated;
grant execute on function public.enroll_student(jsonb) to authenticated;
grant execute on function public.delete_mistaken_student(text) to authenticated;

commit;
