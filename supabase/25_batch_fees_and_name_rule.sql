-- ============================================================
-- Migration 25: batch fee fields + batch-name rule for new names
-- ============================================================
-- Run ONCE in the Supabase SQL Editor, after 24.
--
-- 1. Fees: a batch now carries three default fees that pre-fill enrolment.
--    course_fee already exists (numeric not null default 0). Adds
--    registration_fee and exam_fee (numeric not null default 0), and
--    requires all three to be >= 0. Existing batches get 0 for the two new
--    fees until an admin fills them in (the Admin -> Batches table flags
--    them as "not set"). The amounts are COPIED onto the student row at
--    enrolment (students.registration_fee / course_fee / exam_fee already
--    exist), so later batch fee edits never change existing students' dues.
--
--    The course_fee >= 0 check is added NOT VALID: it applies to every new
--    or updated row, but doesn't scan/reject historical rows, so this
--    migration can't fail on old data. Validate later with:
--      alter table public.batches validate constraint batches_course_fee_nonneg;
--
-- 2. Name rule: batch names must be ^[A-Z0-9]+$ (capital letters and
--    digits, no spaces/hyphens). Enforced by a trigger ONLY when a batch is
--    inserted or its name actually changes — existing names such as
--    "BATCH 1" / "ONLINE B1" are never rewritten and those batches stay
--    editable. (Batch names are referenced by students.batch,
--    profiles.batch_name, faculty_batches, timetable_slots, assignments and
--    exams, all ON UPDATE CASCADE, so renames must stay deliberate.)
--    Not a CHECK constraint on purpose: a CHECK would reject every update
--    to a legacy-named row.
--
-- Security: no RLS policy or grant changes. The trigger function is
-- SECURITY INVOKER (default) with a pinned search_path and only reads NEW/OLD.
-- Batches RLS is unchanged: read = approved users, insert/update = staff+
-- (migration 14), delete = admin.
--
-- Single-tenant assumption: batch names are unique across the whole table
-- (one academy per database).
--
-- Rollback:
--   drop trigger if exists batches_name_rule on public.batches;
--   drop function if exists public.enforce_batch_name_rule();
--   alter table public.batches
--     drop constraint if exists batches_course_fee_nonneg,
--     drop constraint if exists batches_registration_fee_nonneg,
--     drop constraint if exists batches_exam_fee_nonneg,
--     drop column if exists registration_fee,   -- loses entered fees
--     drop column if exists exam_fee;           -- loses entered fees
-- ------------------------------------------------------------

begin;

alter table public.batches
  add column if not exists registration_fee numeric not null default 0,
  add column if not exists exam_fee         numeric not null default 0;

alter table public.batches
  drop constraint if exists batches_course_fee_nonneg,
  drop constraint if exists batches_registration_fee_nonneg,
  drop constraint if exists batches_exam_fee_nonneg;

alter table public.batches
  add constraint batches_registration_fee_nonneg check (registration_fee >= 0),
  add constraint batches_exam_fee_nonneg         check (exam_fee >= 0);

alter table public.batches
  add constraint batches_course_fee_nonneg check (course_fee >= 0) not valid;

create or replace function public.enforce_batch_name_rule()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (tg_op = 'INSERT' or new.name is distinct from old.name)
     and new.name !~ '^[A-Z0-9]+$' then
    raise exception 'Batch name must use capital letters and digits only (A-Z, 0-9), no spaces or symbols.'
      using errcode = 'check_violation', constraint = 'batches_name_format';
  end if;
  return new;
end;
$$;

drop trigger if exists batches_name_rule on public.batches;
create trigger batches_name_rule
  before insert or update of name on public.batches
  for each row execute function public.enforce_batch_name_rule();

commit;
