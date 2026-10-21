-- Migration 42 (Phase 1, fix 1.4): fee receipts visible to staff, plus a student's own
-- Finding H-3: view collections_basic filtered only by is_approved_user(), so any
-- approved login could read every student's receipts. Same columns, same
-- masking of `account`; only the row filter changes.
--
-- UNDO: create or replace the view again with `where public.is_approved_user()`.

begin;

create or replace view public.collections_basic as
  select id,
         student_id,
         student_name,
         date,
         type,
         amount,
         reference,
         case when (public.can_view_financials() or created_by = auth.uid())
              then account else null::text end as account,
         bank_reference
  from public.collections
  where public.is_staff_or_admin() or student_id = public.my_student_ref();

commit;
