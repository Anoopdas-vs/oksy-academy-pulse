// Unit tests for the bank-reconciliation helpers in reconcile.js — see
// finding M4 in the engineering review. Node's built-in test runner
// (node:test); `npm test` needs no extra dependency.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  accountLedger,
  bookBalanceAsOf,
  autoMatch,
  reconciliationSummary,
  nameSimilarity,
  identityMatchScore,
  bankReferenceMismatches,
  matchedRecordDetail,
} from "./reconcile.js";

describe("accountLedger", () => {
  test("collections are positive, expenses negative, transfers signed by direction", () => {
    const data = {
      collections: [
        { id: 1, account: "HDFC", date: "2026-01-05", amount: 1000 },
        { id: 2, account: "Cash", date: "2026-01-05", amount: 999 }, // different account, excluded
      ],
      expenses: [{ id: 1, account: "HDFC", date: "2026-01-06", amount: 300 }],
      transfers: [
        { id: 1, from_account: "HDFC", to_account: "Cash", date: "2026-01-07", amount: 100 },
        { id: 2, from_account: "Cash", to_account: "HDFC", date: "2026-01-08", amount: 50 },
      ],
    };
    const entries = accountLedger("HDFC", data);
    // collection(+1000), expense(-300), transfer out to Cash(-100), transfer
    // in from Cash(+50) — both legs of a transfer produce an entry on their
    // respective account, so the Cash->HDFC transfer shows up here too.
    assert.equal(entries.length, 4);
    assert.deepEqual(entries.map((e) => e.delta), [1000, -300, -100, 50]);
  });
});

describe("bookBalanceAsOf", () => {
  const data = {
    collections: [
      { id: 1, account: "HDFC", date: "2026-01-05", amount: 1000 },
      { id: 2, account: "HDFC", date: "2026-02-01", amount: 500 }, // after cutoff
    ],
    expenses: [],
    transfers: [],
  };

  test("only includes entries on or before the cutoff date", () => {
    assert.equal(bookBalanceAsOf("HDFC", "2026-01-31", data), 1000);
  });

  test("a null/undefined cutoff includes everything (all-time)", () => {
    assert.equal(bookBalanceAsOf("HDFC", null, data), 1500);
  });
});

describe("autoMatch", () => {
  const data = {
    collections: [{ id: 1, account: "HDFC", date: "2026-01-05", amount: 1000 }],
    expenses: [{ id: 1, account: "HDFC", date: "2026-01-20", amount: 300 }],
    transfers: [],
  };

  test("matches a deposit line to a collection of the same amount within the day window", () => {
    const lines = [{ date: "2026-01-06", deposit: 1000, withdrawal: 0 }];
    const [result] = autoMatch(lines, "HDFC", data, 4);
    assert.equal(result.status, "matched");
    assert.equal(result.match_kind, "collection");
    assert.equal(result.match_id, 1);
  });

  test("matches a withdrawal line to an expense", () => {
    const lines = [{ date: "2026-01-21", deposit: 0, withdrawal: 300 }];
    const [result] = autoMatch(lines, "HDFC", data, 4);
    assert.equal(result.status, "matched");
    assert.equal(result.match_kind, "expense");
  });

  test("does not match when the date is outside the day window", () => {
    const lines = [{ date: "2026-01-15", deposit: 1000, withdrawal: 0 }]; // 10 days from the collection
    const [result] = autoMatch(lines, "HDFC", data, 4);
    assert.equal(result.status, "unmatched");
  });

  test("does not match a deposit line against an expense (wrong direction) even with equal amount/date", () => {
    const lines = [{ date: "2026-01-20", deposit: 300, withdrawal: 0 }];
    const [result] = autoMatch(lines, "HDFC", data, 4);
    assert.equal(result.status, "unmatched");
  });

  test("each app entry is consumed at most once — a second identical line doesn't double-match", () => {
    const lines = [
      { date: "2026-01-06", deposit: 1000, withdrawal: 0 },
      { date: "2026-01-06", deposit: 1000, withdrawal: 0 },
    ];
    const [first, second] = autoMatch(lines, "HDFC", data, 4);
    assert.equal(first.status, "matched");
    assert.equal(second.status, "unmatched");
  });
});

