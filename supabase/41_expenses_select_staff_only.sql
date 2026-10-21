-- Migration 41 (Phase 1, fix 1.3): expenses readable by Owner/Admin/Executive only
-- Finding H-2: policy expenses_approved_select used is_approved_user(), so any
-- approved login (student, faculty) could read every expense through the API.
-- Insert/update/delete policies are untouched.
--
-- UNDO:
--   drop policy "expenses_approved_select" on public.expenses;
--   create policy "expenses_approved_select" on public.expenses
--     for select using (public.is_approved_user());

begin;

drop policy if exists "expenses_approved_select" on public.expenses;
create policy "expenses_approved_select" on public.expenses
  for select to authenticated using (public.is_staff_or_admin());

commit;
