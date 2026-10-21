-- Down migration for 49: restore the original grants (PUBLIC + anon).
begin;
do $$
declare f text;
begin
  foreach f in array array[
    'public.can_view_financials()','public.is_admin()','public.is_approved_user()',
    'public.is_staff_or_admin()','public.is_super_admin()','public.my_batch()',
    'public.my_student_ref()','public.teaches_batch(text)'
  ] loop
    execute format('grant execute on function %s to public, anon, authenticated, service_role', f);
  end loop;
end $$;
commit;
