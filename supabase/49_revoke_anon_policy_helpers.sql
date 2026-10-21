-- Migration 49 (Phase 2 Step 0b): policy helpers no longer executable by anon
-- Finding: the 8 SECURITY DEFINER helpers used inside RLS policies still had the
-- default PUBLIC/anon EXECUTE grant (advisor 0028), so anyone with the public
-- anon key could call /rest/v1/rpc/is_admin etc. They only describe the caller,
-- but they are an unnecessary probe surface.
--
-- Effect: signed-in users (authenticated) and service_role keep EXECUTE, so every
-- policy, view and RPC works unchanged for real users. An anonymous request to a
-- table whose policy calls a helper now gets "permission denied for function"
-- instead of an empty result - still no data; the app never reads as anon.
-- Views are SECURITY DEFINER (run as owner) and are unaffected.
--
-- UNDO (down migration): supabase/down/49_revoke_anon_policy_helpers.down.sql

begin;

do $$
declare f text;
begin
  foreach f in array array[
    'public.can_view_financials()',
    'public.is_admin()',
    'public.is_approved_user()',
    'public.is_staff_or_admin()',
    'public.is_super_admin()',
    'public.my_batch()',
    'public.my_student_ref()',
    'public.teaches_batch(text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

commit;
