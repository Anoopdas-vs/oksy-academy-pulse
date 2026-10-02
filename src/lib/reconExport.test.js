import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  buildReconExportModel,
  buildReconWorkbook,
  reconExportFileName,
  RECON_HEADER,
  BOOK_ONLY_HEADER,
  dateCell,
} from "./reconExport.js";
import { attachLinks, reconciliationSummary } from "./reconcile.js";

const data = {
  collections: [
    { id: 245, account: "HDFC", date: "2026-03-06", amount: 2000, student_name: "B" },
    { id: 243, account: "HDFC", date: "2026-03-06", amount: 800, student_name: "C", bank_reference: "UPI 1" },
    { id: 236, account: "HDFC", date: "2026-03-05", amount: 1800, student_name: "A" },
    { id: 300, account: "HDFC", date: "2026-03-20", amount: 999, student_name: "Book only person", bank_reference: "REF-9" },
  ],
  expenses: [{ id: 273, account: "HDFC", date: "2026-03-05", amount: 540, category: "Misc" }],
  transfers: [],
};
const statement = { id: 1, account: "HDFC", file_name: "march.xlsx", period_start: "2026-03-01", period_end: "2026-03-31", closing_balance: 5000 };
const L = (id, seq, date, description, withdrawal, deposit, status, extra = {}) => ({
  id, seq, statement_id: 1, account: "HDFC", txn_date: date, description, reference: "", withdrawal, deposit, status,
  match_kind: null, match_id: null, ...extra,
});
const rawLines = [
  L(1, 1, "2026-03-06", "NEFT group", 0, 2800, "matched", { match_kind: "collection", match_id: 245 }),
  L(2, 2, "2026-03-05", '=HYPERLINK("http://x","click")', 0, 1800, "matched", { match_kind: "collection", match_id: 236 }),
  L(3, 3, "2026-03-06", "POS", 540, 0, "review"),
  L(4, 4, "2026-03-10", "ATM", 777, 0, "unmatched"),
];
const lines = attachLinks(rawLines, [
  { line_id: 1, book_kind: "collection", book_id: 245, source: "auto_group" },
  { line_id: 1, book_kind: "collection", book_id: 243, source: "auto_group" },
  { line_id: 2, book_kind: "collection", book_id: 236, source: "auto_utr" },
]);
const model = buildReconExportModel({ statement, lines, allLines: lines, data, summary: reconciliationSummary(statement, lines, data) });
const sheet = (name) => model.sheets.find((s) => s.name === name);
const val = (c) => c.v;

describe("recon Excel export model", () => {
  test("sheets are Reconciliation, Book only, Summary; header columns are in the agreed order", () => {
    assert.deepEqual(model.sheets.map((s) => s.name), ["Reconciliation", "Book only", "Summary"]);
    assert.deepEqual(sheet("Reconciliation").header, RECON_HEADER);
    assert.equal(RECON_HEADER.join("|"), [
      "Bank No", "Bank Date", "Description", "Cr/Dr", "Bank Amount", "Book Source", "Book ID(s)", "Book Date(s)",
      "Book Amount(s)", "Book Total", "Date Diff", "Amount Diff", "Result", "Link Type", "Reason", "Suggested Book ID",
    ].join("|"));
    assert.deepEqual(sheet("Book only").header, BOOK_ONLY_HEADER);
  });

  test("a group is ONE row with comma-separated ids and amounts, a numeric total and link type Group", () => {
    const rows = sheet("Reconciliation").rows;
    assert.equal(rows.length, 4);
    const g = rows[0].map(val);
    assert.equal(g[5], "Fee");
    assert.equal(g[6], "OKSY/000245, OKSY/000243");
    assert.equal(g[8], "2,000.00, 800.00");
    assert.equal(g[9], 2800);
    assert.equal(g[10], 0);
    assert.equal(g[11], 0);
    assert.equal(g[12], "Group");
    assert.equal(g[13], "Group");
  });

  test("dates are Excel serial numbers with dd-mmm-yyyy, amounts are numbers with #,##0.00", () => {
    const row = sheet("Reconciliation").rows[1];
    assert.deepEqual(row[1], { t: "n", v: 46086, z: "dd-mmm-yyyy" }); // 2026-03-05
    assert.deepEqual(row[4], { t: "n", v: 1800, z: "#,##0.00" });
    assert.equal(row[7].t, "n"); // single book date stays a real date
    assert.deepEqual(dateCell("1900-03-01").v, 61);
  });

  test("review row carries the reason in plain words and the suggested Book ID; unmatched rows leave diffs empty", () => {
    const rows = sheet("Reconciliation").rows;
    assert.equal(rows[2][12].v, "Review");
    assert.equal(rows[2][14].v, "Near-date suggestion");
    assert.equal(rows[2][15].v, "EXP-00273");
    assert.equal(rows[3][12].v, "Unmatched");
    assert.equal(rows[3][10].v, "");
    assert.equal(rows[2][10].v, "");
  });

  test("Book only lists unlinked entries of the period; Summary has the totals and per-result counts", () => {
    const bo = sheet("Book only").rows.map((r) => r.map(val));
    assert.ok(bo.some((r) => r[0] === "OKSY/000300" && r[4] === 999 && r[5] === "REF-9"));
    assert.ok(!bo.some((r) => r[0] === "OKSY/000245"));
    const sum = Object.fromEntries(sheet("Summary").rows.map((r) => [r[0].v, r[1].v]));
    assert.equal(sum.Account, "HDFC");
    assert.equal(sum["Statement closing"], 5000);
    assert.equal(sum.Match, 1);
    assert.equal(sum.Group, 1);
    assert.equal(sum.Review, 1);
    assert.equal(sum.Unmatched, 1);
    assert.equal(sum["All bank lines"], 4);
  });

  test("file name carries the account and period", () => {
    assert.equal(reconExportFileName(statement), "Reconciliation_HDFC_2026-03-01_to_2026-03-31.xlsx");
  });
});

describe("recon Excel workbook: text is never a formula", () => {
  const wb = buildReconWorkbook(XLSX, model);
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const back = XLSX.read(buf, { type: "buffer", cellDates: false });
  const ws = back.Sheets.Reconciliation;

  test("a description starting with '=' is a plain string cell with no formula", () => {
    const cell = ws.C3; // row 3 = bank line 2
    assert.equal(cell.t, "s");
    assert.equal(cell.v, '=HYPERLINK("http://x","click")');
    assert.equal(cell.f, undefined);
    Object.values(ws).forEach((c) => {
      if (c && typeof c === "object" && "f" in c) assert.fail("formula cell found");
    });
  });

  test("autofilter and column widths are set; Description column is wide", () => {
    assert.ok(wb.Sheets.Reconciliation["!autofilter"].ref.startsWith("A1:"));
    assert.ok(wb.Sheets.Reconciliation["!cols"][2].wch >= 50);
    assert.equal(ws.B2.t, "n");
    assert.equal(ws.B2.v, 46086 + 1); // bank line 1 is 2026-03-06
  });
});