describe("reconciliationSummary", () => {
  test("reconciled is true only when nothing is open and the statement matches the book to the rupee", () => {
    const data = {
      collections: [{ id: 1, account: "HDFC", date: "2026-01-05", amount: 1000 }],
      expenses: [],
      transfers: [],
    };
    const statement = { account: "HDFC", period_end: "2026-01-31", closing_balance: 1000 };
    const lines = [{ status: "matched" }];
    const result = reconciliationSummary(statement, lines, data);
    assert.equal(result.bookBalance, 1000);
    assert.equal(result.difference, 0);
    assert.equal(result.openCount, 0);
    assert.equal(result.reconciled, true);
  });

  test("is not reconciled while any line is still unmatched, even if the totals happen to agree", () => {
    const data = {
      collections: [{ id: 1, account: "HDFC", date: "2026-01-05", amount: 1000 }],
      expenses: [],
      transfers: [],
    };
    const statement = { account: "HDFC", period_end: "2026-01-31", closing_balance: 1000 };
    const lines = [{ status: "unmatched" }];
    const result = reconciliationSummary(statement, lines, data);
    assert.equal(result.openCount, 1);
    assert.equal(result.reconciled, false);
  });

  test("is not reconciled when the statement closing balance disagrees with the book balance", () => {
    const data = {
      collections: [{ id: 1, account: "HDFC", date: "2026-01-05", amount: 1000 }],
      expenses: [],
      transfers: [],
    };
    const statement = { account: "HDFC", period_end: "2026-01-31", closing_balance: 1200 };
    const lines = [{ status: "matched" }];
    const result = reconciliationSummary(statement, lines, data);
    assert.equal(result.difference, 200);
    assert.equal(result.reconciled, false);
  });
});
describe("identity matching (payer name vs bank description)", () => {
  test("a UPI VPA local-part scores high against the matching first name", () => {
    const score = identityMatchScore(
      "UPI/621570429059/UPI/fahmidat0181@ok/BANK OF INDIA/AXIc2b74e1b1d7f4e569bdc565c1cb1b678",
      "",
      "Fahmida"
    );
    assert.ok(score > 0.6, `expected a strong match, got ${score}`);
  });

  test("the same VPA scores low against an unrelated name", () => {
    const score = identityMatchScore(
      "UPI/621570429059/UPI/fahmidat0181@ok/BANK OF INDIA/AXIc2b74e1b1d7f4e569bdc565c1cb1b678",
      "",
      "Fasila PM"
    );
    assert.ok(score < 0.4, `expected a weak match, got ${score}`);
  });

  test("nameSimilarity treats a shared prefix as a strong signal", () => {
    assert.ok(nameSimilarity("fahmidat", "fahmida") > 0.8);
  });
});

describe("autoMatch — same-amount, same-day collision (regression, Fahmida/Fasila case)", () => {
  // Reproduces the bug from the task brief: Fahmida paid Rs 500 on
  // 2026-08-03, Fasila PM paid Rs 500 on 2026-08-04. The old amount-only
  // matcher paired the bank line with whichever collection it found first,
  // regardless of date or payer -- here that meant Fahmida's payment got
  // matched to Fasila's collection record.
  const data = {
    collections: [
      { id: 101, account: "ICICI", date: "2026-08-03", amount: 500, student_name: "Fahmida" },
      { id: 102, account: "ICICI", date: "2026-08-04", amount: 500, student_name: "Fasila PM" },
    ],
    expenses: [],
    transfers: [],
  };
  const bankLine = {
    date: "2026-08-03",
    description: "UPI/621570429059/UPI/fahmidat0181@ok/BANK OF INDIA/AXIc2b74e1b1d7f4e569bdc565c1cb1b678",
    reference: "",
    deposit: 500,
    withdrawal: 0,
  };

  test("matches to Fahmida's collection (correct date + payer identity), never Fasila's", () => {
    const [result] = autoMatch([bankLine], "ICICI", data, 4);
    assert.equal(result.status, "matched");
    assert.equal(result.match_kind, "collection");
    assert.equal(result.match_id, 101);
  });

  test("without any identity signal in the description, the same two candidates are flagged for review instead of guessed", () => {
    const blankLine = { ...bankLine, description: "", reference: "" };
    const [result] = autoMatch([blankLine], "ICICI", data, 4);
    assert.equal(result.status, "review");
    assert.equal(result.candidates.length, 2);
    const ids = result.candidates.map((c) => c.match_id).sort();
    assert.deepEqual(ids, [101, 102]);
  });

  test("two same-amount, same-day candidates with no decisive identity signal are never silently auto-matched", () => {
    const sameDayData = {
      collections: [
        { id: 201, account: "ICICI", date: "2026-08-03", amount: 500, student_name: "Amina Rasheed" },
        { id: 202, account: "ICICI", date: "2026-08-03", amount: 500, student_name: "Amina Basheer" },
      ],
      expenses: [],
      transfers: [],
    };
    const ambiguousLine = {
      date: "2026-08-03",
      description: "UPI/1234/UPI/amina9876@ok/SBI/UTR1",
      reference: "",
      deposit: 500,
      withdrawal: 0,
    };
    const [result] = autoMatch([ambiguousLine], "ICICI", sameDayData, 4);
    // Both candidates are named "Amina" -- identity alone can't cleanly
    // separate them, so this must not be guessed.
    assert.equal(result.status, "review");
  });
});

