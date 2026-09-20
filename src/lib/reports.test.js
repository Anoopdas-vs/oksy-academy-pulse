// Unit tests for the Reports tab's export column shape in reports.js —
// covers the "Bank Reference" column added alongside the existing
// "Reference" column so bank-statement-derived references (from bank
// reconciliation) are visible in report/Excel downloads without adding a
// new always-visible column to the main portal tables.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { REPORTS } from "./reports.js";

const byId = (id) => REPORTS.find((r) => r.id === id);

describe("fee-collection report", () => {
  test("includes a Bank Reference column and carries collections.bank_reference through to the row", () => {
    const report = byId("fee-collection");
    const collections = [
      {
        id: 1,
        student_id: "S1",
        student_name: "Fahmida",
        date: "2026-01-05",
        type: "Course Fee",
        account: "HDFC",
        reference: "RCPT-001",
        bank_reference: "UPI/fahmidat0181@ok/UTR1",
        amount: 500,
      },
    ];
    const { columns, rows } = report.build({ collections }, {}, null);
    assert.ok(columns.some((c) => c.key === "bankReference" && c.label === "Bank Reference"));
    assert.equal(rows[0].bankReference, "UPI/fahmidat0181@ok/UTR1");
  });

  test("defaults to an empty string when bank_reference is missing", () => {
    const report = byId("fee-collection");
    const collections = [
      { id: 1, student_id: "S1", student_name: "X", date: "2026-01-05", type: "Course Fee", account: "HDFC", amount: 500 },
    ];
    const { rows } = report.build({ collections }, {}, null);
    assert.equal(rows[0].bankReference, "");
  });

  // Receipt No / Student ID must round-trip with the bulk-upload template
  // (App.jsx parseReceiptNo) so an exported report can be re-uploaded to
  // update the matching collection.
  test("carries a formatted Receipt No and separate Student ID / Student Name columns", () => {
    const report = byId("fee-collection");
    const collections = [
      { id: 7, student_id: "DBHM001", student_name: "Fahmida", date: "2026-01-05", type: "Course Fee", account: "HDFC", amount: 500 },
    ];
    const { columns, rows } = report.build({ collections }, {}, null);
    assert.ok(columns.some((c) => c.key === "receiptNo" && c.label === "Receipt No"));
    assert.ok(columns.some((c) => c.key === "studentId" && c.label === "Student ID"));
    assert.ok(columns.some((c) => c.key === "studentName" && c.label === "Student Name"));
    assert.equal(rows[0].receiptNo, "OKSY/000007");
    assert.equal(rows[0].studentId, "DBHM001");
    assert.equal(rows[0].studentName, "Fahmida");
  });
});

describe("expense-analysis report (line items)", () => {
  test("includes a Bank Reference column and carries expenses.bank_reference through to the row", () => {
    const report = byId("expense-analysis");
    const expenses = [
      {
        id: 1,
        date: "2026-01-05",
        category: "Rent",
        account: "HDFC",
        description: "Office rent",
        bank_reference: "NEFT/RENT/JAN",
        amount: 1000,
      },
    ];
    const { columns, rows } = report.build({ expenses }, { view: "Line items" }, null);
    assert.ok(columns.some((c) => c.key === "bankReference" && c.label === "Bank Reference"));
    assert.equal(rows[0].bankReference, "NEFT/RENT/JAN");
  });

  // Expense ID must round-trip with the bulk-upload template (App.jsx
  // parseExpenseId) so an exported report can be re-uploaded to update the
  // matching expense. Reference was previously dropped from this export
  // even though it's captured on entry/import — closing that gap here.
  test("includes a formatted Expense ID column and a Reference column", () => {
    const report = byId("expense-analysis");
    const expenses = [
      { id: 42, date: "2026-01-05", category: "Rent", account: "HDFC", reference: "RENT-002", amount: 1000 },
    ];
    const { columns, rows } = report.build({ expenses }, { view: "Line items" }, null);
    assert.ok(columns.some((c) => c.key === "expenseId" && c.label === "Expense ID"));
    assert.ok(columns.some((c) => c.key === "reference" && c.label === "Reference"));
    assert.equal(rows[0].expenseId, "EXP-00042");
    assert.equal(rows[0].reference, "RENT-002");
  });
});

describe("transfers report", () => {
  test("includes a Bank Reference column and carries transfers.bank_reference through to the row", () => {
    const report = byId("transfers");
    const transfers = [
      {
        id: 1,
        date: "2026-01-05",
        from_account: "HDFC",
        to_account: "Cash",
        purpose: "Cash withdrawal",
        reference: "TRF-001",
        bank_reference: "ATM WDL 200",
        amount: 200,
      },
    ];
    const { columns, rows } = report.build({ transfers }, {}, null);
    assert.ok(columns.some((c) => c.key === "bankReference" && c.label === "Bank Reference"));
    assert.equal(rows[0].bankReference, "ATM WDL 200");
  });
});
