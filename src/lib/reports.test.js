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
