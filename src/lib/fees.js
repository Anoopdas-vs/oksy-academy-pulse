// Shared fee math so the Dashboard, Fee Collection page and App totals all
// agree on what a student owes.

export const grossFee = (s) =>
  Number(s.registration_fee || 0) +
  Number(s.course_fee || 0) +
  Number(s.exam_fee || 0) +
  Number(s.other_fee || 0);

// Fee due after the recorded waiver, before any drop adjustment.
export const feeAfterWaiver = (s) => grossFee(s) - Number(s.waiver || 0);

// Effective fee a student owes. A dropped student's uncollected balance is
// treated as waived, so they owe only what was actually collected from them —
// their outstanding balance becomes zero. This also covers students who were
// marked dropped before the auto-waiver existed (their waiver may be stale).
export function effectiveFeeDue(student, collectedForStudent) {
  const base = feeAfterWaiver(student);
  if (student.status === "Dropped") return Math.min(base, collectedForStudent);
  return base;
}

export const outstanding = (student, collectedForStudent) =>
  Math.max(0, effectiveFeeDue(student, collectedForStudent) - collectedForStudent);

// The flip side of outstanding(): how much MORE than they owe a student has
// paid (0 when they owe money or are paid up exactly). Outstanding is
// correctly clamped at 0 so one student's overpayment can never net against
// another student's unrelated dues — but that clamping was also silently
// hiding the overpayment itself, with nothing anywhere flagging a possible
// duplicate payment or data-entry mistake. This is for display only; it is
// never summed into expected/outstanding totals.
export const creditBalance = (student, collectedForStudent) =>
  Math.max(0, collectedForStudent - effectiveFeeDue(student, collectedForStudent));

// When a student is set to Dropped, raise their waiver enough to zero the
// remaining balance (never lowers an existing waiver).
export function waiverForDrop(student, collectedForStudent) {
  const gap = Math.max(0, grossFee(student) - collectedForStudent);
  return Math.max(Number(student.waiver || 0), gap);
}

/* ============================================================
   Canonical finance helpers — every page uses THESE so the
   same number is never computed two different ways.
   ============================================================ */

// Actual money that moved through `acct` from a set of rows (collections /
// expenses / transfers). "*" sums every row regardless of account.
export const sumByAccount = (rows, acct) =>
  rows
    .filter((r) => acct === "*" || r.account === acct)
    .reduce((s, r) => s + Number(r.amount || 0), 0);

// Independent running balance of one account.
//   balance = money in (collections) − money out (expenses)
//             + transfers in − transfers out
// P&L is never used here; this is pure cash movement.
export function accountBalance(acct, { collections = [], expenses = [], transfers = [] }) {
  const tIn = transfers.filter((t) => t.to_account === acct).reduce((s, t) => s + Number(t.amount || 0), 0);
  const tOut = transfers.filter((t) => t.from_account === acct).reduce((s, t) => s + Number(t.amount || 0), 0);
  return sumByAccount(collections, acct) - sumByAccount(expenses, acct) + tIn - tOut;
}

// Per-student and total fee position (always all-time — a receivable is a
// balance, not a period flow).
export function studentFeeTotals(students, collections) {
  const collectedByStudent = collections.reduce((m, c) => {
    m[c.student_id] = (m[c.student_id] || 0) + Number(c.amount || 0);
    return m;
  }, {});

  let expected = 0;
  let collected = 0;
  let outstandingTotal = 0;
  const byStudent = {};
  students.forEach((s) => {
    const paid = collectedByStudent[s.id] || 0;
    const exp = effectiveFeeDue(s, paid);
    const out = Math.max(0, exp - paid);
    byStudent[s.id] = { expected: exp, collected: paid, outstanding: out };
    expected += exp;
    collected += paid;
    outstandingTotal += out;
  });
  return { expected, collected, outstanding: outstandingTotal, byStudent };
}

// Fields the Fee Collection list search matches against (case-insensitive
// substring). bank_reference is included so a fee can be found by its UTR.
export const COLLECTION_SEARCH_FIELDS = ["student_id", "student_name", "type", "reference", "bank_reference"];
