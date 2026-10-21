// Unit tests for the canonical fee math in fees.js — see finding M4 in the
// engineering review. Uses Node's built-in test runner (node:test), so
// `npm test` needs no extra dependency and nothing to install.
//
// Run directly with: node --test src/lib
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  grossFee,
  feeAfterWaiver,
  effectiveFeeDue,
  outstanding,
  creditBalance,
  waiverForDrop,
  sumByAccount,
  accountBalance,
  studentFeeTotals,
} from "./fees.js";

const student = (over = {}) => ({
  id: "S1",
  registration_fee: 1000,
  course_fee: 20000,
  exam_fee: 2000,
  other_fee: 0,
  waiver: 0,
  status: "Active",
  ...over,
});

describe("grossFee / feeAfterWaiver", () => {
  test("sums all four fee components", () => {
    assert.equal(grossFee(student()), 23000);
  });

  test("treats missing fee fields as zero", () => {
    assert.equal(grossFee({}), 0);
  });

  test("subtracts the recorded waiver", () => {
    assert.equal(feeAfterWaiver(student({ waiver: 5000 })), 18000);
  });
});

describe("effectiveFeeDue", () => {
  test("an Active student owes the full amount after waiver regardless of what they've paid", () => {
    assert.equal(effectiveFeeDue(student(), 0), 23000);
    assert.equal(effectiveFeeDue(student(), 10000), 23000);
  });

  test("a Dropped student's uncollected balance is treated as waived — they owe only what they paid", () => {
    const s = student({ status: "Dropped" });
    assert.equal(effectiveFeeDue(s, 5000), 5000);
  });

  test("a Dropped student who already paid in full still owes the full (waived) amount, not more", () => {
    const s = student({ status: "Dropped" });
    assert.equal(effectiveFeeDue(s, 23000), 23000);
    assert.equal(effectiveFeeDue(s, 30000), 23000); // overpaid — due is still capped at the gross/waived fee
  });
});

describe("outstanding — the clamp that must never go negative", () => {
  test("is the positive gap between fee due and what's been collected", () => {
    assert.equal(outstanding(student(), 10000), 13000);
  });

  test("clamps to 0 rather than going negative when overpaid", () => {
    assert.equal(outstanding(student(), 30000), 0);
  });

  test("is 0 exactly at full payment", () => {
    assert.equal(outstanding(student(), 23000), 0);
  });

  test("a Dropped student with any payment recorded has zero outstanding", () => {
    const s = student({ status: "Dropped" });
    assert.equal(outstanding(s, 500), 0);
  });
});

describe("creditBalance — the flip side of outstanding(), display-only", () => {
  test("is 0 whenever outstanding() is positive (never both nonzero at once)", () => {
    const collected = 10000;
    assert.ok(outstanding(student(), collected) > 0);
    assert.equal(creditBalance(student(), collected), 0);
  });

  test("is the positive overpayment amount when collected exceeds what's due", () => {
    assert.equal(creditBalance(student(), 30000), 7000);
  });

  test("is 0 exactly at full payment — not a false positive at the boundary", () => {
    assert.equal(creditBalance(student(), 23000), 0);
  });

  test("a Dropped student shows no credit as long as they paid no more than the gross (waived) fee", () => {
    // effectiveFeeDue() for a Dropped student is min(feeAfterWaiver, collected)
    // — it tracks whatever they paid, up to a ceiling of the gross/waived
    // fee. Below that ceiling collected === effectiveFeeDue, so credit is 0.
    const s = student({ status: "Dropped" }); // gross 23000
    assert.equal(creditBalance(s, 10000), 0);
    assert.equal(creditBalance(s, 23000), 0); // exactly at the ceiling
  });

  test("a Dropped student who paid MORE than the gross/waived fee still shows the excess as credit", () => {
    // Once collected passes the ceiling, effectiveFeeDue stays capped at the
    // gross/waived fee, so the excess is a genuine overpayment signal — the
    // Dropped status doesn't swallow it.
    const s = student({ status: "Dropped" }); // gross 23000
    assert.equal(creditBalance(s, 30000), 7000);
  });
});

describe("waiverForDrop", () => {
  test("raises the waiver just enough to zero the remaining balance", () => {
    // gross 23000, collected 18000 -> gap 5000 -> new waiver 5000
    assert.equal(waiverForDrop(student(), 18000), 5000);
  });

  test("never lowers an existing waiver even if the gap is smaller", () => {
    const s = student({ waiver: 8000 });
    // gross 23000, collected 18000 -> gap 5000, but existing waiver 8000 wins
    assert.equal(waiverForDrop(s, 18000), 8000);
  });

  test("is 0 when the student has already paid the full gross fee", () => {
    assert.equal(waiverForDrop(student(), 23000), 0);
  });
});

describe("sumByAccount", () => {
  const rows = [
    { account: "HDFC", amount: 100 },
    { account: "Cash", amount: 50 },
    { account: "HDFC", amount: 25 },
  ];

  test("sums only the matching account", () => {
    assert.equal(sumByAccount(rows, "HDFC"), 125);
  });

  test("'*' sums every row regardless of account", () => {
    assert.equal(sumByAccount(rows, "*"), 175);
  });

  test("an account with no rows sums to 0", () => {
    assert.equal(sumByAccount(rows, "ICICI"), 0);
  });
});

describe("accountBalance — pure cash movement, never P&L", () => {
  test("collections in, expenses out, transfers both ways", () => {
    const data = {
      collections: [{ account: "HDFC", amount: 1000 }],
      expenses: [{ account: "HDFC", amount: 200 }],
      transfers: [
        { from_account: "HDFC", to_account: "Cash", amount: 100 },
        { from_account: "Cash", to_account: "HDFC", amount: 50 },
      ],
    };
    // 1000 - 200 - 100(out) + 50(in) = 750
    assert.equal(accountBalance("HDFC", data), 750);
  });

  test("a transfer from Adjustments moves the bank balance but not revenue/expense", () => {
    const data = {
      collections: [{ account: "ICICI", amount: 1000 }],
      expenses: [],
      transfers: [{ from_account: "Adjustments", to_account: "ICICI", amount: 1 }],
    };
    assert.equal(accountBalance("ICICI", data), 1001); // Re 1 test credit now in the book balance
    assert.equal(sumByAccount(data.collections, "*"), 1000); // revenue unchanged
  });

  test("missing arrays default to empty rather than throwing", () => {
    assert.equal(accountBalance("HDFC", {}), 0);
  });
});

describe("studentFeeTotals — per-student and fleet-wide position", () => {
  test("aggregates expected/collected/outstanding across students and matches the per-student math", () => {
    const students = [student({ id: "S1" }), student({ id: "S2", waiver: 3000 })];
    const collections = [
      { student_id: "S1", amount: 10000 },
      { student_id: "S2", amount: 20000 },
    ];
    const { expected, collected, outstanding: out, byStudent } = studentFeeTotals(students, collections);

    assert.equal(byStudent.S1.expected, 23000);
    assert.equal(byStudent.S1.outstanding, 13000);
    assert.equal(byStudent.S2.expected, 20000); // 23000 - 3000 waiver
    assert.equal(byStudent.S2.outstanding, 0); // paid exactly what's due

    assert.equal(collected, 30000);
    assert.equal(expected, 43000);
    assert.equal(out, 13000);
  });

  test("a student with no collections at all owes the full expected amount", () => {
    const { byStudent } = studentFeeTotals([student({ id: "S3" })], []);
    assert.equal(byStudent.S3.collected, 0);
    assert.equal(byStudent.S3.outstanding, 23000);
  });
});
