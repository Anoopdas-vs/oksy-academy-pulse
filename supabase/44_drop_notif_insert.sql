-- Migration 44 (Phase 1, fix 1.6): no direct notification inserts
-- Finding M-2: policy notif_insert let any approved user insert a notification
-- addressed to anyone. The app only creates notifications through notify_batch()
-- (security definer, guarded in migration 40), which does not need this policy.
--
-- UNDO:
--   create policy "notif_insert" on public.notifications
--     for insert to authenticated with check (public.is_approved_user());

begin;

drop policy if exists "notif_insert" on public.notifications;

commit;
