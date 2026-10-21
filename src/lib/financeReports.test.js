import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { pnlReport, monthlyReport, cashBankReport, accountWiseReport } from "./financeReports.js";

const FY = { start: "2026-04-01", end: "2027-03-31" };
const collections = [
  // previous FY
  { id: 1, date: "2026-02-10", type: "Course Fee", account: "Cash", amount: 10000 },
  // this FY
  { id: 2, date: "2026-04-05", type: "Registration Fee", account: "Cash", amount: 2000 },
  { id: 3, date: "2026-04-20", type: "Course Fee", account: "ICICI", amount: 30000 },
  { id: 4, date: "2026-05-02", type: "Course Fee", account: "ICICI", amount: 8000 },
];
const expenses = [
  { id: 1, date: "2026-03-01", category: "Rent", account: "Cash", amount: 5000 },
  { id: 2, date: "2026-04-10", category: "Rent", account: "ICICI", amount: 20000 },
  { id: 3, date: "2026-05-15", category: "Salary", account: "ICICI", amount: 25000 },
];
const transfers = [{ id: 1, date: "2026-04-06", from_account: "Cash", to_account: "ICICI", amount: 1000 }];
const rowOf = (rows, line) => rows.find((r) => r.line === line);

describe("Profit & Loss", () => {
  const out = pnlReport.build({ collections, expenses }, {}, FY);
  const rows = out.tables[0].rows;

  test("income by fee type, expenses by category, net = A − B", () => {
    assert.equal(rowOf(rows, "Registration Fee").cur, 2000);
    assert.equal(rowOf(rows, "Course Fee").cur, 38000);
    assert.equal(rowOf(rows, "Total Income (A)").cur, 40000);
    assert.equal(rowOf(rows, "Total Expenses (B)").cur, 45000);
    assert.equal(rowOf(rows, "NET PROFIT / (LOSS)  (A − B)").cur, -5000);
    assert.equal(rows[0]._kind, "group");
  });

  test("compares with the previous FY", () => {
    const course = rowOf(rows, "Course Fee");
    assert.equal(course.prev, 10000);
    assert.equal(course.chg, 28000);
    assert.equal(course.chgPct, 280);
    assert.ok(out.tables[0].columns.some((c) => c.key === "prev"));
    assert.equal(rowOf(rows, "Rent")._invert, true);
  });

  test("KPIs and attention items", () => {
    assert.equal(out.kpis[2].value, -5000);
    assert.equal(out.kpis[2].tone, "neg");
    assert.ok(out.exceptions.some((e) => e.startsWith("Net loss")));
    assert.ok(out.exceptions.some((e) => e.startsWith("Rent:")), "Rent 20,000 vs 5,000 is flagged");
    assert.ok(out.exceptions.some((e) => e.startsWith("Salary:")), "new Salary 25,000 is flagged");
  });

  test("all time has no comparison columns", () => {
    const all = pnlReport.build({ collections, expenses }, {}, null);
    assert.ok(!all.tables[0].columns.some((c) => c.key === "prev"));
  });
});

describe("Monthly Income vs Expense", () => {
  const students = [
    { id: "A", enrollment_date: "2026-04-03" },
    { id: "B", enrollment_date: "2026-04-25" },
    { id: "C", enrollment_date: "2025-12-01" },
  ];
  const out = monthlyReport.build({ collections, expenses, students }, {}, FY);
  const rows = out.tables[0].rows;

  test("12 months + total, running cumulative net", () => {
    assert.equal(rows.length, 13);
    assert.equal(rows[0].month, "Apr 2026");
    assert.equal(rows[0].income, 32000);
    assert.equal(rows[0].expense, 20000);
    assert.equal(rows[0].net, 12000);
    assert.equal(rows[1].cumulative, 12000 + (8000 - 25000));
    assert.equal(rows[0].admissions, 2);
    const total = rows[12];
    assert.equal(total._kind, "total");
    assert.equal(total.net, -5000);
    assert.equal(total.admissions, 2);
  });

  test("loss months are flagged and charted", () => {
    assert.equal(rows[1]._tone, "neg");
    assert.ok(out.exceptions[0].startsWith("May 2026"));
    assert.equal(out.chart.points.length, 12);
    assert.equal(out.kpis[3].value, "1 of 2");
  });
});

