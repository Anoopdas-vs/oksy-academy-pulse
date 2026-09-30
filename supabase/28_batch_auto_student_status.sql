-- ============================================================
-- Migration 28: student status follows batch start/end dates
-- ============================================================
-- Run ONCE in the Supabase SQL Editor, after 27. Incremental, one purpose:
-- it adds functions and two triggers and changes no tables, columns, RLS
-- policies or existing functions. Run 28b (a separate file) afterwards to
-- switch the triggers on and schedule the nightly job.
--
-- SAFE BY DEFAULT: both triggers are created DISABLED and nothing is
-- scheduled, so applying this file changes no data. That is deliberate for
-- production: apply 28, review preview_batch_status_changes(), get approval,
-- then apply 28b.
--
-- The rule (India date, Asia/Kolkata, never UTC), per student:
--     today <  start_date                       -> Registered
--     start_date <= today < end_date (or no end) -> Active
--     today >= end_date                         -> Completed   (end day itself)
--   * 'Dropped' is NEVER changed by anything here.
--   * A batch with no start_date is skipped (its end_date is ignored).
--   * A batch with end_date < start_date (bad data) is skipped; the
--     batch_status_data_issues() function lists them.
--   * A 'Completed' student in a batch with NO end_date is left alone.
--   * It is a state, not a step: a Registered student in an already-ended
--     batch goes straight to Completed, and the rule works in both
--     directions (an extended end date turns Completed back to Active, a
--     start date moved later turns Active back to Registered). That also
--     makes every entry point idempotent: applying it twice changes nothing.
--   * Manual status edits are enforced too (see the students trigger): the
--     only status a person can effectively set is 'Dropped'. Setting any
--     other status simply re-derives it from the batch dates. Un-dropping
--     works the same way: set any non-Dropped status and it is recomputed.
--
-- Pieces
--   ist_today()                         today's India date
--   batch_status_for(status,start,end,today)
--                                       the rule, one pure function used by
--                                       everything below
--   batch_status_targets(p_today)       every student whose status differs
--                                       from the rule (internal)
--   preview_batch_status_changes(p_as_of)   READ-ONLY dry run, reverts
--                                       included (is_revert = true)
--   batch_status_data_issues()          batches skipped for end < start
--   run_batch_status_automation()       full re-sync now; ONE audit_log row
--   students_follow_batch_dates()       BEFORE INSERT/UPDATE OF batch,status
--                                       trigger on students: corrects the row
--                                       before it is stored; logs (one row per
--                                       student) only when it overrides the
--                                       status that was supplied
--   batches_resync_students()           AFTER UPDATE OF start_date,end_date
--                                       trigger on batches: re-syncs that
--                                       batch's students; ONE audit_log row
--                                       per event that changed anyone
--   All audit rows: table 'students', row_id 0, action 'update' (the only
--   non-delete value that table allows), new_row.batch_status_automation = true.
--
-- Security
--   * preview / issues / run are SECURITY DEFINER, search_path pinned, and
--     re-check the caller INSIDE the body: is_admin() (Owner/Admin) or the
--     database scheduler (session_user = 'postgres' with no JWT — pg_cron or an
--     operator in the SQL Editor). PostgREST requests always have session_user
--     'authenticator', so staff, faculty, students and service_role are
--     refused. (session_user, because current_user is the owner inside a
--     SECURITY DEFINER function.)
--   * EXECUTE is revoked from public, anon and service_role (Supabase grants it
--     to all three by default); the three callable functions are granted to
--     authenticated only, which the in-body check narrows to admins. The
--     internal helpers and trigger functions have EXECUTE revoked from every
--     API role (a trigger fires without the invoker holding EXECUTE).
--   * The triggers are SECURITY DEFINER so a staff (Executive) edit of a batch
--     date or enrolment can re-derive statuses. Staff cannot choose a status
--     through this path — it is computed from the dates — and every change is
--     logged with changed_by = the acting user.
--   * updated_by comes from auth.uid() (NULL for the scheduler), never from any
--     caller-supplied value. An advisory lock stops two runs overlapping.
--
-- Rollback (nothing else depends on this migration; statuses already changed
-- are NOT undone — each audit_log row lists student IDs and old/new status):
--   drop trigger if exists students_follow_batch_dates on public.students;
--   drop trigger if exists batches_resync_students on public.batches;
--   drop function if exists public.students_follow_batch_dates();
--   drop function if exists public.batches_resync_students();
--   drop function if exists public.run_batch_status_automation();
--   drop function if exists public.batch_status_data_issues();
--   drop function if exists public.preview_batch_status_changes(date);
--   drop function if exists public.batch_status_targets(date);
--   drop function if exists public.batch_status_for(text, date, date, date);
--   drop function if exists public.ist_today();
--
-- Single-tenant assumption: one academy per database.
-- ============================================================

