-- ============================================================
-- Migration 30: relax the batch-name rule (replaces migration 25's rule)
-- ============================================================
-- Run ONCE in the Supabase SQL Editor, after 29. One purpose: replace the
-- body of enforce_batch_name_rule().
--
-- OLD rule (25): ^[A-Z0-9]+$  (capital letters and digits only).
-- NEW rule: a name may contain only
--     * capital letters A-Z and digits 0-9
--     * single spaces BETWEEN words (never leading, trailing or two in a row;
--       only the plain space character, no tabs / non-breaking spaces)
--     * these symbols:  -  /  &  .  (  )  _
--   No lowercase letters. Names such as "BATCH 7", "DBHM-2026/A",
--   "NURSING (EVENING) 1", "A&B_2" pass; "batch 7", " B1", "B1 ", "B  1",
--   "B1!", "B1,2" fail.
--
-- Same enforcement model as 25: the trigger runs only when a batch is
-- inserted or its name actually changes, so existing names are never
-- rewritten and their batches stay editable. (Batch names are referenced by
-- students.batch, profiles.batch_name, faculty_batches, timetable_slots,
-- assignments and exams, all ON UPDATE CASCADE, so renames stay deliberate.)
--
-- Data impact: none. The function is replaced in place; no rows are touched.
-- Staging was checked before applying: no existing batch name violates the
-- new rule.
--
-- Security: no RLS policy or grant changes. The function stays SECURITY
-- INVOKER with a pinned search_path and only reads NEW/OLD. The set of
-- allowed characters is deliberately narrow (no quotes, commas, %, *, ?,
-- backslash), so a batch name can never be read as SQL/PostgREST/LIKE syntax
-- wherever it is passed around as text.
--
-- Rollback (restores migration 25's rule):
--   create or replace function public.enforce_batch_name_rule()
--   returns trigger language plpgsql set search_path = public as $f$
--   begin
--     if (tg_op = 'INSERT' or new.name is distinct from old.name)
--        and new.name !~ '^[A-Z0-9]+$' then
--       raise exception 'Batch name must use capital letters and digits only (A-Z, 0-9), no spaces or symbols.'
--         using errcode = 'check_violation', constraint = 'batches_name_format';
--     end if;
--     return new;
--   end; $f$;
-- ============================================================

begin;

create or replace function public.enforce_batch_name_rule()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (tg_op = 'INSERT' or new.name is distinct from old.name)
     and new.name !~ '^[A-Z0-9/&.()_-]+( [A-Z0-9/&.()_-]+)*$' then
    raise exception 'Batch name may use only capital letters, digits, single spaces between words, and - / & . ( ) _ (no lowercase, no leading or trailing space).'
      using errcode = 'check_violation', constraint = 'batches_name_format';
  end if;
  return new;
end;
$$;

-- The trigger from migration 25 (batches_name_rule) already points at this
-- function by name; re-create it so this file is self-contained.
drop trigger if exists batches_name_rule on public.batches;
create trigger batches_name_rule
  before insert or update of name on public.batches
  for each row execute function public.enforce_batch_name_rule();

commit;
