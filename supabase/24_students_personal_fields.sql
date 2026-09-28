-- ============================================================
-- Migration 24: student personal / contact fields
-- ============================================================
-- Run ONCE in the Supabase SQL Editor, AFTER 22 — 22 restricts students
-- SELECT to staff+ and the student's own row. Applying this without 22
-- would expose these personal fields to every approved login.
--
-- All columns are nullable: existing students have none of this data yet.
-- The enrollment form requires student_phone, parent_name, parent_phone
-- and place for NEW students; the database only enforces format. Every
-- check passes on NULL, so existing rows are unaffected. Status values and
-- existing data are not touched.
--
-- Phone numbers are stored as exactly 10 digits (Indian mobile, no +91 /
-- spaces) — the form strips spaces and dashes before saving.
--
-- Access: inherits public.students RLS — read by staff/admin/owner and the
-- student themself (via profiles.student_ref), written by staff+ only.
--
-- Rollback (drops only the columns/constraints added here; any data
-- entered into them is lost, so export first):
--   alter table public.students
--     drop constraint if exists students_student_phone_format,
--     drop constraint if exists students_parent_phone_format,
--     drop constraint if exists students_student_email_format,
--     drop constraint if exists students_guardian_relation_valid,
--     drop column if exists student_phone,
--     drop column if exists student_email,
--     drop column if exists parent_name,
--     drop column if exists parent_phone,
--     drop column if exists guardian_relation,
--     drop column if exists place,
--     drop column if exists address,
--     drop column if exists date_of_birth,
--     drop column if exists lead_source;
-- ------------------------------------------------------------

begin;

alter table public.students
  add column if not exists student_phone     text,
  add column if not exists student_email     text,
  add column if not exists parent_name       text,
  add column if not exists parent_phone      text,
  add column if not exists guardian_relation text,
  add column if not exists place             text,
  add column if not exists address           text,
  add column if not exists date_of_birth     date,
  add column if not exists lead_source       text;

alter table public.students
  drop constraint if exists students_student_phone_format,
  drop constraint if exists students_parent_phone_format,
  drop constraint if exists students_student_email_format,
  drop constraint if exists students_guardian_relation_valid;

alter table public.students
  add constraint students_student_phone_format
    check (student_phone is null or student_phone ~ '^[0-9]{10}$'),
  add constraint students_parent_phone_format
    check (parent_phone is null or parent_phone ~ '^[0-9]{10}$'),
  add constraint students_student_email_format
    check (student_email is null or student_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  add constraint students_guardian_relation_valid
    check (guardian_relation is null or guardian_relation in ('Father', 'Mother', 'Other'));

commit;
