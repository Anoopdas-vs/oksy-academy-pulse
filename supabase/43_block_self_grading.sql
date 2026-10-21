-- Migration 43 (Phase 1, fix 1.5): students cannot self-grade or forge exam results
-- Finding H-4: policies sub_student_insert / attempt_student_insert check only
-- ownership, so a student could insert a submission with marks/status 'graded'
-- or an exam attempt with a score and submitted_at already set (which also
-- blocks the real score_exam_attempt()).
-- BEFORE INSERT triggers reset those fields for everyone except staff/admin
-- and server-side callers (auth.uid() is null: service role, SQL editor).
--
-- UNDO:
--   drop trigger if exists assignment_submissions_no_self_grade on public.assignment_submissions;
--   drop trigger if exists exam_attempts_no_forged_result on public.exam_attempts;
--   drop function if exists public.assignment_submissions_no_self_grade();
--   drop function if exists public.exam_attempts_no_forged_result();

begin;

create or replace function public.assignment_submissions_no_self_grade()
returns trigger language plpgsql security definer set search_path = public as $$
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

create or replace function public.exam_attempts_no_forged_result()
returns trigger language plpgsql security definer set search_path = public as $$
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

revoke all on function public.assignment_submissions_no_self_grade() from public, anon, authenticated;
revoke all on function public.exam_attempts_no_forged_result() from public, anon, authenticated;

drop trigger if exists assignment_submissions_no_self_grade on public.assignment_submissions;
create trigger assignment_submissions_no_self_grade
  before insert on public.assignment_submissions
  for each row execute function public.assignment_submissions_no_self_grade();

drop trigger if exists exam_attempts_no_forged_result on public.exam_attempts;
create trigger exam_attempts_no_forged_result
  before insert on public.exam_attempts
  for each row execute function public.exam_attempts_no_forged_result();

commit;