describe("bankReferenceMismatches", () => {
  test("flags a collection whose bank_reference clearly names a different person", () => {
    const collections = [
      {
        id: 1,
        date: "2026-08-04",
        student_name: "Fasila PM",
        amount: 500,
        bank_reference: "UPI/621570429059/UPI/fahmidat0181@ok/BANK OF INDIA/UTR1",
      },
      {
        id: 2,
        date: "2026-08-03",
        student_name: "Fahmida",
        amount: 500,
        bank_reference: "UPI/621570429059/UPI/fahmidat0181@ok/BANK OF INDIA/UTR1",
      },
    ];
    const mismatches = bankReferenceMismatches(collections);
    assert.equal(mismatches.length, 1);
    assert.equal(mismatches[0].id, 1);
  });

  test("collections without a bank_reference are ignored", () => {
    const mismatches = bankReferenceMismatches([{ id: 1, student_name: "Anyone", amount: 100 }]);
    assert.equal(mismatches.length, 0);
  });
});

describe("matchedRecordDetail — bank reference row", () => {
  test("shows a Bank reference row for a matched expense that has one", () => {
    const line = { match_kind: "expense", match_id: 1 };
    const data = {
      expenses: [
        { id: 1, date: "2026-01-05", category: "Rent", account: "HDFC", amount: 500, bank_reference: "NEFT/RENT/JAN" },
      ],
    };
    const detail = matchedRecordDetail(line, data);
    assert.ok(detail.rows.some((r) => r.k === "Bank reference" && r.v === "NEFT/RENT/JAN"));
  });

  test("omits the Bank reference row for an expense without one", () => {
    const line = { match_kind: "expense", match_id: 1 };
    const data = { expenses: [{ id: 1, date: "2026-01-05", category: "Rent", account: "HDFC", amount: 500 }] };
    const detail = matchedRecordDetail(line, data);
    assert.ok(!detail.rows.some((r) => r.k === "Bank reference"));
  });

  test("shows a Bank reference row for a matched transfer that has one", () => {
    const line = { match_kind: "transfer", match_id: 1 };
    const data = {
      transfers: [
        {
          id: 1,
          date: "2026-01-05",
          from_account: "HDFC",
          to_account: "Cash",
          amount: 200,
          bank_reference: "ATM WDL 200",
        },
      ],
    };
    const detail = matchedRecordDetail(line, data);
    assert.ok(detail.rows.some((r) => r.k === "Bank reference" && r.v === "ATM WDL 200"));
  });

  test("omits the Bank reference row for a transfer without one", () => {
    const line = { match_kind: "transfer", match_id: 1 };
    const data = {
      transfers: [{ id: 1, date: "2026-01-05", from_account: "HDFC", to_account: "Cash", amount: 200 }],
    };
    const detail = matchedRecordDetail(line, data);
    assert.ok(!detail.rows.some((r) => r.k === "Bank reference"));
  });
});
