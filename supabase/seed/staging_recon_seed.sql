-- STAGING ONLY - never run on live.
--
-- Fake reconciliation scenarios for testing recon-v2 on the STAGING project.
-- Everything is tagged ZZ: students 'ZZ-001..003', category 'ZZ Test Category',
-- references 'ZZ-...', statement file_name 'ZZ_STAGING_SEED.xlsx'. One account
-- (HDFC), one statement, all lines left 'unmatched' so "Re-run auto-match" can
-- be exercised. Each scenario has its own date so they cannot interfere.
-- Idempotent: ZZ rows are deleted first, then re-inserted.
--
-- Expected outcomes after Re-run auto-match:
--   03-02  three 1,800 fees / lines: Sreeshma + Aboobeker name-confirmed
--          (auto_name); the unrelated-handle line stays review (name_unknown)
--   03-03  2,800 line = 2,000 + 800 fees -> auto_group
--   03-04  lines 2,000 + 800 + 2,000 vs fees 2,800 + 2,000 -> split_needed
--   03-05  1,500 line + fee with the same UTR -> auto_utr
--   03-05/06 expense 540 booked 03-05, bank 03-06 -> review, near-date suggestion
--   03-06  fee 13,000 vs bank 13,500 with the same UTR -> review, utr_amount_mismatch
--   03-09  cash deposit transfer 25,000 -> auto_exact
--   03-10  ATM withdrawal 777 -> unmatched

begin;

-- ── clean previous ZZ data (dependants first) ───────────────────────────
delete from public.bank_sync_history h
where (h.book_kind = 'collection' and h.book_id in (select id from public.collections where student_id like 'ZZ-%'))
   or (h.book_kind = 'expense'    and h.book_id in (select id from public.expenses where reference like 'ZZ-%'))
   or (h.book_kind = 'transfer'   and h.book_id in (select id from public.transfers where reference like 'ZZ-%'));
-- lines cascade to bank_match_links
delete from public.bank_statements where file_name = 'ZZ_STAGING_SEED.xlsx';
delete from public.collections where student_id like 'ZZ-%';
delete from public.expenses where reference like 'ZZ-%';
delete from public.transfers where reference like 'ZZ-%';
delete from public.students where id like 'ZZ-%';
delete from public.expense_categories where name = 'ZZ Test Category';

-- ── students, category ──────────────────────────────────────────────────
insert into public.students (id, name, status) values
  ('ZZ-001', 'Sreeshma K', 'Active'),
  ('ZZ-002', 'Aboobeker P', 'Active'),
  ('ZZ-003', 'Mayiza T', 'Active');

insert into public.expense_categories (name) values ('ZZ Test Category');

-- ── collections (book entries) ──────────────────────────────────────────
insert into public.collections (student_id, student_name, date, type, account, amount, reference, bank_reference) values
  -- 03-02 three identical fees
  ('ZZ-001', 'Sreeshma K',  '2026-03-02', 'Course Fee', 'HDFC', 1800, 'ZZ-COL-01', null),
  ('ZZ-002', 'Aboobeker P', '2026-03-02', 'Course Fee', 'HDFC', 1800, 'ZZ-COL-02', null),
  ('ZZ-003', 'Mayiza T',    '2026-03-02', 'Course Fee', 'HDFC', 1800, 'ZZ-COL-03', null),
  -- 03-03 group: 2,000 + 800
  ('ZZ-001', 'Sreeshma K',  '2026-03-03', 'Course Fee', 'HDFC', 2000, 'ZZ-COL-04', null),
  ('ZZ-002', 'Aboobeker P', '2026-03-03', 'Course Fee', 'HDFC',  800, 'ZZ-COL-05', null),
  -- 03-04 split needed: fees 2,800 + 2,000 vs three bank lines
  ('ZZ-003', 'Mayiza T',    '2026-03-04', 'Course Fee', 'HDFC', 2800, 'ZZ-COL-06', null),
  ('ZZ-001', 'Sreeshma K',  '2026-03-04', 'Course Fee', 'HDFC', 2000, 'ZZ-COL-07', null),
  -- 03-05 UTR match
  ('ZZ-002', 'Aboobeker P', '2026-03-05', 'Course Fee', 'HDFC', 1500, 'ZZ-COL-08', 'UPI/712345678901/UPI/zzpayer@ybl/SBI'),
  -- 03-06 amount diff with UTR: fee 13,000 vs bank 13,500
  ('ZZ-003', 'Mayiza T',    '2026-03-06', 'Course Fee', 'HDFC', 13000, 'ZZ-COL-09', 'UPI/823456789012/UPI/zzpayer2@ybl/SBI');

