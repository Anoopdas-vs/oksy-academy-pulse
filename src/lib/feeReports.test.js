import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { batchSummaryReport, feeRegisterReport, studentDuesReport, categoryMonthReport } from "./feeReports.js";

const batches = [
  { name: "DBHM-A", course_name: "DBHM", start_date: "2026-01-01", end_date: "2026-12-31" },
  { name: "ODHM-A", course_name: "ODHM", start_date: "2025-06-01", end_date: "2025-12-31" },
];
const students = [
  { id: "D1", name: "Asha", batch: "DBHM-A", course: "DBHM", status: "Active", course_fee: 20000, waiver: 0, student_phone: "9000000001" },
  { id: "D2", name: "Binu", batch: "DBHM-A", course: "DBHM", status: "Active", course_fee: 20000, waiver: 2000 },
  { id: "D3", name: "Chitra", batch: "DBHM-A", course: "DBHM", status: "Dropped", course_fee: 20000, waiver: 0 },
  { id: "O1", name: "Dev", batch: "ODHM-A", course: "ODHM", status: "Completed", course_fee: 10000, waiver: 0 },
];
const collections = [
  { id: 1, student_id: "D1", student_name: "Asha", date: "2026-02-01", type: "Course Fee", account: "ICICI", amount: 20000 },
  { id: 2, student_id: "D2", student_name: "Binu", date: "2026-02-05", type: "Course Fee", account: "Cash", amount: 6000 },
  { id: 3, student_id: "D3", student_name: "Chitra", date: "2026-02-06", type: "Course Fee", account: "HDFC", amount: 5000 },
  { id: 4, student_id: "O1", student_name: "Dev", date: "2025-07-01", type: "Course Fee", account: "ICICI", amount: 12000 },
];

describe("Batch-wise Fee Summary", () => {
  const out = batchSummaryReport.build({ students, collections, batches }, {}, null);
  const rows = out.tables[0].rows;
  const r = (b) => rows.find((x) => x.batch === b);

  test("per-batch students and fee position (dropped owes only what was paid)", () => {
    const d = r("DBHM-A");
    assert.equal(d.students, 3);
    assert.equal(d.active, 2);
    assert.equal(d.dropped, 1);
    assert.equal(d.net, 20000 + 18000 + 5000);
    assert.equal(d.collected, 31000);
    assert.equal(d.pending, 12000);
    assert.equal(Math.round(d.pct), 72);
    assert.equal(d._tone, "neg");
  });

  test("grouped by course with subtotals and a grand total", () => {
    assert.equal(rows[0]._kind, "group");
    assert.ok(rows.some((x) => x._kind === "subtotal" && x.batch === "Total DBHM"));
    const g = rows[rows.length - 1];
    assert.equal(g._kind, "total");
    assert.equal(g.collected, 43000);
    assert.ok(out.exceptions.some((e) => e.startsWith("DBHM-A: only 72%")));
  });

  test("period keeps only batches running in it", () => {
    const fy26 = batchSummaryReport.build({ students, collections, batches }, {}, { start: "2026-04-01", end: "2027-03-31" });
    assert.ok(!fy26.tables[0].rows.some((x) => x.batch === "ODHM-A"));
  });
});

