-- ============================================================
-- Migration 22: students SELECT = staff+ (all rows) or own row (student)
-- ============================================================
-- Run ONCE in the Supabase SQL Editor, after 01-21 and BEFORE 24 (which
-- adds personal/contact columns to public.students).
--
-- Problem: students_approved_select was `is_approved_user()`, so ANY
-- approved login — including 'student', 'faculty' and 'professional' — could
-- read every student's row (fees, waiver, status) via the REST API, even
-- though no screen for those roles uses the students table (their
-- dashboards read the academic tables instead; see Dashboard.jsx). Adding
-- phone/email/address columns (migration 24) would expose that personal
-- data to every learner login, so reads are tightened first.
--
-- New rule:
--   * super_admin / admin / staff (is_staff_or_admin()) — all rows
--   * a login whose profiles.student_ref points at a row — that row only
--   * faculty / professional / anyone else — no rows
-- Insert/update policies (migration 15: staff+) and the absence of a
-- delete policy are unchanged.
--
-- profiles.student_ref can only be written by the Owner
-- (profiles_super_admin_update_all), so a student cannot re-point it at
-- someone else's record.
--
-- Single-tenant assumption: one academy per database, so "staff+" means
-- staff of THE academy. Multi-tenancy would need an academy_id scope here.
--
-- Rollback (restores the previous, looser rule):
--   drop policy if exists "students_staff_or_own_select" on public.students;
--   create policy "students_approved_select" on public.students
--     for select using (public.is_approved_user());
--   drop function if exists public.my_student_ref();
-- ------------------------------------------------------------

begin;

-- The caller's linked students.id, or null. SECURITY DEFINER so the policy
-- doesn't depend on profiles' own RLS; only returns a value for an approved
-- login.
create or replace function public.my_student_ref()
returns text
language sql security definer set search_path = public stable
as $$
  select student_ref from public.profiles
  where id = auth.uid() and is_approved;
$$;

drop policy if exists "students_approved_select" on public.students;
drop policy if exists "students_staff_or_own_select" on public.students;
create policy "students_staff_or_own_select" on public.students
  for select using (
    public.is_staff_or_admin()
    or id = public.my_student_ref()
  );

commit;
