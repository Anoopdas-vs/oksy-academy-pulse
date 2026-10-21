-- ============================================================
-- Oksy Academy Pulse — Supabase schema, roles & permissions
-- ============================================================
-- Run this once in your Supabase project's SQL Editor
-- (Dashboard -> SQL Editor -> New query -> paste this whole file -> Run).

-- ------------------------------------------------------------
-- 1. PROFILES  (one row per login, created automatically on signup)
-- ------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'staff' check (role in ('super_admin', 'admin', 'staff', 'student', 'faculty', 'professional')),
  can_view_financials boolean not null default false,
  is_approved boolean not null default false,
  -- True for logins provisioned by the create-user Edge Function (an
  -- admin-set temp password) until the person changes it. See migration 10.
  must_change_password boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create or replace function public.is_admin()
returns boolean
language sql security definer set search_path = public stable
as $$
  select coalesce(
    (select role in ('admin', 'super_admin') and is_approved
     from public.profiles where id = auth.uid()),
    false
  );
$$;

create or replace function public.is_super_admin()
returns boolean
language sql security definer set search_path = public stable
as $$
  select coalesce(
    (select role = 'super_admin' and is_approved
     from public.profiles where id = auth.uid()),
    false
  );
$$;

create or replace function public.is_approved_user()
returns boolean
language sql security definer set search_path = public stable
as $$
  select coalesce((select is_approved from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.can_view_financials()
returns boolean
language sql security definer set search_path = public stable
as $$
  select coalesce(
    (select is_approved and (role = 'admin' or can_view_financials)
     from public.profiles where id = auth.uid()),
    false
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create policy "profiles_self_select" on public.profiles
  for select using (id = auth.uid());

-- Only the Owner (super_admin) reads the full roster — matches the app's
-- own access model (manageUsers: isSuperAdmin in src/lib/access.js). Using
-- is_admin() here used to let plain admins read it too; see migration 07.
create policy "profiles_super_admin_select_all" on public.profiles
  for select using (public.is_super_admin());

create policy "profiles_super_admin_update_all" on public.profiles
  for update using (public.is_super_admin()) with check (public.is_super_admin());

-- Lets any signed-in user clear their OWN must_change_password flag after
-- changing their password — and nothing else about their row, since a
-- SECURITY DEFINER function can only do exactly what its body says. See
-- migration 10.
create or replace function public.clear_my_must_change_password()
returns void
language sql security definer set search_path = public
as $$
  update public.profiles set must_change_password = false where id = auth.uid();
$$;

grant execute on function public.clear_my_must_change_password() to authenticated;

-- ------------------------------------------------------------
-- 2. STUDENTS  (student master — visible to every approved login)
-- ------------------------------------------------------------
create table public.students (
  id text primary key,
  batch text,
  name text not null,
  course text,
  registration_fee numeric not null default 0,
  course_fee numeric not null default 0,
  exam_fee numeric not null default 0,
  other_fee numeric not null default 0,
  waiver numeric not null default 0,
  status text not null default 'Registered'
    check (status in ('Registered', 'Active', 'Completed', 'Dropped')),
  enrollment_date date,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);

alter table public.students enable row level security;

create policy "students_approved_select" on public.students
  for select using (public.is_approved_user());

create policy "students_approved_insert" on public.students
  for insert with check (public.is_approved_user());

create policy "students_approved_update" on public.students
  for update using (public.is_approved_user()) with check (public.is_approved_user());

-- No delete policy on purpose — financial/student records are corrected, not deleted.

-- ------------------------------------------------------------
-- 3. COLLECTIONS  (student fee payments)
-- ------------------------------------------------------------
-- "Healthcare" is an inter-company clearing account: fees a student pays
-- through Healthcare land here instead of an Academy bank/cash account.
-- The running balance of the Healthcare account is the net amount owed
-- between Academy and Healthcare.
create table public.collections (
  id bigint generated always as identity primary key,
  student_id text not null references public.students (id),
  student_name text,
  date date not null,
  type text not null,
  account text not null check (account in ('HDFC', 'ICICI', 'Cash', 'Healthcare')),
  amount numeric not null check (amount > 0),
  reference text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  updated_at timestamptz,
  updated_by uuid references public.profiles (id)
);

alter table public.collections enable row level security;
create index collections_student_id_idx on public.collections (student_id);
create index collections_date_idx on public.collections (date);

-- Kept as a floor even though direct table SELECT is revoked from
-- `authenticated` below (reads go through collections_basic instead) — if
-- that grant is ever restored, approved-user-only is still the right
-- fallback rather than accidentally open.
create policy "collections_approved_select" on public.collections
  for select using (public.is_approved_user());

create policy "collections_approved_insert" on public.collections
  for insert with check (public.is_approved_user());

create policy "collections_admin_update" on public.collections
  for update using (public.is_admin()) with check (public.is_admin());

create policy "collections_admin_delete" on public.collections
  for delete using (public.is_admin());

-- NOT security_invoker: a security_invoker view checks the INVOKING role's
-- own column privileges against the underlying table for every column the
-- view body references — including inside a `case when ... else null end`
-- that never actually returns it. So a security_invoker version of this
-- view, combined with revoking `account` from `authenticated` below, would
-- throw "permission denied for table collections" for every single caller,
-- not just the ones who are supposed to be masked (verified empirically —
-- see the engineering review, finding C2). A plain view runs its underlying
-- query as the view's OWNER, who has full table access, so the CASE
-- expression can evaluate `account` and still only ever return it to
-- whoever the expression says should see it; `authenticated` never needs
-- (and per the revoke below, never gets) any privilege on the base table's
-- `account` column at all. security_barrier keeps the query planner from
-- reordering a future filter ahead of this view's own row-visibility check.
-- The `where` clause re-implements collections_approved_select's rule
-- explicitly (rather than depending on RLS-via-view propagation, which is
-- exactly the part security_invoker would otherwise be for) so this view's
-- visibility is self-contained and doesn't depend on who owns it.
create view public.collections_basic
with (security_barrier = true)
as
select
  id,
  student_id,
  student_name,
  date,
  type,
  amount,
  reference,
  case
    when public.can_view_financials() or created_by = auth.uid() then account
    else null
  end as account
from public.collections
where public.is_approved_user();

-- Reads go through the view ONLY: it's the view's `case when` above that
-- actually enforces the masking, and that only works if nobody can also
-- query the base table directly and get the unmasked `account`. `id` stays
-- column-granted on the base table because insertCollection() needs it
-- back via RETURNING and edit/delete filter by it (see migration 06).
revoke select on public.collections from authenticated;
grant select (id) on public.collections to authenticated;
grant select on public.collections_basic to authenticated;

-- ------------------------------------------------------------
-- 4. EXPENSES  (confidential — admin, or staff explicitly granted access)
-- ------------------------------------------------------------
create table public.expenses (
  id bigint generated always as identity primary key,
  date date not null,
  category text not null,
  -- 'Healthcare' = Academy expense settled by Healthcare (inter-company).
  account text not null check (account in ('HDFC', 'ICICI', 'Cash', 'Healthcare')),
  amount numeric not null check (amount > 0),
  reference text,
  description text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  updated_at timestamptz,
  updated_by uuid references public.profiles (id)
);

alter table public.expenses enable row level security;
create index expenses_date_idx on public.expenses (date);

-- Any approved user may see, add and edit expenses; only admins delete.
create policy "expenses_approved_select" on public.expenses
  for select using (public.is_approved_user());

create policy "expenses_approved_insert" on public.expenses
  for insert with check (public.is_approved_user());

create policy "expenses_approved_update" on public.expenses
  for update using (public.is_approved_user()) with check (public.is_approved_user());

create policy "expenses_admin_delete" on public.expenses
  for delete using (public.is_admin());

-- Note: there is deliberately no "5. INCOME" table here any more. An
-- earlier version of this schema had one for an "other Academy income"
-- feature that was later removed from the frontend entirely — nothing
-- reads or writes it. If your project still has it from before, run
-- 08_drop_income_table.sql (after exporting any existing rows).

-- ------------------------------------------------------------
-- 6. TRANSFERS  (money moved between accounts — not income or expense)
-- ------------------------------------------------------------
-- A transfer moves money between Cash / HDFC / ICICI (and "Healthcare" for
-- repaying Healthcare what it spent on the Academy). "Adjustments" is a
-- transfer-only counter-account for bank items that are neither income nor
-- expense (migration 39); it is never allowed on collections/expenses.
-- Transfers change account balances only; Net P&L is unaffected.
create table public.transfers (
  id bigint generated always as identity primary key,
  date date not null,
  from_account text not null check (from_account in ('HDFC', 'ICICI', 'Cash', 'Healthcare', 'Adjustments')),
  to_account   text not null check (to_account   in ('HDFC', 'ICICI', 'Cash', 'Healthcare', 'Adjustments')),
  amount numeric not null check (amount > 0),
  purpose text,
  reference text,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  constraint transfers_distinct_accounts check (from_account <> to_account)
);

alter table public.transfers enable row level security;
create index transfers_date_idx on public.transfers (date);

create policy "transfers_financial_viewer_select" on public.transfers
  for select using (public.can_view_financials());
create policy "transfers_admin_insert" on public.transfers
  for insert with check (public.is_admin());
create policy "transfers_admin_update" on public.transfers
  for update using (public.is_admin()) with check (public.is_admin());
create policy "transfers_admin_delete" on public.transfers
  for delete using (public.is_admin());

-- ------------------------------------------------------------
-- 7. BANK RECONCILIATION  (uploaded statements + their lines)
-- ------------------------------------------------------------
create table public.bank_statements (
  id bigint generated always as identity primary key,
  account text not null check (account in ('HDFC', 'ICICI', 'Cash')),
  period_start date,
  period_end date,
  opening_balance numeric,
  closing_balance numeric,
  file_name text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

alter table public.bank_statements enable row level security;
create policy "bank_statements_financial_viewer_select" on public.bank_statements
  for select using (public.can_view_financials());
create policy "bank_statements_admin_insert" on public.bank_statements
  for insert with check (public.is_admin());
create policy "bank_statements_admin_update" on public.bank_statements
  for update using (public.is_admin()) with check (public.is_admin());
create policy "bank_statements_admin_delete" on public.bank_statements
  for delete using (public.is_admin());

create table public.bank_statement_lines (
  id bigint generated always as identity primary key,
  statement_id bigint not null references public.bank_statements (id) on delete cascade,
  account text not null check (account in ('HDFC', 'ICICI', 'Cash')),
  seq int,
  txn_date date not null,
  description text,
  reference text,
  withdrawal numeric not null default 0,
  deposit numeric not null default 0,
  running_balance numeric,
  -- reconciliation state
  status text not null default 'unmatched'
    check (status in ('unmatched', 'matched', 'classified', 'ignored')),
  match_kind text check (match_kind in ('collection', 'expense', 'transfer')),
  match_id bigint,
  matched_at timestamptz,
  matched_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

alter table public.bank_statement_lines enable row level security;
create index bank_statement_lines_statement_idx on public.bank_statement_lines (statement_id);
create policy "bank_statement_lines_financial_viewer_select" on public.bank_statement_lines
  for select using (public.can_view_financials());
create policy "bank_statement_lines_admin_insert" on public.bank_statement_lines
  for insert with check (public.is_admin());
create policy "bank_statement_lines_admin_update" on public.bank_statement_lines
  for update using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- 8. BATCHES  (course batch master — drives enrolment defaults)
-- ------------------------------------------------------------
create table public.batches (
  id bigint generated always as identity primary key,
  name text not null unique,
  course_name text,
  course_fee numeric not null default 0,
  start_date date,
  end_date date,
  duration text,
  notes text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

alter table public.batches enable row level security;
create policy "batches_approved_select" on public.batches
  for select using (public.is_approved_user());
create policy "batches_approved_insert" on public.batches
  for insert with check (public.is_approved_user());
create policy "batches_approved_update" on public.batches
  for update using (public.is_approved_user()) with check (public.is_approved_user());
create policy "batches_admin_delete" on public.batches
  for delete using (public.is_admin());

-- ------------------------------------------------------------
-- 9. EXPENSE CATEGORIES  (editable list used by the Expenses form)
-- ------------------------------------------------------------
create table public.expense_categories (
  id bigint generated always as identity primary key,
  name text not null unique,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

alter table public.expense_categories enable row level security;
create policy "expense_categories_approved_select" on public.expense_categories
  for select using (public.is_approved_user());
create policy "expense_categories_approved_insert" on public.expense_categories
  for insert with check (public.is_approved_user());
create policy "expense_categories_approved_update" on public.expense_categories
  for update using (public.is_approved_user()) with check (public.is_approved_user());
create policy "expense_categories_admin_delete" on public.expense_categories
  for delete using (public.is_admin());

insert into public.expense_categories (name)
values ('Rent'), ('Salary'), ('Commission'), ('Electricity'), ('Internet'),
       ('Marketing'), ('Office Expense'), ('Travel'), ('Bank Charge'), ('Other')
on conflict (name) do nothing;

-- ------------------------------------------------------------
-- 10. APP SETTINGS  (single JSON row the super admin edits)
-- ------------------------------------------------------------
create table public.app_settings (
  id int primary key default 1,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  constraint app_settings_singleton check (id = 1)
);
insert into public.app_settings (id, data) values (1, '{}'::jsonb);

alter table public.app_settings enable row level security;
create policy "app_settings_approved_select" on public.app_settings
  for select using (public.is_approved_user());
create policy "app_settings_super_admin_write" on public.app_settings
  for update using (public.is_super_admin()) with check (public.is_super_admin());
create policy "app_settings_super_admin_insert" on public.app_settings
  for insert with check (public.is_super_admin());

-- ------------------------------------------------------------
-- 11. ACADEMY SUITE  (Timetable, Assignments, Exams, Reviews)
-- ------------------------------------------------------------
-- Mirrors supabase/migration-academy-suite.sql so a fresh project gets the
-- full portal in one pass. All CREATE ... IF NOT EXISTS — safe to re-run.

-- NOTE (Step 12 cleanliness pass): the v1 `timetables` table used to be
-- defined here. It was confirmed unreferenced anywhere in app code (the
-- app now uses `timetable_slots`, see migration-academy-suite-v2.sql) and
-- confirmed absent from the production database, so its definition was
-- removed rather than left to be recreated by a fresh setup. See
-- docs/claude-project/audits/04-database-schema-audit.md and
-- supabase/18_drop_timetables_v1.sql for history.

create table if not exists public.assignments (
  id text primary key,
  title text not null,
  batch text not null,
  due_date date not null,
  max_marks integer not null default 100,
  description text,
  attachment_url text,
  created_by uuid references auth.users (id),
  created_at timestamptz default now()
);

create table if not exists public.assignment_submissions (
  id text primary key,
  assignment_id text references public.assignments (id) on delete cascade,
  student_id uuid references auth.users (id),
  link text,
  notes text,
  marks integer,
  feedback text,
  status text default 'Submitted',        -- Submitted, Graded
  submitted_at timestamptz default now()
);

create table if not exists public.exams (
  id text primary key,
  title text not null,
  batch text not null,
  duration_minutes integer not null default 30,
  passing_score integer not null default 50,
  status text default 'Available',         -- Available, Upcoming, Completed
  created_by uuid references auth.users (id),
  created_at timestamptz default now()
);

create table if not exists public.exam_questions (
  id text primary key,
  exam_id text references public.exams (id) on delete cascade,
  question text not null,
  options jsonb not null,                  -- ["Option A", "Option B", ...]
  correct_index integer not null,
  marks integer default 1
);

create table if not exists public.exam_results (
  id text primary key,
  exam_id text references public.exams (id) on delete cascade,
  student_id uuid references auth.users (id),
  score integer not null,
  total integer not null,
  percentage integer not null,
  passed boolean not null,
  submitted_at timestamptz default now()
);

create table if not exists public.faculty_reviews (
  id text primary key,
  faculty text not null,
  subject text not null,
  rating integer not null check (rating between 1 and 5),
  clarity integer not null check (clarity between 1 and 5),
  punctuality integer not null check (punctuality between 1 and 5),
  comment text not null,
  student_id uuid references auth.users (id),
  created_at timestamptz default now()
);

alter table public.assignments enable row level security;
alter table public.assignment_submissions enable row level security;
alter table public.exams enable row level security;
alter table public.exam_questions enable row level security;
alter table public.exam_results enable row level security;
alter table public.faculty_reviews enable row level security;

create policy "Approved users can view assignments" on public.assignments
  for select to authenticated using (public.is_approved_user());
create policy "Admins can manage assignments" on public.assignments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "Users can manage own submissions" on public.assignment_submissions
  for all to authenticated using (student_id = auth.uid() or public.is_admin())
  with check (student_id = auth.uid() or public.is_admin());

create policy "Approved users can view exams" on public.exams
  for select to authenticated using (public.is_approved_user());
create policy "Admins can manage exams" on public.exams
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "Approved users can view exam questions" on public.exam_questions
  for select to authenticated using (public.is_approved_user());

create policy "Users can record own exam results" on public.exam_results
  for all to authenticated using (student_id = auth.uid() or public.is_admin())
  with check (student_id = auth.uid() or public.is_admin());

create policy "Approved users can view reviews" on public.faculty_reviews
  for select to authenticated using (public.is_approved_user());
create policy "Users can post reviews" on public.faculty_reviews
  for insert to authenticated with check (auth.uid() is not null);

-- ------------------------------------------------------------
-- 12. AUDIT LOG  (who changed/deleted a financial record, and what it was)
-- ------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  row_id bigint not null,
  action text not null check (action in ('update', 'delete')),
  old_row jsonb,
  new_row jsonb,
  changed_by uuid references public.profiles (id),
  changed_at timestamptz not null default now()
);

alter table public.audit_log enable row level security;
create index audit_log_table_row_idx on public.audit_log (table_name, row_id);

create policy "audit_log_financial_viewer_select" on public.audit_log
  for select using (public.can_view_financials());

create or replace function public.log_financial_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if (tg_op = 'UPDATE') then
    insert into public.audit_log (table_name, row_id, action, old_row, new_row, changed_by)
    values (tg_table_name, new.id, 'update', to_jsonb(old), to_jsonb(new), auth.uid());
    return new;
  elsif (tg_op = 'DELETE') then
    insert into public.audit_log (table_name, row_id, action, old_row, new_row, changed_by)
    values (tg_table_name, old.id, 'delete', to_jsonb(old), null, auth.uid());
    return old;
  end if;
  return null;
end;
$$;

create trigger collections_audit
  after update or delete on public.collections
  for each row execute function public.log_financial_change();
create trigger expenses_audit
  after update or delete on public.expenses
  for each row execute function public.log_financial_change();
create trigger transfers_audit
  after update or delete on public.transfers
  for each row execute function public.log_financial_change();

-- ------------------------------------------------------------
-- 13. MAKE YOURSELF THE SUPER ADMIN
-- ------------------------------------------------------------
-- 1. Sign up once from the app's login screen with your own email/password.
-- 2. Then run this (replace the email):
--
-- update public.profiles
--    set role = 'super_admin', is_approved = true, can_view_financials = true
--  where email = 'you@example.com';
