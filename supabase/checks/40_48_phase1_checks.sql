-- Phase 1 (migrations 40-48) security checks.
-- RUN ON STAGING ONLY (never production). Everything runs inside one DO block
-- that ends with RAISE EXCEPTION, so all fixtures and test writes roll back.
-- The "error" returned IS the report: lines starting PASS / FAIL.
-- It impersonates the existing staging profiles (super_admin, staff, faculty,
-- two students) by setting request.jwt.claims + SET LOCAL ROLE.
do $test$
declare
  admin_id uuid := 'dddbc5b1-59b4-4d9b-8e4f-4d947a33631e';
  staff_id uuid := '26c73f79-bc2a-43b4-9234-89fff3b06d66';
  fac_id   uuid := '504187ed-5828-45d9-b578-d9680aec80a3';
  s1 uuid := '663c6863-e7fa-4b3a-9ebb-8989bf4c0a30';  -- TST001, TEST-DBHM-2026A
  s2 uuid := '7061cdbd-7c79-498c-9617-1bf3e885289c';  -- TST004, TEST-ODHM-2026A
  b1 text := 'TEST-DBHM-2026A';
  b2 text := 'TEST-ODHM-2026A';
  rep text := '';
  a_id uuid; e_id uuid; slot1 uuid; slot2 uuid; ls1 uuid; ls2 uuid; att_id uuid;
  n int; n_all int; m int; st text; v_gross numeric; v_col numeric; v_gap numeric;
  v_sid text; v_sid2 text;
