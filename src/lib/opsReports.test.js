import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { expenseRegisterReport, transfersReport, healthcareStatementReport, studentRegisterReport } from "./opsReports.js";

const FY = { start: "2026-04-01", end: "2027-03-31" };
const expenses = [
  { id: 1, date: "2026-03-10", category: "Rent", account: "Cash", amount: 10000, description: "March rent" },
  { id: 2, date: "2026-04-10", category: "Rent", account: "ICICI", amount: 15000, description: "April rent" },
  { id: 3, date: "2026-04-12", category: "Tea", account: "Cash", amount: 500, description: "" },
  { id: 4, date: "2026-05-02", category: "Salary", account: "Healthcare", amount: 30000, description: "Faculty" },
];

describe("Expense Register", () => {
  test("by category with previous-period comparison", () => {
    const out = expenseRegisterReport.build({ expenses }, {}, FY);
    const rows = out.tables[0].rows;
    const rent = rows.find((r) => r.category === "Rent");
    assert.equal(rent.amount, 15000);
    assert.equal(rent.prev, 10000);
    assert.equal(rent.chg, 50);
    assert.equal(rows[0].category, "Salary");
    assert.equal(rows[rows.length - 1].amount, 45500);
    assert.ok(out.exceptions.some((e) => e.startsWith("1 expense(s) have no description")));
  });

  test("line items carry bank-match status and export plain rows", () => {
    const bankLines = [{ links: [{ bookKind: "expense", bookId: 2 }] }];
    const out = expenseRegisterReport.build({ expenses, bankLines, bankStatements: [] }, { view: "Line items" }, FY);
    const lines = out.exportTable.rows;
    assert.equal(lines.length, 3);
    assert.equal(lines.find((r) => r.expenseId === "EXP-00002").match, "Matched");
    assert.equal(lines.find((r) => r.expenseId === "EXP-00003").match, "n/a");
    assert.equal(out.tables[0].rows.at(-1)._kind, "total");
  });
});

describe("Fund Transfers", () => {
  const transfers = [
    { id: 1, date: "2026-04-05", from_account: "Cash", to_account: "ICICI", amount: 20000, purpose: "Deposit" },
    { id: 2, date: "2026-04-20", from_account: "HDFC", to_account: "Cash", amount: 5000, purpose: "" },
    { id: 3, date: "2026-05-01", from_account: "ICICI", to_account: "Healthcare", amount: 8000, purpose: "Settlement" },
  ];
  const out = transfersReport.build({ transfers }, {}, FY);

  test("From × To matrix and totals", () => {
    const m = out.tables[0].rows;
    const cash = m.find((r) => r.from === "From Cash");
    assert.equal(cash.ICICI, 20000);
    assert.equal(cash.Cash, null);
    assert.equal(cash.total, 20000);
    const tin = m.at(-1);
    assert.equal(tin.Healthcare, 8000);
    assert.equal(tin.total, 33000);
  });

  test("KPIs and list", () => {
    assert.equal(out.kpis[2].value, 20000);
    assert.equal(out.kpis[3].value, 5000);
    assert.equal(out.exportTable.rows[0].transferId, "TRF-00003");
    assert.ok(out.exceptions.some((e) => e.includes("no purpose")));
  });
});

describe("Healthcare Account Statement", () => {
  const collections = [
    { id: 1, date: "2026-03-01", account: "Healthcare", amount: 5000, student_name: "Old" },
    { id: 2, date: "2026-04-03", account: "Healthcare", amount: 10000, student_name: "Asha" },
  ];
  const hcExpenses = [{ id: 1, date: "2026-04-10", account: "Healthcare", category: "Salary", amount: 25000 }];
  const transfers = [{ id: 1, date: "2026-04-20", from_account: "ICICI", to_account: "Healthcare", amount: 4000 }];
  const out = healthcareStatementReport.build({ collections, expenses: hcExpenses, transfers }, {}, FY);
  const rows = out.tables[0].rows;

  test("opening, running balance and closing", () => {
    assert.equal(rows[0].particulars, "Opening balance");
    assert.equal(rows[0].balance, 5000);
    assert.equal(rows[1].credit, 10000);
    assert.equal(rows[1].balance, 15000);
    assert.equal(rows[2].debit, 25000);
    assert.equal(rows[2].balance, -10000);
    assert.equal(rows[2].position, "Academy owes");
    const close = rows.at(-1);
    assert.equal(close.balance, -6000);
    assert.equal(close.credit, 14000);
    assert.equal(close.debit, 25000);
    assert.equal(out.kpis[3].label, "Closing · Academy owes Healthcare");
    assert.equal(out.kpis[3].value, 6000);
    assert.ok(out.exceptions[0].startsWith("To settle: the Academy should pay Healthcare ₹6,000"));
  });
});

describe("Student Register", () => {
  const students = [
    { id: "D1", name: "A", course: "DBHM", batch: "B1", status: "Active", enrollment_date: "2026-04-02", lead_source: "Instagram", course_fee: 1000 },
    { id: "D2", name: "B", course: "DBHM", batch: "B1", status: "Dropped", enrollment_date: "2026-01-02", course_fee: 1000 },
    { id: "O1", name: "C", course: "ODHM", batch: "B2", status: "Completed", enrollment_date: "2025-06-02", course_fee: 1000 },
  ];
  const out = studentRegisterReport.build({ students, collections: [] }, {}, FY);

  test("course × status summary and KPIs", () => {
    const sum = out.tables[0].rows;
    const dbhm = sum.find((r) => r.course === "DBHM");
    assert.equal(dbhm.Active, 1);
    assert.equal(dbhm.Dropped, 1);
    assert.equal(dbhm.dropRate, 50);
    assert.equal(sum.at(-1).total, 3);
    assert.equal(out.kpis.find((k) => k.label === "New this period").value, 1);
  });

  test("Excel keeps the upload-template columns; data gaps flagged", () => {
    assert.equal(out.exportTable.columns[0].label, "Student ID");
    assert.equal(out.exportTable.rows.length, 3);
    assert.ok(out.exceptions.some((e) => e.startsWith("Lead source is filled for only 33%")));
  });
});
