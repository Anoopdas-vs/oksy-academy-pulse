// Unit tests for the bank-reconciliation helpers in reconcile.js — see
// finding M4 in the engineering review. Node's built-in test runner
// (node:test); `npm test` needs no extra dependency.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  accountLedger,
  bookBalanceAsOf,
  reconciliationSummary,
  nameSimilarity,
  identityMatchScore,
  bankReferenceMismatches,
  matchedRecordDetail,
  ORDER_ASSUMED_SCORE,
  isOrderAssumed,
  extractUtrs,
  planRerun,
  suggestSplitGroups,
  reviewCandidatesDetail,
  matchStatementLines,
  describeLine,
  attachLinks,
  linksToLinePatch,
  isLinkConflict,
  ledgerByKeyOf,
  buildReconRows,
  reviewHints,
  reconFilterCounts,
  reconRowMatchesFilter,
  LINK_CONFLICT_MESSAGE,
} from "./reconcile.js";


// Thin adapter so the older single-match expectations below read the same
// way against matchStatementLines (first link mirrored as match_kind/id).
const autoMatch = (lines, account, data, _dayWindow, opts) =>
  matchStatementLines(lines, account, { collections: [], expenses: [], transfers: [], ...data }, opts).map((r) => ({
    ...r,
    match_kind: r.links[0]?.bookKind,
    match_id: r.links[0]?.bookId,
  }));

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

  test("a deposit one day off a collection of the same amount is only suggested, never auto-linked", () => {
    const lines = [{ date: "2026-01-06", deposit: 1000, withdrawal: 0 }];
    const [result] = autoMatch(lines, "HDFC", data, 4);
    assert.equal(result.status, "review");
    assert.equal(result.reason, "near_date_suggestion");
    assert.equal(result.match_id, undefined);
  });

  test("matches a same-date deposit line to a collection of the same amount", () => {
    const lines = [{ date: "2026-01-05", deposit: 1000, withdrawal: 0 }];
    const [result] = autoMatch(lines, "HDFC", data, 4);
    assert.equal(result.status, "matched");
    assert.equal(result.match_kind, "collection");
    assert.equal(result.match_id, 1);
  });

  test("matches a withdrawal line to an expense", () => {
    const lines = [{ date: "2026-01-20", deposit: 0, withdrawal: 300 }];
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

  test("an entry two identical lines both want is handed to neither (never guessed)", () => {
    const lines = [
      { date: "2026-01-05", deposit: 1000, withdrawal: 0 },
      { date: "2026-01-05", deposit: 1000, withdrawal: 0 },
    ];
    const [first, second] = autoMatch(lines, "HDFC", data, 4);
    assert.equal(first.status, "review");
    assert.equal(second.status, "review");
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

  test("without any identity signal, the unique exact-date candidate (Fahmida, same day) is still matched -- never the next-day Fasila", () => {
    const blankLine = { ...bankLine, description: "", reference: "" };
    const [result] = autoMatch([blankLine], "ICICI", data, 4);
    assert.equal(result.status, "matched");
    assert.equal(result.match_id, 101);
    assert.equal(result.links[0].source, "auto_exact");
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

/* ---- exact-date / UTR / group / re-run passes (production statement #8 shapes) ---- */

const col = (id, date, amount, student_name, extra = {}) => ({ id, account: "ICICI", date, amount, student_name, ...extra });
const dep = (date, amount, description = "UPI/1/UPI/zzz0000@ok/BANK/X", extra = {}) => ({
  date,
  deposit: amount,
  withdrawal: 0,
  description,
  reference: "-",
  ...extra,
});
const ids = (results) => results.map((r) => r.match_id ?? null);

describe("autoMatch — unique exact date + amount (lines #13/#14 shape)", () => {
  const data = {
    collections: [
      col(93, "2025-08-21", 1500, "NAJLA NASRIN"),
      col(91, "2025-08-22", 1500, "HISANA SHERIN"),
      col(96, "2025-08-24", 1500, "RAFEEDHA"),
    ],
  };
  test("each line takes its own exact-date record even with no name evidence and same-amount neighbours in the window", () => {
    const res = autoMatch([dep("2025-08-21", 1500), dep("2025-08-22", 1500)], "ICICI", data);
    assert.deepEqual(res.map((r) => r.status), ["matched", "matched"]);
    assert.deepEqual(ids(res), [93, 91]);
    assert.ok(res.every((r) => !r.assumed_by_order));
  });

  test("lines #25/#28 shape: each has one exact record and neither steals the other's", () => {
    const d = { collections: [col(117, "2025-09-11", 1500, "HIBA SHERIN"), col(544, "2025-09-15", 1500, "FARSEENA OP")] };
    const res = autoMatch([dep("2025-09-11", 1500), dep("2025-09-15", 1500)], "ICICI", d);
    assert.deepEqual(ids(res), [117, 544]);
  });

  test("a record claimed as exact-date by two lines is not handed to either by the exact pass", () => {
    const d = { collections: [col(1, "2026-01-05", 700, "A B")] };
    const res = autoMatch([dep("2026-01-05", 700), dep("2026-01-05", 700)], "ICICI", d);
    assert.equal(res.filter((r) => r.status === "matched").length, 0); // contested: neither gets it
  });

});

describe("autoMatch — UTR pass", () => {
  test("a record carrying the line's 12-digit UTR wins over an exact-date record", () => {
    const d = {
      collections: [
        col(1, "2025-09-15", 2000, "EXACT DATE"),
        col(2, "2025-09-13", 2000, "HAS UTR", { reference: "Bank: UPI/562413109000/UPI/x/ICI" }),
      ],
    };
    const [r] = autoMatch([dep("2025-09-15", 2000, "UPI/562413109000/UPI/shakirparasseri/South IndianBa/ICI0")], "ICICI", d);
    assert.equal(r.match_id, 2);
    assert.equal(r.links[0].source, "auto_utr");
  });

  test("extractUtrs only takes standalone 12-digit runs", () => {
    assert.deepEqual(extractUtrs("UPI/562413109000/UPI/a9876543210123456@ok"), ["562413109000"]);
    assert.deepEqual(extractUtrs("8113973475@axl"), []);
  });

  test("a UTR hit with equal amount links even when the dates differ (the UTR is the evidence)", () => {
    const d = { collections: [col(2, "2025-01-01", 2000, "FAR", { bank_reference: "UPI/562413109000/x" })] };
    const [r] = autoMatch([dep("2025-09-15", 2000, "UPI/562413109000/UPI/q")], "ICICI", d);
    assert.equal(r.status, "matched");
    assert.equal(r.links[0].source, "auto_utr");
  });
});

describe("autoMatch — consumed records", () => {
  test("usedKeys seeds records that must not be matched again", () => {
    const d = { collections: [col(1, "2026-01-05", 1000, "X Y")] };
    const [r] = autoMatch([dep("2026-01-05", 1000)], "ICICI", d, 4, { usedKeys: ["collection:1"] });
    assert.equal(r.status, "unmatched");
  });
});

describe("planRerun — only touches open lines", () => {
  const data = {
    collections: [col(1, "2026-04-01", 1500, "A B"), col(2, "2026-04-02", 1500, "C D"), col(3, "2026-04-03", 800, "E F")],
  };
  const row = (id, seq, txn_date, deposit, status, extra = {}) => ({
    id, seq, account: "ICICI", txn_date, deposit, withdrawal: 0, description: "UPI/x", reference: "-", status, ...extra,
  });
  const lines = [
    row(10, 1, "2026-04-01", 1500, "review"),
    row(11, 2, "2026-04-02", 1500, "matched", { match_kind: "collection", match_id: 2 }),
    row(12, 3, "2026-04-03", 800, "ignored"),
    row(13, 4, "2026-04-09", 5000, "unmatched"),
  ];

  test("matched/ignored lines never appear in the plan; the held record is not reused", () => {
    const plan = planRerun(lines, lines, "ICICI", data);
    assert.deepEqual(plan.map((c) => c.line.id), [10]);
    assert.equal(plan[0].old_status, "review");
    assert.equal(plan[0].new_status, "matched");
    assert.equal(plan[0].match_id, 1);
  });

  test("lines whose outcome is unchanged are omitted", () => {
    const plan = planRerun(lines, lines, "ICICI", data);
    assert.ok(!plan.some((c) => c.line.id === 13));
  });

  test("a record held by a matched line of another statement is excluded", () => {
    const all = [...lines, row(99, 1, "2026-04-01", 1500, "matched", { match_kind: "collection", match_id: 1 })];
    const plan = planRerun(lines, all, "ICICI", data);
    assert.equal(plan.length, 1);
    assert.equal(plan[0].new_status, "unmatched"); // record 1 is taken, so nothing to match
    assert.equal(plan[0].match_id, null);
  });
});

describe("suggestSplitGroups — suggestion only", () => {
  const row = (id, seq, txn_date, deposit) => ({
    id, seq, account: "ICICI", txn_date, deposit, withdrawal: 0, description: "UPI/x", reference: "-", status: "unmatched",
  });

  test("one 3600 line is suggested as the 1800 + 1800 pair on the same day (OKSY/000224 + 000225)", () => {
    const d = { collections: [col(224, "2025-12-08", 1800, "SHIBILA KH"), col(225, "2025-12-08", 1800, "FAISHA")] };
    const lines = [row(1, 104, "2025-12-08", 3600)];
    const [s] = suggestSplitGroups(lines, lines, "ICICI", d);
    assert.equal(s.total, 3600);
    assert.deepEqual(s.options[0].map((e) => e.id).sort(), [224, 225]);
  });

  test("lines 2000 + 800 + 2000 are suggested as 3000 + 1800 (many lines to fewer records)", () => {
    const d = {
      collections: [col(243, "2025-12-15", 3000, "NASIYA"), col(245, "2025-12-15", 1800, "HIBA SHERIN")],
    };
    const lines = [row(1, 122, "2025-12-15", 2000), row(2, 123, "2025-12-15", 800), row(3, 124, "2025-12-15", 2000)];
    const out = suggestSplitGroups(lines, lines, "ICICI", d);
    const group = out.find((s) => s.lines.length === 3);
    assert.equal(group.total, 4800);
    assert.deepEqual(group.options[0].map((e) => e.id).sort(), [243, 245]);
  });

  test("suggestions never alter statuses and ignore records already held", () => {
    const d = { collections: [col(224, "2025-12-08", 1800, "A"), col(225, "2025-12-08", 1800, "B")] };
    const lines = [row(1, 104, "2025-12-08", 3600)];
    const held = [{ ...row(9, 1, "2025-12-08", 1800), status: "matched", match_kind: "collection", match_id: 224 }];
    assert.deepEqual(suggestSplitGroups(lines, [...lines, ...held], "ICICI", d), []);
    assert.equal(lines[0].status, "unmatched");
  });
});

describe("review tooltip + assumed-by-order flag", () => {
  test("reviewCandidatesDetail lists the same window candidates (calendar-day math, from txn_date)", () => {
    const d = { collections: [col(1, "2026-01-05", 1000, "A B"), col(2, "2026-01-11", 1000, "C D")] };
    const detail = reviewCandidatesDetail(
      { account: "ICICI", txn_date: "2026-01-06", deposit: 1000, withdrawal: 0, description: "", reference: "" },
      d
    );
    assert.equal(detail.rows.length, 1); // 2026-01-11 is 5 days out, outside the 4-day window
  });

  test("isOrderAssumed reads the sentinel score only on matched lines", () => {
    assert.equal(isOrderAssumed({ status: "matched", match_score: String(ORDER_ASSUMED_SCORE) }), true);
    assert.equal(isOrderAssumed({ status: "matched", match_score: "0.94" }), false);
    assert.equal(isOrderAssumed({ status: "review", match_score: null }), false);
  });
});

describe("matchStatementLines — link-based passes", () => {
  const col = (id, date, amount, extra = {}) => ({ id, account: "HDFC", date, amount, student_name: `S${id}`, ...extra });
  const exp = (id, date, amount, extra = {}) => ({ id, account: "HDFC", date, amount, category: "Misc", ...extra });
  const cr = (seq, date, deposit, extra = {}) => ({ seq, date, deposit, withdrawal: 0, description: "", reference: "", ...extra });
  const dr = (seq, date, withdrawal, extra = {}) => ({ seq, date, deposit: 0, withdrawal, description: "", reference: "", ...extra });
  const run = (lines, data, opts) =>
    matchStatementLines(lines, "HDFC", { collections: [], expenses: [], transfers: [], ...data }, opts);

  test("UTR match with equal amount links as auto_utr", () => {
    const [r] = run(
      [cr(1, "2026-03-05", 1800, { description: "UPI/123456789012/x" })],
      { collections: [col(7, "2026-03-09", 1800, { bank_reference: "UPI 123456789012" })] }
    );
    assert.equal(r.status, "matched");
    assert.deepEqual(r.links, [{ bookKind: "collection", bookId: 7, source: "auto_utr" }]);
  });

  test("UTR with a different amount goes to review, not linked (utr_amount_mismatch)", () => {
    const [r] = run(
      [cr(1, "2026-03-05", 1800, { description: "UPI/123456789012/x" })],
      { collections: [col(7, "2026-03-05", 2000, { bank_reference: "123456789012" })] }
    );
    assert.equal(r.status, "review");
    assert.equal(r.reason, "utr_amount_mismatch");
    assert.deepEqual(r.links, []);
    assert.equal(r.candidates[0].bookId, 7);
  });

  test("three identical 1,800 lines vs three identical 1,800 collections one day: none auto-linked, all review", () => {
    const res = run(
      [1, 2, 3].map((n) => cr(n, "2026-03-05", 1800)),
      { collections: [1, 2, 3].map((n) => col(n, "2026-03-05", 1800)) }
    );
    res.forEach((r) => {
      assert.equal(r.status, "review");
      assert.deepEqual(r.links, []);
      assert.equal(r.candidates.length, 3);
    });
  });

  test("one 2,800 line = 2,000 + 800 same day, unique combination -> auto_group", () => {
    const [r] = run(
      [cr(1, "2026-03-05", 2800)],
      { collections: [col(1, "2026-03-05", 2000), col(2, "2026-03-05", 800)] }
    );
    assert.equal(r.status, "matched");
    assert.deepEqual(r.links.map((k) => k.source), ["auto_group", "auto_group"]);
    const books = r.links.map((k) => ({ date: "2026-03-05", amount: k.bookId === 1 ? 2000 : 800 }));
    const d = describeLine({ txn_date: "2026-03-05", deposit: 2800, withdrawal: 0 }, books);
    assert.equal(d.result, "GROUP");
    assert.equal(d.amountDiff, 0);
    assert.deepEqual(d.bookAmounts, ["2,000.00", "800.00"]);
  });

  test("lines 2,000 + 800 + 2,000 vs entries 2,800 + 2,000 same day: not linked, flagged split_needed", () => {
    const res = run(
      [cr(1, "2026-03-05", 2000), cr(2, "2026-03-05", 800), cr(3, "2026-03-05", 2000)],
      { collections: [col(1, "2026-03-05", 2800), col(2, "2026-03-05", 2000)] }
    );
    res.forEach((r) => {
      assert.deepEqual(r.links, []);
      assert.equal(r.status, "review");
      assert.equal(r.reason, "split_needed");
    });
  });

  test("expense one day before the bank date, unique amount -> review near-date suggestion, dateDiff 1", () => {
    const [r] = run([dr(1, "2026-03-06", 540)], { expenses: [exp(4, "2026-03-05", 540)] });
    assert.equal(r.status, "review");
    assert.equal(r.reason, "near_date_suggestion");
    assert.deepEqual(r.links, []);
    assert.equal(r.candidates[0].bookId, 4);
    assert.equal(r.candidates[0].dateDiff, 1);
    assert.equal(r.candidates[0].suggested, true);
  });

  test("an entry already linked (usedKeys) is never offered to another line", () => {
    const [r] = run(
      [cr(1, "2026-03-05", 1800)],
      { collections: [col(1, "2026-03-05", 1800)] },
      { usedKeys: ["collection:1"] }
    );
    assert.equal(r.status, "unmatched");
    assert.deepEqual(r.candidates, []);
  });

  test("an entry is used by at most one line within a run", () => {
    const res = run(
      [cr(1, "2026-03-05", 1800), cr(2, "2026-03-05", 1800)],
      { collections: [col(1, "2026-03-05", 1800)] }
    );
    assert.equal(res.filter((r) => r.links.length).length, 0);
  });

  test("a credit never matches an expense; a debit never matches a collection", () => {
    const [c] = run([cr(1, "2026-03-05", 500)], { expenses: [exp(1, "2026-03-05", 500)] });
    const [d] = run([dr(1, "2026-03-05", 500)], { collections: [col(1, "2026-03-05", 500)] });
    assert.equal(c.status, "unmatched");
    assert.equal(d.status, "unmatched");
  });

  test("a single unique exact date + amount pair links as auto_exact", () => {
    const [r] = run([cr(1, "2026-03-05", 1800)], { collections: [col(9, "2026-03-05", 1800)] });
    assert.deepEqual(r.links, [{ bookKind: "collection", bookId: 9, source: "auto_exact" }]);
  });
});

describe("describeLine", () => {
  const line = { txn_date: "2026-03-05", deposit: 1800, withdrawal: 0 };
  test("MATCH: one link, no date or amount gap", () => {
    const d = describeLine(line, [{ date: "2026-03-05", amount: 1800 }]);
    assert.deepEqual([d.result, d.dateDiff, d.amountDiff], ["MATCH", 0, 0]);
  });
  test("GROUP: two links summing to the line", () => {
    const d = describeLine(
      { txn_date: "2026-03-05", deposit: 2800, withdrawal: 0 },
      [{ date: "2026-03-05", amount: 2000 }, { date: "2026-03-05", amount: 800 }]
    );
    assert.equal(d.result, "GROUP");
    assert.deepEqual(d.bookAmounts, ["2,000.00", "800.00"]);
  });
  test("a group with a date gap is DATE_DIFF and still returns bookAmounts", () => {
    const d = describeLine(
      { txn_date: "2026-03-05", deposit: 2800, withdrawal: 0 },
      [{ date: "2026-03-04", amount: 2000 }, { date: "2026-03-05", amount: 800 }]
    );
    assert.equal(d.result, "DATE_DIFF");
    assert.equal(d.dateDiff, 1);
    assert.deepEqual(d.bookAmounts, ["2,000.00", "800.00"]);
  });
  test("DATE_DIFF: amount equal, book dated a day earlier", () => {
    const d = describeLine(line, [{ date: "2026-03-04", amount: 1800 }]);
    assert.deepEqual([d.result, d.dateDiff, d.amountDiff], ["DATE_DIFF", 1, 0]);
  });
  test("AMOUNT_DIFF takes priority and is bank minus the sum of books", () => {
    const d = describeLine(line, [{ date: "2026-03-04", amount: 1700 }]);
    assert.deepEqual([d.result, d.amountDiff], ["AMOUNT_DIFF", 100]);
  });
  test("UNMATCHED with no links; REVIEW when the line status is review", () => {
    assert.equal(describeLine(line, []).result, "UNMATCHED");
    assert.equal(describeLine({ ...line, status: "review" }, []).result, "REVIEW");
  });
});

describe("link read/write helpers", () => {
  test("attachLinks prefers link rows and falls back to match_kind/match_id", () => {
    const lines = [
      { id: 1, status: "matched", match_kind: "collection", match_id: 5 },
      { id: 2, status: "matched", match_kind: "expense", match_id: 8 },
      { id: 3, status: "unmatched", match_kind: null, match_id: null },
    ];
    const out = attachLinks(lines, [
      { line_id: 1, book_kind: "collection", book_id: 5, source: "auto_exact" },
      { line_id: 1, book_kind: "collection", book_id: 6, source: "auto_group" },
    ]);
    assert.equal(out[0].links.length, 2);
    assert.deepEqual(out[1].links, [{ bookKind: "expense", bookId: 8, source: "legacy" }]);
    assert.deepEqual(out[2].links, []);
  });

  test("linksToLinePatch mirrors the first link into match_kind/match_id", () => {
    const p = linksToLinePatch(
      [{ bookKind: "collection", bookId: 5 }, { bookKind: "collection", bookId: 6 }],
      { userId: "u1", now: "T" }
    );
    assert.deepEqual(p, { status: "matched", match_kind: "collection", match_id: 5, matched_at: "T", matched_by: "u1" });
  });

  test("a unique violation is recognised and has a clear message", () => {
    assert.equal(isLinkConflict({ code: "23505" }), true);
    assert.equal(isLinkConflict({ message: "boom" }), false);
    assert.match(LINK_CONFLICT_MESSAGE, /already linked to another bank line/);
  });
});

describe("matchStatementLines — name tie-break", () => {
  const col = (id, name, extra = {}) => ({ id, account: "HDFC", date: "2026-03-05", amount: 1800, student_name: name, ...extra });
  const cr = (seq, description) => ({ seq, date: "2026-03-05", deposit: 1800, withdrawal: 0, description, reference: "" });
  const run = (lines, collections) => matchStatementLines(lines, "HDFC", { collections }, {});

  test("links only when exactly one candidate's name is in the payer text (auto_name, name_confirmed)", () => {
    const [r] = run(
      [cr(1, "UPI/401/UPI/aboobeker12@okaxis/AXIS BANK")],
      [col(1, "Sreeshma K"), col(2, "Aboobeker P"), col(3, "Mayiza")]
    );
    assert.equal(r.status, "matched");
    assert.deepEqual(r.links, [{ bookKind: "collection", bookId: 2, source: "auto_name" }]);
    assert.equal(r.reason, "name_confirmed");
  });

  test("two candidates that both match the payer -> review (name_ambiguous)", () => {
    const [r] = run(
      [cr(1, "UPI/401/UPI/amina9876@okaxis/SBI")],
      [col(1, "Amina Rasheed"), col(2, "Amina Basheer")]
    );
    assert.equal(r.status, "review");
    assert.equal(r.reason, "name_ambiguous");
    assert.deepEqual(r.links, []);
  });

  test("a payer that matches nobody -> review (name_unknown)", () => {
    const [r] = run([cr(1, "UPI/401/UPI/zzqxjw@okaxis/SBI")], [col(1, "Sreeshma K"), col(2, "Mayiza")]);
    assert.equal(r.status, "review");
    assert.equal(r.reason, "name_unknown");
    assert.equal(r.candidates.length, 2);
  });

  test("a name token under 4 letters never matches", () => {
    const [r] = run([cr(1, "UPI/401/UPI/ann0001@okaxis/SBI")], [col(1, "Ann"), col(2, "Bob")]);
    assert.equal(r.status, "review");
    assert.equal(r.reason, "name_unknown");
  });

  test("sibling case: one payer text names two students -> review, nothing linked", () => {
    const [r] = run(
      [cr(1, "UPI/401/UPI/rasheedfamily@okaxis/SBI")],
      [col(1, "Rasheed Anas"), col(2, "Rasheed Hana")]
    );
    assert.equal(r.status, "review");
    assert.equal(r.reason, "name_ambiguous");
  });

  test("an entry name-matched by two open lines is not linked to either", () => {
    const res = run(
      [cr(1, "UPI/1/UPI/sreeshma@okaxis/SBI"), cr(2, "UPI/2/UPI/sreeshma2@okaxis/SBI")],
      [col(1, "Sreeshma K"), col(2, "Mayiza")]
    );
    res.forEach((r) => {
      assert.equal(r.status, "review");
      assert.deepEqual(r.links, []);
    });
  });

  test("regression: three 1,800 lines vs three 1,800 fees with names present -> two name-confirmed, the unrelated one stays in review", () => {
    const res = run(
      [
        cr(1, "UPI/1/UPI/sreeshmasreeshm@okaxis/AXIS BANK"),
        cr(2, "UPI/2/UPI/aboobeker@oksbi/SBI"),
        cr(3, "UPI/3/UPI/unrelatedhandle@ybl/SBI"),
      ],
      [col(1, "Sreeshma"), col(2, "Aboobeker"), col(3, "Mayiza")]
    );
    assert.deepEqual(res.map((r) => r.links[0]?.bookId ?? null), [1, 2, null]);
    assert.equal(res[2].status, "review");
    assert.equal(res[2].reason, "name_unknown");
    assert.ok(res.slice(0, 2).every((r) => r.links[0].source === "auto_name"));
  });

  test("the same three lines with no names in the descriptions stay entirely in review", () => {
    const res = run([cr(1, ""), cr(2, ""), cr(3, "")], [col(1, "Sreeshma"), col(2, "Aboobeker"), col(3, "Mayiza")]);
    assert.ok(res.every((r) => r.status === "review" && r.links.length === 0));
  });
});

describe("planRerun — uses the same passes", () => {
  test("a re-run never guesses by order and never links a near-date entry", () => {
    const data = { collections: [{ id: 1, account: "HDFC", date: "2026-04-01", amount: 900, student_name: "A B" }] };
    const row = (id, seq, txn_date) => ({
      id, seq, account: "HDFC", txn_date, deposit: 900, withdrawal: 0, description: "", reference: "", status: "unmatched",
    });
    const lines = [row(1, 1, "2026-04-02")];
    const plan = planRerun(lines, lines, "HDFC", data);
    assert.equal(plan[0].new_status, "review");
    assert.equal(plan[0].reason, "near_date_suggestion");
    assert.deepEqual(plan[0].links, []);
  });
});

describe("buildReconRows — review table rows", () => {
  const data = {
    collections: [
      { id: 236, account: "HDFC", date: "2026-03-05", amount: 1800, student_name: "A" },
      { id: 245, account: "HDFC", date: "2026-03-06", amount: 2000, student_name: "B" },
      { id: 243, account: "HDFC", date: "2026-03-06", amount: 800, student_name: "C" },
      { id: 300, account: "HDFC", date: "2026-03-07", amount: 13000, student_name: "D" },
    ],
    expenses: [{ id: 273, account: "HDFC", date: "2026-03-05", amount: 540, category: "Misc" }],
    transfers: [{ id: 12, from_account: "Cash", to_account: "HDFC", date: "2026-03-09", amount: 25000 }],
  };
  const ledger = ledgerByKeyOf(data);
  const line = (id, extra) => ({
    id, seq: id, status: "matched", txn_date: "2026-03-05", description: "x", deposit: 0, withdrawal: 0, links: [], ...extra,
  });
  const link = (bookKind, bookId, source = "auto_exact") => ({ bookKind, bookId, source });
  const rowOf = (ln, hints) => buildReconRows([ln], ledger, hints)[0];

  test("MATCH: one link, human book id, zero diffs, CR direction", () => {
    const r = rowOf(line(1, { deposit: 1800, links: [link("collection", 236)] }));
    assert.equal(r.result, "MATCH");
    assert.equal(r.direction, "CR");
    assert.equal(r.bankAmount, 1800);
    assert.equal(r.links[0].label, "OKSY/000236");
    assert.deepEqual([r.dateDiff, r.amountDiff], [0, 0]);
  });

  test("GROUP: two entries stay in ONE row with bookAmounts as an array", () => {
    const rows = buildReconRows(
      [line(2, { txn_date: "2026-03-06", deposit: 2800, links: [link("collection", 245, "auto_group"), link("collection", 243, "auto_group")] })],
      ledger
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].result, "GROUP");
    assert.deepEqual(rows[0].links.map((k) => k.label), ["OKSY/000245", "OKSY/000243"]);
    assert.deepEqual(rows[0].bookAmounts, ["2,000.00", "800.00"]);
    assert.deepEqual(rows[0].bookDates, ["2026-03-06", "2026-03-06"]);
  });

  test("DATE_DIFF: expense booked a day before the bank date, DR direction", () => {
    const r = rowOf(line(3, { txn_date: "2026-03-06", withdrawal: 540, links: [link("expense", 273)] }));
    assert.equal(r.result, "DATE_DIFF");
    assert.equal(r.direction, "DR");
    assert.equal(r.dateDiff, 1);
    assert.equal(r.links[0].label, "EXP-00273");
  });

  test("AMOUNT_DIFF: bank 13,500 vs fee 13,000 is bank minus books", () => {
    const r = rowOf(line(4, { txn_date: "2026-03-07", deposit: 13500, links: [link("collection", 300, "auto_utr")] }));
    assert.equal(r.result, "AMOUNT_DIFF");
    assert.equal(r.amountDiff, 500);
  });

  test("REVIEW: carries the hint reason and an unlinked near-date suggestion", () => {
    const hints = new Map([
      [5, { reason: "near_date_suggestion", candidates: [{ bookKind: "expense", bookId: 273, date: "2026-03-05", amount: 540, dateDiff: 1, suggested: true }] }],
    ]);
    const r = rowOf(line(5, { status: "review", txn_date: "2026-03-06", withdrawal: 540 }), hints);
    assert.equal(r.result, "REVIEW");
    assert.equal(r.reason, "near_date_suggestion");
    assert.deepEqual(r.links, []);
    assert.equal(r.suggestion.label, "EXP-00273");
    assert.equal(r.suggestion.dateDiff, 1);
  });

  test("UNMATCHED: no links, no hint, no reason", () => {
    const r = rowOf(line(6, { status: "unmatched", withdrawal: 777 }));
    assert.equal(r.result, "UNMATCHED");
    assert.equal(r.reason, null);
    assert.equal(r.suggestion, null);
  });

  test("a transfer link shows its TRF code; ignored lines get result IGNORED", () => {
    const t = rowOf(line(7, { txn_date: "2026-03-09", deposit: 25000, links: [link("transfer", 12)] }));
    assert.equal(t.links[0].label, "TRF-00012");
    assert.equal(t.result, "MATCH");
    assert.equal(rowOf(line(8, { status: "ignored" })).result, "IGNORED");
  });

  test("reviewHints re-runs the matcher read-only and keeps only review lines", () => {
    const lines = [
      { id: 1, seq: 1, account: "HDFC", status: "review", txn_date: "2026-03-06", description: "", reference: "", withdrawal: 540, deposit: 0 },
      { id: 2, seq: 2, account: "HDFC", status: "unmatched", txn_date: "2026-03-10", description: "", reference: "", withdrawal: 777, deposit: 0 },
    ];
    const hints = reviewHints(lines, lines, "HDFC", data);
    assert.equal(hints.get(1).reason, "near_date_suggestion");
    assert.equal(hints.has(2), false);
  });

  test("filter counts and row filtering", () => {
    const rows = buildReconRows(
      [
        line(1, { deposit: 1800, links: [link("collection", 236)] }),
        line(2, { txn_date: "2026-03-06", deposit: 2800, links: [link("collection", 245), link("collection", 243)] }),
        line(3, { txn_date: "2026-03-06", withdrawal: 540, links: [link("expense", 273)] }),
        line(4, { txn_date: "2026-03-07", deposit: 13500, links: [link("collection", 300)] }),
        line(5, { status: "review", withdrawal: 1 }),
        line(6, { status: "unmatched", withdrawal: 2 }),
        line(7, { status: "ignored", withdrawal: 3 }),
      ],
      ledger
    );
    assert.deepEqual(reconFilterCounts(rows), {
      all: 7, match: 1, group: 1, date_diff: 1, amount_diff: 1, review: 1, unmatched: 1, ignored: 1,
    });
    assert.equal(rows.filter((r) => reconRowMatchesFilter(r, "all")).length, 7);
    assert.deepEqual(rows.filter((r) => reconRowMatchesFilter(r, "group")).map((r) => r.lineId), [2]);
  });
});
