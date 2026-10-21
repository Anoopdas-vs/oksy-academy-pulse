-- Migration 47 (Phase 1, fix 1.9): function hygiene
-- Finding L-1: SECURITY DEFINER functions were executable by anon through the
-- default PUBLIC grant, and 5 functions had no fixed search_path.
--  * Revoke EXECUTE from PUBLIC/anon on the app RPCs and trigger/internal
--    functions below; signed-in callers keep (explicit) EXECUTE where the app
--    calls them.
--  * Pin search_path on the 5 functions that had none.
-- NOT touched on purpose: the policy helpers (is_admin, is_super_admin,
-- is_staff_or_admin, is_approved_user, can_view_financials, my_batch,
-- my_student_ref, teaches_batch) — policies call them; revisit in Phase 3.
-- delete_mistaken_student (migration 38) already has no anon access.
--
-- UNDO: grant execute on the functions below to public; alter function ... reset search_path
--       (only the five listed in section 2).

begin;

do $$
declare f text;
begin
  -- 1. RPCs called by signed-in users: keep authenticated, drop public/anon
  foreach f in array array[
    'public.resubmit_assignment(uuid,text,text,text,boolean)',
    'public.score_exam_attempt(uuid)',
    'public.clear_my_must_change_password()'
  ] loop
    if to_regprocedure(f) is not null then
      execute format('revoke all on function %s from public, anon', f);
      execute format('grant execute on function %s to authenticated', f);
    end if;
  end loop;

  -- trigger / internal functions: nobody calls them over the API
  foreach f in array array[
    'public.handle_new_user()',
    'public.log_financial_change()',
    'public.rls_auto_enable()'
  ] loop
    if to_regprocedure(f) is not null then
      execute format('revoke all on function %s from public, anon, authenticated', f);
    end if;
  end loop;

  -- 2. pin search_path
  foreach f in array array[
    'public.timetable_no_conflict()',
    'public.can_manage_assignment(public.assignments)',
    'public.can_manage_exam(public.exams)',
    'public.ist_today()',
    'public.batch_status_for(text,date,date,date)'
  ] loop
    if to_regprocedure(f) is not null then
      execute format('alter function %s set search_path = public', f);
    end if;
  end loop;
end $$;

commit;