-- ── expense (date diff: booked 03-05, bank 03-06) ───────────────────────
insert into public.expenses (date, category, account, amount, reference, description) values
  ('2026-03-05', 'ZZ Test Category', 'HDFC', 540, 'ZZ-EXP-01', 'ZZ stationery');

-- ── transfer (cash deposit into HDFC) ───────────────────────────────────
insert into public.transfers (date, from_account, to_account, amount, purpose, reference, note) values
  ('2026-03-09', 'Cash', 'HDFC', 25000, 'ZZ cash deposit', 'ZZ-TRF-01', 'staging seed');

-- ── one statement + lines (all unmatched) ───────────────────────────────
do $$
declare
  sid bigint;
begin
  insert into public.bank_statements
    (account, period_start, period_end, opening_balance, closing_balance, file_name)
  values ('HDFC', '2026-03-01', '2026-03-10', 100000, 151683, 'ZZ_STAGING_SEED.xlsx')
  returning id into sid;

  insert into public.bank_statement_lines
    (statement_id, account, seq, txn_date, description, reference, withdrawal, deposit) values
    -- 03-02 names
    (sid, 'HDFC',  1, '2026-03-02', 'UPI/6110/UPI/sreeshmasreeshm@okaxis/AXIS BANK', '', 0, 1800),
    (sid, 'HDFC',  2, '2026-03-02', 'UPI/6111/UPI/aboobeker@oksbi/STATE BANK', '', 0, 1800),
    (sid, 'HDFC',  3, '2026-03-02', 'UPI/6112/UPI/randomhandle99@ybl/SBI', '', 0, 1800),
    -- 03-03 group
    (sid, 'HDFC',  4, '2026-03-03', 'NEFT CR ZZ BULK PAYMENT', '', 0, 2800),
    -- 03-04 split needed
    (sid, 'HDFC',  5, '2026-03-04', 'UPI/6120/UPI/payerone@ybl/SBI', '', 0, 2000),
    (sid, 'HDFC',  6, '2026-03-04', 'UPI/6121/UPI/payertwo@ybl/SBI', '', 0, 800),
    (sid, 'HDFC',  7, '2026-03-04', 'UPI/6122/UPI/payerthree@ybl/SBI', '', 0, 2000),
    -- 03-05 UTR match
    (sid, 'HDFC',  8, '2026-03-05', 'UPI/712345678901/UPI/zzpayer@ybl/SBI', '', 0, 1500),
    -- 03-06 expense paid (date diff) and amount diff
    (sid, 'HDFC',  9, '2026-03-06', 'POS ZZ STATIONERY', '', 540, 0),
    (sid, 'HDFC', 10, '2026-03-06', 'UPI/823456789012/UPI/zzpayer2@ybl/SBI', '', 0, 13500),
    -- 03-09 cash deposit
    (sid, 'HDFC', 11, '2026-03-09', 'CASH DEPOSIT BY SELF', '', 0, 25000),
    -- 03-10 nothing in the books
    (sid, 'HDFC', 12, '2026-03-10', 'ATM WDL ZZ', '', 777, 0);
end $$;

commit;
