-- Phase 2 Step 0 checks (migration 49 + view intent). RUN ON STAGING ONLY.
-- One DO block ending in RAISE EXCEPTION: everything rolls back; the "error" is the report.
do $test$
declare
  admin_id uuid := 'dddbc5b1-59b4-4d9b-8e4f-4d947a33631e';
  staff_id uuid := '26c73f79-bc2a-43b4-9234-89fff3b06d66';
  fac_id   uuid := '504187ed-5828-45d9-b578-d9680aec80a3';
  s1 uuid := '663c6863-e7fa-4b3a-9ebb-8989bf4c0a30';  -- TST001
  s2 uuid := '7061cdbd-7c79-498c-9617-1bf3e885289c';  -- TST004
  rep text := ''; n int; b boolean; f text; e_id uuid;
begin
  -- 49: anon cannot execute any helper
  foreach f in array array['can_view_financials()','is_admin()','is_approved_user()','is_staff_or_admin()','is_super_admin()','my_batch()','my_student_ref()','teaches_batch(''x'')'] loop
    set local role anon;
    begin execute 'select public.'||f; rep := rep||E'\nFAIL 49 anon can run '||f;
    exception when insufficient_privilege then rep := rep||E'\nPASS 49 anon blocked: '||f; end;
    reset role;
  end loop;
  -- 49: anon still gets no rows (error or empty), never data
  set local role anon;
  begin select count(*) into n from public.collections; rep := rep||E'\n'||(case when n=0 then 'PASS' else 'FAIL' end)||' 49 anon collections rows='||n;
  exception when insufficient_privilege then rep := rep||E'\nPASS 49 anon collections denied'; end;
  begin select count(*) into n from public.collections_basic; rep := rep||E'\n'||(case when n=0 then 'PASS' else 'FAIL' end)||' 49 anon collections_basic rows='||n;
  exception when insufficient_privilege then rep := rep||E'\nPASS 49 anon collections_basic denied'; end;
  reset role;

  -- 49: every signed-in role still evaluates helpers
  foreach f in array array[admin_id::text, staff_id::text, fac_id::text, s1::text] loop
    perform set_config('request.jwt.claims', json_build_object('sub',f::uuid,'role','authenticated')::text, true);
    set local role authenticated;
    begin perform public.is_admin(), public.is_staff_or_admin(), public.is_approved_user(), public.can_view_financials(), public.my_batch(), public.my_student_ref(), public.teaches_batch('x'), public.is_super_admin();
      rep := rep||E'\nPASS 49 authenticated helpers ok for '||left(f,8);
    exception when others then rep := rep||E'\nFAIL 49 helper failed for '||left(f,8)||': '||sqlerrm; end;
    reset role;
  end loop;

  -- 49: RLS through helpers still works per role
  perform set_config('request.jwt.claims', json_build_object('sub',admin_id,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.expenses; rep := rep||E'\nPASS 49 admin reads expenses n='||n; reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',s1,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.expenses; rep := rep||E'\n'||(case when n=0 then 'PASS' else 'FAIL' end)||' 49 student sees 0 expenses (n='||n||')';
  reset role;

  -- 1c: collections_basic is definer ON PURPOSE: students see only own rows, no raw table
  perform set_config('request.jwt.claims', json_build_object('sub',s1,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.collections_basic where student_id <> 'TST001';
  rep := rep||E'\n'||(case when n=0 then 'PASS' else 'FAIL' end)||' 1c student sees no other student receipts in collections_basic (n='||n||')';
  -- authenticated has column-level SELECT on collections.id ONLY (by design, needed for UPDATE/RETURNING)
  begin perform student_id, amount, account from public.collections limit 1; rep := rep||E'\nFAIL 1c student can read collections money/student columns';
  exception when insufficient_privilege then rep := rep||E'\nPASS 1c student cannot read collections student_id/amount/account'; end;
  reset role;

  -- 1c: exam_questions_public is definer ON PURPOSE: no answer key column, raw table closed to students
  select count(*) into n from information_schema.columns where table_schema='public' and table_name='exam_questions_public' and column_name in ('correct_option','correct_answer','answer','correct_index','explanation');
  rep := rep||E'\n'||(case when n=0 then 'PASS' else 'FAIL' end)||' 1c exam_questions_public has no answer-key column';
  perform set_config('request.jwt.claims', json_build_object('sub',s1,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.exam_questions;
  rep := rep||E'\n'||(case when n=0 then 'PASS' else 'FAIL' end)||' 1c student reads 0 rows of raw exam_questions (n='||n||')';
  select count(*) into n from public.exam_questions_public q join public.exams e on e.id=q.exam_id where e.status<>'published' or e.batch_name is distinct from public.my_batch();
  rep := rep||E'\n'||(case when n=0 then 'PASS' else 'FAIL' end)||' 1c student sees only own-batch published questions (leak n='||n||')';
  reset role;

  raise exception E'STEP0 CHECK REPORT (rolled back)\n%', rep;
end
$test$;
