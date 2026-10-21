-- Migration 45 (Phase 1, fix 1.7): attendance only for sessions of the student's own batch
-- Finding L-2: attend_self_insert checked only student_id = auth.uid(), so a
-- student could mark attendance in any batch's live session.
-- Uses a small security-definer helper so the check does not depend on the
-- student's own read access to live_sessions / timetable_slots.
--
-- UNDO:
--   drop policy "attend_self_insert" on public.attendance;
--   create policy "attend_self_insert" on public.attendance
--     for insert to authenticated with check (student_id = auth.uid());
--   drop function public.session_in_my_batch(uuid);

begin;

create or replace function public.session_in_my_batch(p_session uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.live_sessions ls
    join public.timetable_slots s on s.id = ls.slot_id
    where ls.id = p_session
      and s.batch_name is not null
      and s.batch_name = public.my_batch()
  );
$$;
revoke all on function public.session_in_my_batch(uuid) from public, anon;
grant execute on function public.session_in_my_batch(uuid) to authenticated;

drop policy if exists "attend_self_insert" on public.attendance;
create policy "attend_self_insert" on public.attendance
  for insert to authenticated
  with check (student_id = auth.uid() and public.session_in_my_batch(session_id));

commit;
