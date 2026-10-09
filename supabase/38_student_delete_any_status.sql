-- ============================================================
-- Migration 38: delete a mistaken enrolment in any status
-- ============================================================
-- Background (migration 26): delete_mistaken_student() allowed a delete only
-- while the student was 'Registered' and had never had a fee receipt — not
-- even one that was later deleted ("fee receipt history" in audit_log).
-- In practice the batch auto-status job moves students out of 'Registered'
-- by itself, and a mistaken receipt (since deleted) blocked the delete
-- forever, so a wrongly enrolled student could never be removed.
--
-- New rule (replaces the function body only; signature, grants unchanged):
--   * Owner/Admin only (is_admin()) — unchanged.
--   * ANY status may be deleted.
--   * Still refused while the student has a LIVE fee receipt
--     (collections.student_id) or a linked login (profiles.student_ref) —
--     those are real records; delete the receipt / unlink the login first,
--     or set the status to Dropped.
--   * A deleted receipt no longer blocks: its full row stays in audit_log.
--   * Every delete still writes the full student row to audit_log.
-- There is still NO DELETE policy on public.students; this RPC is the only
-- way an app user can delete a student row.
--
-- Single-tenant (one academy); no tenant column.
-- Idempotent: create or replace.
--
-- Rollback: re-run section 7 of 26_student_auto_id_and_safe_delete.sql.

begin;

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

  -- Leave a trace. audit_log.row_id is bigint and student IDs are text, so
  -- row_id is 0 here and the ID is in old_row->>'id'.
  insert into public.audit_log (table_name, row_id, action, old_row, new_row, changed_by)
  values ('students', 0, 'delete', to_jsonb(s), null, auth.uid());

  delete from public.students where id = s.id;
end;
$$;

revoke all on function public.delete_mistaken_student(text) from public, anon;
grant execute on function public.delete_mistaken_student(text) to authenticated;

commit;
