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
  ORDER_ASSUMED_SCORE,
  isOrderAssumed,
  extractUtrs,
  planRerun,
  suggestSplitGroups,
  reviewCandidatesDetail,
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

  test("without any identity signal, the unique exact-date candidate (Fahmida, same day) is still matched -- never the next-day Fasila", () => {
    const blankLine = { ...bankLine, description: "", reference: "" };
    const [result] = autoMatch([blankLine], "ICICI", data, 4);
    assert.equal(result.status, "matched");
    assert.equal(result.match_id, 101);
    assert.equal(result.match_method, "exact");
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
    assert.equal(res.filter((r) => r.status === "matched").length, 1); // consumed at most once
    assert.ok(res.every((r) => !r.assumed_by_order));
  });

  test("an exact-date record is not trusted when a neighbour is a clearly better payer-identity fit", () => {
    const d = {
      collections: [col(101, "2026-08-03", 500, "Fahmida"), col(102, "2026-08-04", 500, "Fasila PM")],
    };
    // Bank line is on Fasila's day but the VPA says Fahmida.
    const [r] = autoMatch([dep("2026-08-04", 500, "UPI/9/UPI/fahmidat0181@ok/BANK/Z")], "ICICI", d);
    assert.notEqual(r.match_id, 102);
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
    assert.equal(r.match_method, "utr");
    assert.equal(r.match_score, 1);
  });

  test("extractUtrs only takes standalone 12-digit runs", () => {
    assert.deepEqual(extractUtrs("UPI/562413109000/UPI/a9876543210123456@ok"), ["562413109000"]);
    assert.deepEqual(extractUtrs("8113973475@axl"), []);
  });

  test("a UTR hit outside amount/date window is ignored", () => {
    const d = { collections: [col(2, "2025-01-01", 2000, "FAR", { bank_reference: "UPI/562413109000/x" })] };
    const [r] = autoMatch([dep("2025-09-15", 2000, "UPI/562413109000/UPI/q")], "ICICI", d);
    assert.equal(r.status, "unmatched");
  });
});

describe("autoMatch — equal-sized same date+amount groups", () => {
  const four = {
    collections: [
      col(546, "2025-09-15", 2000, "ABINSHA"),
      col(542, "2025-09-15", 2000, "FARSEENA OP"),
      col(545, "2025-09-15", 2000, "HASNA SHIRIN"),
      col(505, "2025-09-15", 2000, "FATHIMA NASRI"),
    ],
  };
  const lines4 = [
    dep("2025-09-15", 2000, "UPI/1/UPI/shakirparasseri/SI/A"),
    dep("2025-09-15", 2000, "UPI/2/UPI/sinusajjad69@ok/C/B"),
    dep("2025-09-15", 2000, "UPI/3/UPI/naniwdr@okaxis/F/C"),
    dep("2025-09-15", 2000, "UPI/4/UPI/hisanayasim@okh/K/D"),
  ];

  test("with no name evidence they pair in order (record id ascending), flagged assumed-by-order with the sentinel score", () => {
    const res = autoMatch(lines4, "ICICI", four);
    assert.deepEqual(ids(res), [505, 542, 545, 546]);
    assert.ok(res.every((r) => r.assumed_by_order && r.match_score === ORDER_ASSUMED_SCORE));
  });

  test("name evidence is used first: the decisive line gets its record; the rest fall back to order", () => {
    const lines = [
      dep("2025-09-15", 2000, "UPI/1/UPI/q1/SI/A"),
      dep("2025-09-15", 2000, "UPI/2/UPI/abinsha1234@ok/C/B"),
    ];
    const d = { collections: [col(10, "2025-09-15", 2000, "SOMEONE ELSE"), col(11, "2025-09-15", 2000, "ABINSHA")] };
    const res = autoMatch(lines, "ICICI", d);
    assert.equal(res[1].match_id, 11);
    assert.equal(res[1].assumed_by_order, undefined);
    assert.equal(res[0].match_id, 10);
    assert.equal(res[0].assumed_by_order, true);
  });

  test("unequal counts (3 lines vs 2 records) are never paired by order", () => {
    const d = { collections: [col(1, "2026-02-02", 900, "P Q"), col(2, "2026-02-02", 900, "R S")] };
    const res = autoMatch([dep("2026-02-02", 900), dep("2026-02-02", 900), dep("2026-02-02", 900)], "ICICI", d);
    assert.ok(res.every((r) => !r.assumed_by_order));
    assert.ok(res.some((r) => r.status === "review"));
  });

  test("a UTR hit inside a group is matched for certain and the remaining pair falls to order", () => {
    const d = {
      collections: [
        col(1, "2026-03-01", 2000, "A A"),
        col(2, "2026-03-01", 2000, "B B", { bank_reference: "UPI/111111111111/x" }),
        col(3, "2026-03-01", 2000, "C C"),
      ],
    };
    const lines = [dep("2026-03-01", 2000, "UPI/222222222222/UPI/p/Q"), dep("2026-03-01", 2000, "UPI/111111111111/UPI/r/Q"), dep("2026-03-01", 2000, "UPI/333333333333/UPI/s/Q")];
    const res = autoMatch(lines, "ICICI", d);
    assert.equal(res[1].match_id, 2);
    assert.equal(res[1].match_method, "utr");
    assert.deepEqual([res[0].match_id, res[2].match_id], [1, 3]);
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
