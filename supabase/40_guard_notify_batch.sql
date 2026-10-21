-- Migration 40 (Phase 1, fix 1.1): guard notify_batch()
-- Finding C-1: any caller, even a signed-out one (anon had EXECUTE through the
-- default PUBLIC grant), could push a notification to every student of a batch.
-- Now: the caller must be Owner/Admin/Executive (is_staff_or_admin()) or a
-- faculty member who teaches that batch; EXECUTE is revoked from PUBLIC/anon.
-- Callers in the app: AssignmentsPage, TimetablePage, ExamsPage (staff/faculty).
-- Idempotent (create or replace).
--
-- UNDO: re-run the function body from migration-academy-suite-v2.sql (no guard)
--   and `grant execute on function public.notify_batch(text,text,text,text,text) to public;`

begin;

create or replace function public.notify_batch(
  p_batch text, p_type text, p_title text, p_body text, p_link text
) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not (public.is_staff_or_admin()
          or (public.is_approved_user() and public.teaches_batch(p_batch))) then
    raise exception 'Not allowed to notify this batch.' using errcode = '42501';
  end if;

  insert into public.notifications (recipient_id, type, title, body, link_tab)
  select id, p_type, p_title, p_body, p_link
  from public.profiles
  where batch_name = p_batch and is_approved and role in ('student','professional');
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.notify_batch(text, text, text, text, text) from public, anon;
grant execute on function public.notify_batch(text, text, text, text, text) to authenticated;

commit;
