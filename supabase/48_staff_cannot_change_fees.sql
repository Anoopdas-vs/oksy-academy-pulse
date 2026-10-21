-- Migration 48 (Phase 1, fix 1.10, decision D-18 = yes): only Owner/Admin may change fees and waivers
-- Finding M-1: an Executive (role staff) could edit a student's fee amounts or
-- waiver, and a batch's fee amounts, silently changing what is owed.
-- BEFORE UPDATE triggers on students and batches. Owner/Admin and server-side
-- callers (auth.uid() is null) are unaffected. Executives can still edit every
-- other field. INSERTs are not affected (enrolment copies the batch fees).
-- The one allowed waiver change for an Executive: marking a student Dropped
-- raises the waiver to write off the uncollected balance (App.jsx waiverForDrop:
-- waiver = max(old waiver, gross fee - collected)); anything above that, or any
-- lowering, is refused.
--
-- UNDO:
--   drop trigger students_fee_guard on public.students;
--   drop trigger batches_fee_guard on public.batches;
--   drop function public.students_fee_guard();  drop function public.batches_fee_guard();

begin;

create or replace function public.students_fee_guard()
returns trigger language plpgsql security definer set search_path = public as $$
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

create or replace function public.batches_fee_guard()
returns trigger language plpgsql security definer set search_path = public as $$
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

revoke all on function public.students_fee_guard() from public, anon, authenticated;
revoke all on function public.batches_fee_guard() from public, anon, authenticated;

drop trigger if exists students_fee_guard on public.students;
create trigger students_fee_guard
  before update of registration_fee, course_fee, exam_fee, other_fee, waiver on public.students
  for each row execute function public.students_fee_guard();

drop trigger if exists batches_fee_guard on public.batches;
create trigger batches_fee_guard
  before update of course_fee, registration_fee, exam_fee on public.batches
  for each row execute function public.batches_fee_guard();

commit;
