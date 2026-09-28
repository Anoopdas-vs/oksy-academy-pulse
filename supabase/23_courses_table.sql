-- ============================================================
-- Migration 23: courses master (short course code, e.g. DBHM / ODHM)
-- ============================================================
-- Run ONCE in the Supabase SQL Editor, after 22.
--
-- Until now "course" has only been free text (students.course,
-- batches.course_name). This adds a small course master so each course
-- has a unique short code. Nothing references it yet — students.course and
-- batches.course_name are untouched and no existing data changes. Linking
-- them (FK / backfill) is a later phase.
--
-- `code` is nullable for now (per Phase A), but the Admin form requires it
-- for new courses. Stored upper-case so uniqueness is effectively
-- case-insensitive. Postgres unique allows multiple NULLs.
--
-- Single-tenant assumption: `code` is unique across the whole table because
-- there is exactly one academy per database. Multi-tenancy would need
-- unique (academy_id, code) instead.
--
-- RLS mirrors public.batches: any approved login reads (course names/codes
-- are not personal data), staff+ create/edit, admin deletes.
--
-- Rollback (table is new and unreferenced, safe to drop):
--   drop table if exists public.courses;
-- ------------------------------------------------------------

begin;

create table if not exists public.courses (
  id bigint generated always as identity primary key,
  code text unique
    constraint courses_code_format check (code = upper(btrim(code)) and code <> ''),
  name text not null unique,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

alter table public.courses enable row level security;

drop policy if exists "courses_approved_select" on public.courses;
create policy "courses_approved_select" on public.courses
  for select using (public.is_approved_user());

drop policy if exists "courses_staff_insert" on public.courses;
create policy "courses_staff_insert" on public.courses
  for insert with check (public.is_staff_or_admin());

drop policy if exists "courses_staff_update" on public.courses;
create policy "courses_staff_update" on public.courses
  for update using (public.is_staff_or_admin()) with check (public.is_staff_or_admin());

drop policy if exists "courses_admin_delete" on public.courses;
create policy "courses_admin_delete" on public.courses
  for delete using (public.is_admin());

commit;