describe("Fee Collection Register", () => {
  const bankLines = [{ links: [{ bookKind: "collection", bookId: 1 }] }];
  const bankStatements = [{ account: "HDFC", period_start: "2026-02-01", period_end: "2026-02-28" }];
  const out = feeRegisterReport.build({ collections, students, bankLines, bankStatements }, { group: "Account" }, { start: "2026-01-01", end: "2026-12-31" });
  const lines = out.exportTable.rows;

  test("lines carry batch and bank-match status", () => {
    assert.equal(lines.length, 3);
    const byNo = (n) => lines.find((x) => x.receiptNo === n);
    assert.equal(byNo("OKSY/000001").match, "Matched");
    assert.equal(byNo("OKSY/000002").match, "n/a");
    assert.equal(byNo("OKSY/000003").match, "Not matched");
    assert.equal(byNo("OKSY/000001").batch, "DBHM-A");
    assert.ok(out.exceptions[0].startsWith("1 bank receipt(s)"));
  });

  test("grouping adds group + subtotal rows, export stays plain", () => {
    const rows = out.tables[0].rows;
    assert.ok(rows.some((x) => x._kind === "group" && x.date.startsWith("Cash")));
    assert.ok(rows.some((x) => x._kind === "subtotal" && x.date === "Total ICICI" && x.amount === 20000));
    assert.equal(rows[rows.length - 1].amount, 31000);
    assert.ok(!lines.some((x) => x._kind));
  });

  test("no bank data (staff) -> no Bank match column", () => {
    const staff = feeRegisterReport.build({ collections, students }, {}, null);
    assert.ok(!staff.tables[0].columns.some((c) => c.key === "match"));
  });
});

describe("Student Dues", () => {
  test("balances, days since last payment and contact column only for admins", () => {
    const out = studentDuesReport.build({ students, collections, canSeeContacts: true }, {}, { start: "2026-01-01", end: "2026-06-30" });
    const rows = out.tables[0].rows;
    const binu = rows.find((x) => x.id === "D2");
    assert.equal(binu.balance, 12000);
    assert.equal(binu.days, 145); // 5 Feb -> 30 Jun 2026
    assert.equal(binu._tone, "neg");
    assert.ok(out.tables[0].columns.some((c) => c.key === "phone"));
    assert.equal(out.kpis[0].value, 12000);
    assert.ok(!rows.some((x) => x.id === "D1"), "fully paid students hidden by default");
    const staff = studentDuesReport.build({ students, collections }, {}, null);
    assert.ok(!staff.tables[0].columns.some((c) => c.key === "phone"));
  });

  test("as-on date ignores later payments", () => {
    const early = studentDuesReport.build({ students, collections }, { only: "Everyone" }, { start: "2026-01-01", end: "2026-01-31" });
    const asha = early.tables[0].rows.find((x) => x.id === "D1");
    assert.equal(asha.collected, 0);
    assert.equal(asha.lastPaid, "Never");
  });

  test("credit (overpaid) is reported", () => {
    const out = studentDuesReport.build({ students, collections }, { only: "With credit" }, null);
    const dev = out.tables[0].rows.find((x) => x.id === "O1");
    assert.equal(dev.credit, 2000);
    assert.ok(out.exceptions.some((e) => e.includes("more than their fee")));
  });
});

describe("Expense: Category × Month", () => {
  const expenses = [
    { date: "2026-04-05", category: "Rent", account: "Cash", amount: 10000 },
    { date: "2026-05-05", category: "Rent", account: "Cash", amount: 10000 },
    { date: "2026-06-05", category: "Rent", account: "ICICI", amount: 40000 },
    { date: "2026-05-10", category: "Tea", account: "Cash", amount: 600 },
  ];
  const out = categoryMonthReport.build({ expenses }, {}, { start: "2026-04-01", end: "2026-06-30" });
  const rows = out.tables[0].rows;

  test("matrix with totals, share and average", () => {
    const rent = rows[0];
    assert.equal(rent.category, "Rent");
    assert.equal(rent["2026-06"], 40000);
    assert.equal(rent.total, 60000);
    assert.equal(rent.avg, 20000);
    const total = rows[rows.length - 1];
    assert.equal(total["2026-05"], 10600);
    assert.equal(total.total, 60600);
  });

  test("spikes highlighted and listed", () => {
    assert.deepEqual(rows[0]._hot, ["2026-06"]);
    assert.ok(out.exceptions[0].startsWith("Rent in Jun 2026"));
  });

  test("account filter", () => {
    const cash = categoryMonthReport.build({ expenses }, { account: "Cash" }, { start: "2026-04-01", end: "2026-06-30" });
    assert.equal(cash.tables[0].rows[0].total, 20000);
  });
});