begin
  -- ---------- fixtures (as postgres) ----------
  insert into public.assignments (batch_name, title, status, faculty_id)
    values (b1, 'P1 test', 'published', fac_id) returning id into a_id;
  insert into public.exams (batch_name, title, status) values (b1, 'P1 exam', 'published') returning id into e_id;
  insert into public.faculty_batches (faculty_id, batch_name) values (fac_id, b1) on conflict do nothing;
  insert into public.timetable_slots (batch_name, faculty_id, subject, day_of_week, starts_at, ends_at)
    values (b1, fac_id, 'S1', 'Monday', '09:00', '10:00') returning id into slot1;
  insert into public.timetable_slots (batch_name, faculty_id, subject, day_of_week, starts_at, ends_at)
    values (b2, fac_id, 'S2', 'Tuesday', '11:00', '12:00') returning id into slot2;
  insert into public.live_sessions (slot_id, host_id) values (slot1, fac_id) returning id into ls1;
  insert into public.live_sessions (slot_id, host_id) values (slot2, fac_id) returning id into ls2;
  select count(*) into n_all from public.expenses;
  select count(*) into m from public.collections;
  select id into v_sid from public.students where id = 'DBHO017';
  select id into v_sid2 from public.students where id = 'DBHO018';

  -- ---------- 1.1 notify_batch ----------
  set local role anon;
  begin perform public.notify_batch(b1,'t','x','y','z'); rep := rep || E'\n' || 'FAIL 1.1 anon notify_batch allowed';
  exception when others then rep := rep || E'\n' || 'PASS 1.1 anon cannot call notify_batch'; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub',s1,'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.notify_batch(b1,'t','x','y','z'); rep := rep || E'\n' || 'FAIL 1.1 student notify_batch allowed';
  exception when others then rep := rep || E'\n' || 'PASS 1.1 student cannot call notify_batch'; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub',fac_id,'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.notify_batch(b2,'t','x','y','z'); rep := rep || E'\n' || 'FAIL 1.1 faculty notified a batch they do not teach';
  exception when others then rep := rep || E'\n' || 'PASS 1.1 faculty cannot notify a batch they do not teach'; end;
  begin perform public.notify_batch(b1,'t','x','y','z'); rep := rep || E'\n' || 'PASS 1.1 faculty can notify own batch';
  exception when others then rep := rep || E'\n' || 'FAIL 1.1 faculty blocked on own batch: '||sqlerrm; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub',staff_id,'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.notify_batch(b1,'t','x','y','z'); rep := rep || E'\n' || 'PASS 1.1 Executive can notify';
  exception when others then rep := rep || E'\n' || 'FAIL 1.1 Executive blocked: '||sqlerrm; end;
  reset role;

  -- ---------- 1.3 expenses ----------
  perform set_config('request.jwt.claims', json_build_object('sub',s1,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.expenses;
  rep := rep || E'\n' || case when n = 0 then 'PASS 1.3 student sees 0 expenses' else 'FAIL 1.3 student sees '||n||' expenses' end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',fac_id,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.expenses;
  rep := rep || E'\n' || case when n = 0 then 'PASS 1.3 faculty sees 0 expenses' else 'FAIL 1.3 faculty sees '||n end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',staff_id,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.expenses;
  rep := rep || E'\n' || case when n = n_all then 'PASS 1.3 Executive sees all expenses' else 'FAIL 1.3 Executive sees '||n||' of '||n_all end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',admin_id,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.expenses;
  rep := rep || E'\n' || case when n = n_all then 'PASS 1.3 Admin sees all expenses' else 'FAIL 1.3 Admin sees '||n||' of '||n_all end;
  reset role;

  -- ---------- 1.4 collections_basic ----------
  perform set_config('request.jwt.claims', json_build_object('sub',s1,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*), count(*) filter (where student_id <> 'TST001') into n, st from public.collections_basic;
  rep := rep || E'\n' || case when st::int = 0 then 'PASS 1.4 student sees only own receipts ('||n||')' else 'FAIL 1.4 student sees others receipts' end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',fac_id,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.collections_basic;
  rep := rep || E'\n' || case when n = 0 then 'PASS 1.4 faculty sees 0 receipts' else 'FAIL 1.4 faculty sees '||n end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',staff_id,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.collections_basic;
  rep := rep || E'\n' || case when n = m then 'PASS 1.4 Executive sees all receipts' else 'FAIL 1.4 Executive sees '||n||' of '||m end;
  reset role;

  -- ---------- 1.5 self-grading ----------
  perform set_config('request.jwt.claims', json_build_object('sub',s1,'role','authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.assignment_submissions (assignment_id, student_id, link, marks, feedback, status, graded_by, graded_at)
      values (a_id, s1, 'http://x', 99, 'great', 'graded', s1, now());
    select marks::text||'/'||status||'/'||coalesce(graded_by::text,'null') into st
      from public.assignment_submissions where assignment_id = a_id and student_id = s1;
    rep := rep || E'\n' || case when st = '/submitted/null' then 'PASS 1.5 forged grade reset' else 'FAIL 1.5 forged grade kept: '||st end;
  exception when others then rep := rep || E'\n' || 'FAIL 1.5 submission insert errored: '||sqlerrm; end;
  begin
    insert into public.exam_attempts (exam_id, student_id, submitted_at, score, total, percentage, passed)
      values (e_id, s1, now(), 10, 10, 100, true) returning id into att_id;
    select coalesce(score::text,'null')||'/'||coalesce(submitted_at::text,'null')||'/'||coalesce(passed::text,'null') into st
      from public.exam_attempts where id = att_id;
    rep := rep || E'\n' || case when st = 'null/null/null' then 'PASS 1.5 forged exam result reset' else 'FAIL 1.5 forged exam kept: '||st end;
    perform public.score_exam_attempt(att_id);
    rep := rep || E'\n' || 'PASS 1.9 student can still call score_exam_attempt';
  exception when others then rep := rep || E'\n' || 'FAIL 1.5/1.9 exam attempt flow: '||sqlerrm; end;
  begin
    perform public.resubmit_assignment(a_id, 'http://y', null, null, false);
    rep := rep || E'\n' || 'PASS 1.9 student can still call resubmit_assignment';
  exception when others then rep := rep || E'\n' || 'FAIL 1.9 resubmit_assignment: '||sqlerrm; end;
  reset role;

  -- ---------- 1.6 notifications ----------
  perform set_config('request.jwt.claims', json_build_object('sub',s1,'role','authenticated')::text, true);
  set local role authenticated;
  begin insert into public.notifications (recipient_id, type, title) values (s2,'t','spam');
    rep := rep || E'\n' || 'FAIL 1.6 student inserted a notification';
  exception when others then rep := rep || E'\n' || 'PASS 1.6 student cannot insert notification'; end;

  -- ---------- 1.7 attendance ----------
  begin insert into public.attendance (session_id, student_id) values (ls1, s1);
    rep := rep || E'\n' || 'PASS 1.7 student marks attendance in own batch';
  exception when others then rep := rep || E'\n' || 'FAIL 1.7 own-batch attendance blocked: '||sqlerrm; end;
  begin insert into public.attendance (session_id, student_id) values (ls2, s1);
    rep := rep || E'\n' || 'FAIL 1.7 attendance in other batch allowed';
  exception when others then rep := rep || E'\n' || 'PASS 1.7 attendance in other batch refused'; end;
  reset role;

  -- ---------- 1.8 bucket ----------
  select count(*) into n from storage.buckets where id = 'submissions' and file_size_limit = 10485760 and allowed_mime_types is not null;
  rep := rep || E'\n' || case when n = 1 then 'PASS 1.8 bucket limit 10 MB + mime list set' else 'FAIL 1.8 bucket limits missing' end;

  -- ---------- 1.9 anon execute ----------
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('notify_batch','resubmit_assignment','score_exam_attempt','clear_my_must_change_password',
                       'handle_new_user','log_financial_change','delete_mistaken_student','students_fee_guard',
                       'batches_fee_guard','session_in_my_batch')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public'::name, p.oid, 'execute'));
  rep := rep || E'\n' || case when n = 0 then 'PASS 1.9 anon/public cannot execute hardened functions' else 'FAIL 1.9 '||n||' functions still anon-executable' end;
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('timetable_no_conflict','can_manage_assignment','can_manage_exam','ist_today','batch_status_for')
     and p.proconfig is null;
  rep := rep || E'\n' || case when n = 0 then 'PASS 1.9 search_path pinned' else 'FAIL 1.9 '||n||' functions without search_path' end;

  -- ---------- 1.10 fee guard ----------
  select coalesce(registration_fee,0)+coalesce(course_fee,0)+coalesce(exam_fee,0)+coalesce(other_fee,0) into v_gross from public.students where id = v_sid;
  select coalesce(sum(amount),0) into v_col from public.collections where student_id = v_sid;
  v_gap := greatest(0, v_gross - v_col);
  perform set_config('request.jwt.claims', json_build_object('sub',staff_id,'role','authenticated')::text, true);
  set local role authenticated;
  begin update public.students set course_fee = course_fee + 1 where id = v_sid;
    rep := rep || E'\n' || 'FAIL 1.10 Executive changed a fee';
  exception when others then rep := rep || E'\n' || 'PASS 1.10 Executive cannot change a fee'; end;
  begin update public.students set waiver = 5 where id = v_sid2;
    rep := rep || E'\n' || 'FAIL 1.10 Executive set a waiver';
  exception when others then rep := rep || E'\n' || 'PASS 1.10 Executive cannot set a waiver'; end;
  begin update public.students set place = 'Test place', course_fee = course_fee where id = v_sid2;
    rep := rep || E'\n' || 'PASS 1.10 Executive can edit other fields (fees unchanged)';
  exception when others then rep := rep || E'\n' || 'FAIL 1.10 Executive blocked on non-fee edit: '||sqlerrm; end;
  begin update public.students set status = 'Dropped', waiver = v_gap + 1000 where id = v_sid;
    rep := rep || E'\n' || 'FAIL 1.10 Executive over-waived on drop';
  exception when others then rep := rep || E'\n' || 'PASS 1.10 Executive cannot over-waive on drop'; end;
  begin update public.students set status = 'Dropped', waiver = v_gap where id = v_sid;
    rep := rep || E'\n' || 'PASS 1.10 Executive drop with write-off allowed';
  exception when others then rep := rep || E'\n' || 'FAIL 1.10 drop write-off blocked: '||sqlerrm; end;
  begin update public.batches set course_fee = coalesce(course_fee,0) + 1 where name = 'BATCH 7';
    rep := rep || E'\n' || 'FAIL 1.10 Executive changed batch fee';
  exception when others then rep := rep || E'\n' || 'PASS 1.10 Executive cannot change batch fee'; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',admin_id,'role','authenticated')::text, true);
  set local role authenticated;
  begin update public.students set course_fee = course_fee + 1, waiver = 7 where id = v_sid2;
    update public.batches set course_fee = coalesce(course_fee,0) + 1 where name = 'BATCH 7';
    rep := rep || E'\n' || 'PASS 1.10 Admin can change fees, waiver and batch fee';
  exception when others then rep := rep || E'\n' || 'FAIL 1.10 Admin blocked: '||sqlerrm; end;
  reset role;

  -- ---------- migration 38: delete_mistaken_student ----------
  insert into public.students (id, batch, name, course, status) values ('ZZP1TEST', 'BATCH 7', 'Phase1 Test', 'Test', 'Active');
  set local role anon;
  begin perform public.delete_mistaken_student('ZZP1TEST'); rep := rep || E'\n' || 'FAIL 38 anon deleted a student';
  exception when others then rep := rep || E'\n' || 'PASS 38 anon cannot delete a student'; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',s1,'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.delete_mistaken_student('ZZP1TEST'); rep := rep || E'\n' || 'FAIL 38 student deleted a student';
  exception when others then rep := rep || E'\n' || 'PASS 38 student cannot delete a student'; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',staff_id,'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.delete_mistaken_student('ZZP1TEST'); rep := rep || E'\n' || 'FAIL 38 Executive deleted a student';
  exception when others then rep := rep || E'\n' || 'PASS 38 Executive cannot delete a student'; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',admin_id,'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.delete_mistaken_student('TST001'); rep := rep || E'\n' || 'FAIL 38 Admin deleted a student with receipts/login';
  exception when others then rep := rep || E'\n' || 'PASS 38 Admin refused when receipts/login exist'; end;
  begin perform public.delete_mistaken_student('ZZP1TEST'); rep := rep || E'\n' || 'PASS 38 Admin can delete a clean student (any status)';
  exception when others then rep := rep || E'\n' || 'FAIL 38 Admin delete failed: '||sqlerrm; end;
  reset role;

  -- ---------- migration 39: Adjustments only on transfers ----------
  begin
    insert into public.transfers (date, from_account, to_account, amount) values (current_date, 'Adjustments', 'HDFC', 1);
    rep := rep || E'\n' || 'PASS 39 transfer from Adjustments accepted';
  exception when others then rep := rep || E'\n' || 'FAIL 39 transfer from Adjustments: '||sqlerrm; end;
  begin
    insert into public.collections (student_id, date, type, account, amount) values ('TST001', current_date, 'Course Fee', 'Adjustments', 1);
    rep := rep || E'\n' || 'FAIL 39 collections accepted Adjustments';
  exception when check_violation then rep := rep || E'\n' || 'PASS 39 collections still reject Adjustments';
    when others then rep := rep || E'\n' || 'FAIL 39 collections error was not the CHECK: '||sqlerrm; end;

  raise exception E'PHASE1 CHECK REPORT (rolled back)\n%', rep;
end
$test$;
