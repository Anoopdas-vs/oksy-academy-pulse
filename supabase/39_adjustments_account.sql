-- Migration 39: "Adjustments" counter-account for transfers
--
-- Why: bank items that are neither income nor expense (e.g. a Re 1 test credit
-- from an unknown sender, partner drawings) must still move the bank balance so
-- the book balance equals the statement. They are recorded as a TRANSFER
-- between the bank account and "Adjustments". Transfers are never revenue or
-- expense, already count in account balances, can be matched to bank lines and
-- carry a bank_reference. Nothing else changes.
--
-- Scope: ONLY transfers.from_account / transfers.to_account accept it.
-- collections.account and expenses.account are NOT changed.
-- Additive and idempotent. Rollback: re-add the old constraints after deleting
-- any transfer that uses 'Adjustments'.
-- TODO: fold into schema.sql during Step 16.

-- Drop whichever CHECK constraints currently guard from_account / to_account
-- (their names may differ between environments), then add the new ones.
do $$
declare c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.transfers'::regclass
      and contype = 'c'
      and (pg_get_constraintdef(oid) ilike '%from_account%'
           or pg_get_constraintdef(oid) ilike '%to_account%')
      and conname <> 'transfers_distinct_accounts'
  loop
    execute format('alter table public.transfers drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.transfers
  add constraint transfers_from_account_check
  check (from_account in ('HDFC', 'ICICI', 'Cash', 'Healthcare', 'Adjustments'));
alter table public.transfers
  add constraint transfers_to_account_check
  check (to_account in ('HDFC', 'ICICI', 'Cash', 'Healthcare', 'Adjustments'));