describe("Cash & Bank Position", () => {
  const bankStatements = [{ account: "ICICI", period_end: "2026-04-30", closing_balance: 9500 }];
  const out = cashBankReport.build({ collections, expenses, transfers, bankStatements }, {}, FY);
  const [cash, hdfc, icici, total] = out.tables[0].rows;

  test("opening + in − out = closing per account", () => {
    // Cash: opening 10000 − 5000 = 5000; +2000 fees; −1000 transfer out
    assert.equal(cash.opening, 5000);
    assert.equal(cash.closing, 6000);
    // ICICI: 0 + 38000 fees + 1000 in − 45000 paid
    assert.equal(icici.closing, -6000);
    assert.equal(total.closing, 0);
    assert.equal(out.kpis[0].value, total.closing, "Total funds KPI = TOTAL row (not double-counted)");
    assert.equal(hdfc.stDate, "No statement");
  });

  test("statement check uses the book balance on the statement date", () => {
    // Book ICICI on 2026-04-30: 30000 + 1000 − 20000 = 11000; statement 9500
    assert.equal(icici.stBal, 9500);
    assert.equal(icici.diff, -1500);
    assert.ok(out.exceptions.some((e) => e.startsWith("ICICI: bank statement")));
    assert.ok(out.exceptions.some((e) => e.startsWith("HDFC: no bank statement")));
  });

  test("month-end balance table", () => {
    const months = out.tables[1].rows;
    assert.equal(months[0].month, "Apr 2026");
    assert.equal(months[0].ICICI, 11000);
    assert.equal(months[0].Cash, 6000);
  });
});

describe("Account-wise Income, Expense & Balance", () => {
  const hc = [
    ...collections,
    { id: 9, date: "2026-06-01", type: "Course Fee", account: "Healthcare", amount: 4000 },
  ];
  const ex = [...expenses, { id: 9, date: "2026-06-02", category: "Rent", account: "Healthcare", amount: 6000 }];
  const out = accountWiseReport.build({ collections: hc, expenses: ex, transfers }, {}, FY);
  const rows = out.tables[0].rows;
  const r = (line) => rows.find((x) => x.line === line);

  test("income by fee type per account", () => {
    assert.equal(r("Registration Fee").Cash, 2000);
    assert.equal(r("Course Fee").ICICI, 38000);
    assert.equal(r("Course Fee").Healthcare, 4000);
    assert.equal(r("Course Fee").total, 42000);
    assert.equal(r("Total Income (A)").total, 44000);
  });

  test("expenses by category per account", () => {
    assert.equal(r("Rent").ICICI, 20000);
    assert.equal(r("Rent").Healthcare, 6000);
    assert.equal(r("Salary").ICICI, 25000);
    assert.equal(r("Total Expenses (B)").total, 51000);
  });

  test("transfers and balances reconcile", () => {
    assert.equal(r("Transfers in").ICICI, 1000);
    assert.equal(r("Transfers out").Cash, -1000);
    assert.equal(r("Transfers in").total + r("Transfers out").total, 0);
    const open = rows.find((x) => String(x.line).startsWith("Opening balance"));
    assert.equal(open.Cash, 5000); // 10000 fee − 5000 rent before Apr 2026
    const close = r("Closing balance");
    assert.equal(close.Cash, 6000);
    assert.equal(close.ICICI, -6000);
    assert.equal(close.Healthcare, -2000);
    assert.equal(out.kpis[3].label, "Academy owes Healthcare");
    assert.equal(out.kpis[3].value, 2000);
    assert.ok(out.exceptions.some((e) => e.startsWith("ICICI closing balance is negative")));
  });
});