begin;

create or replace function public.ist_today()
returns date
language sql stable
as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- The rule. Returns the status the student SHOULD have (the input status when
-- the rule does not apply).
create or replace function public.batch_status_for(
  p_status text, p_start date, p_end date, p_today date)
returns text
language sql immutable
as $$
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

create or replace function public.batch_status_targets(p_today date)
returns table (
  student_id text, student_name text, batch text,
  old_status text, new_status text,
  batch_start date, batch_end date
)
language sql stable security definer set search_path = public
as $$
  select s.id, s.name, s.batch, s.status, f.new_status, b.start_date, b.end_date
  from public.students s
  join public.batches b on b.name = s.batch
  cross join lateral (
    select public.batch_status_for(s.status, b.start_date, b.end_date, p_today) as new_status
  ) f
  where f.new_status is distinct from s.status
  order by s.batch, s.id;
$$;

-- ---------------- dry run ----------------
create or replace function public.preview_batch_status_changes(p_as_of date default null)
returns table (
  student_id text, student_name text, batch text,
  old_status text, new_status text,
  batch_start date, batch_end date, is_revert boolean
)
language plpgsql stable security definer set search_path = public
as $$
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

create or replace function public.batch_status_data_issues()
returns table (batch text, start_date date, end_date date, students bigint)
language plpgsql stable security definer set search_path = public
as $$
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

-- ---------------- the run ----------------
create or replace function public.run_batch_status_automation()
returns jsonb
language plpgsql security definer set search_path = public
as $$
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

-- ---------------- triggers ----------------
create or replace function public.students_follow_batch_dates()
returns trigger
language plpgsql security definer set search_path = public
as $$
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

create or replace function public.batches_resync_students()
returns trigger
language plpgsql security definer set search_path = public
as $$
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

drop trigger if exists students_follow_batch_dates on public.students;
create trigger students_follow_batch_dates
  before insert or update of batch, status on public.students
  for each row execute function public.students_follow_batch_dates();

drop trigger if exists batches_resync_students on public.batches;
create trigger batches_resync_students
  after update of start_date, end_date on public.batches
  for each row
  when (old.start_date is distinct from new.start_date or old.end_date is distinct from new.end_date)
  execute function public.batches_resync_students();

-- Safe by default: off until 28b.
alter table public.students disable trigger students_follow_batch_dates;
alter table public.batches   disable trigger batches_resync_students;

-- ---------------- grants ----------------
revoke all on function public.ist_today() from public, anon, authenticated, service_role;
revoke all on function public.batch_status_for(text, date, date, date) from public, anon, authenticated, service_role;
revoke all on function public.batch_status_targets(date) from public, anon, authenticated, service_role;
revoke all on function public.students_follow_batch_dates() from public, anon, authenticated, service_role;
revoke all on function public.batches_resync_students() from public, anon, authenticated, service_role;

revoke all on function public.preview_batch_status_changes(date) from public, anon, service_role;
revoke all on function public.batch_status_data_issues() from public, anon, service_role;
revoke all on function public.run_batch_status_automation() from public, anon, service_role;
grant execute on function public.preview_batch_status_changes(date) to authenticated;
grant execute on function public.batch_status_data_issues() to authenticated;
grant execute on function public.run_batch_status_automation() to authenticated;

commit;
