// Excel export of one bank statement's reconciliation (New view data).
// `xlsx` is only imported inside exportReconExcel(), so it stays out of the
// entry bundle; this module itself is loaded on click via dynamic import().
//
// Notes on this xlsx build (SheetJS CE 0.20.3): cell styles (colours) and
// frozen panes are NOT written, so the workbook ships without them. Every
// text value is written as a string cell (never a formula), and dates are
// written as Excel serial numbers with a dd-mmm-yyyy format so no timezone
// shift can move them by a day.

import { daysBetweenISO } from "./dates.js";
import {
  BOOK_KIND_TAG,
  REASON_LABEL,
  RESULT_LABEL,
  RECON_FILTERS,
  buildReconRows,
  bookOnlyEntries,
  ledgerByKeyOf,
  reconFilterCounts,
  reviewHints,
} from "./reconcile.js";

const DATE_FMT = "dd-mmm-yyyy";
const MONEY_FMT = "#,##0.00";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Cell constructors: { t: 's' | 'n', v, z? }. Text is always t:'s'.
export const text = (v) => ({ t: "s", v: String(v ?? "") });
export const blank = () => ({ t: "s", v: "" });
export const money = (v) => (v === null || v === undefined ? blank() : { t: "n", v: Number(v), z: MONEY_FMT });
export const whole = (v) => (v === null || v === undefined ? blank() : { t: "n", v: Number(v), z: "0" });

const isIso = (d) => /^\d{4}-\d{2}-\d{2}/.test(String(d || ""));
// 'YYYY-MM-DD' -> 'dd-mmm-yyyy'
export const prettyDate = (iso) => {
  if (!isIso(iso)) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}-${MONTHS[Number(m) - 1]}-${y}`;
};
export const dateCell = (iso) =>
  isIso(iso) ? { t: "n", v: daysBetweenISO("1899-12-30", String(iso).slice(0, 10)), z: DATE_FMT } : blank();

const LINK_TYPE = {
  auto_utr: "UTR",
  auto_name: "Name-confirmed",
  auto_exact: "Exact",
  auto_group: "Group",
  manual: "Manual",
  backfill: "Legacy",
  legacy: "Legacy",
};
const joinUnique = (list) => Array.from(new Set(list)).join(", ");

export const RECON_HEADER = [
  "Bank No", "Bank Date", "Description", "Cr/Dr", "Bank Amount", "Book Source", "Book ID(s)",
  "Book Date(s)", "Book Amount(s)", "Book Total", "Date Diff", "Amount Diff", "Result",
  "Link Type", "Reason", "Suggested Book ID",
];
const RECON_WIDTHS = [9, 13, 60, 7, 14, 16, 26, 26, 22, 14, 10, 13, 14, 16, 22, 20];

function reconRow(r) {
  const linked = r.links.length > 0;
  const distinctDates = Array.from(new Set(r.links.map((k) => k.date).filter(Boolean)));
  const bookDate =
    distinctDates.length === 1 && r.links.every((k) => k.date)
      ? dateCell(distinctDates[0])
      : linked
        ? text(r.links.map((k) => prettyDate(k.date) || "—").join(", "))
        : blank();
  return [
    r.seq === null || r.seq === undefined ? blank() : whole(r.seq),
    dateCell(r.bankDate),
    text(r.description),
    text(r.direction),
    money(r.bankAmount),
    text(joinUnique(r.links.map((k) => BOOK_KIND_TAG[k.kind] || k.kind))),
    text(r.links.map((k) => k.label).join(", ")),
    bookDate,
    text(r.bookAmounts.join(", ")),
    linked ? money(r.links.reduce((sum, k) => sum + k.amount, 0)) : blank(),
    linked ? whole(r.dateDiff) : blank(),
    linked ? money(r.amountDiff) : blank(),
    text(RESULT_LABEL[r.result] || r.result),
    text(joinUnique(r.links.map((k) => LINK_TYPE[k.source] || "Legacy"))),
    text(r.result === "REVIEW" && r.reason ? REASON_LABEL[r.reason] || r.reason : ""),
    text(!linked && r.suggestion ? r.suggestion.label : ""),
  ];
}

export const BOOK_ONLY_HEADER = ["Book ID", "Kind", "Date", "Name / Category", "Amount", "Bank Reference"];
const BOOK_ONLY_WIDTHS = [16, 11, 13, 32, 14, 60];

// Pure: builds the three sheets as arrays of cell specs (no xlsx needed).
export function buildReconExportModel({ statement, lines, allLines, data, summary }) {
  const ledger = ledgerByKeyOf(data);
  const hints = reviewHints(lines, allLines, statement.account, data);
  const rows = buildReconRows(lines, ledger, hints);
  const bookOnly = bookOnlyEntries(statement, allLines, data);
  const counts = reconFilterCounts(rows);

  const summaryRows = [
    [text("Account"), text(statement.account)],
    [text("Statement file"), text(statement.file_name || "")],
    [text("Period start"), dateCell(statement.period_start)],
    [text("Period end"), dateCell(statement.period_end)],
    [text("Statement closing"), money(summary.statementClosing)],
    [text("Book balance"), money(summary.bookBalance)],
    [text("Difference"), money(summary.difference)],
    [blank(), blank()],
    [text("Lines by result"), text("Count")],
    ...RECON_FILTERS.filter((f) => f.key !== "all").map((f) => [text(f.label), whole(counts[f.key])]),
    [text("All bank lines"), whole(counts.all)],
    [text("Book only (not in statement)"), whole(bookOnly.length)],
  ];

  return {
    sheets: [
      {
        name: "Reconciliation",
        header: RECON_HEADER,
        rows: rows.map(reconRow),
        widths: RECON_WIDTHS,
        filter: true,
      },
      {
        name: "Book only",
        header: BOOK_ONLY_HEADER,
        rows: bookOnly.map((e) => [
          text(e.label),
          text(BOOK_KIND_TAG[e.kind] || e.kind),
          dateCell(e.date),
          text(e.who),
          money(e.amount),
          text(e.bankReference),
        ]),
        widths: BOOK_ONLY_WIDTHS,
        filter: true,
      },
      { name: "Summary", header: null, rows: summaryRows, widths: [30, 40], filter: false },
    ],
    counts,
    bookOnlyCount: bookOnly.length,
  };
}

// Turns the model into an xlsx workbook. `XLSX` is passed in so the model and
// this function can be tested without a browser.
export function buildReconWorkbook(XLSX, model) {
  const wb = XLSX.utils.book_new();
  model.sheets.forEach((sheet) => {
    const headerRow = sheet.header ? [sheet.header.map(text)] : [];
    const grid = [...headerRow, ...sheet.rows];
    const ws = {};
    grid.forEach((row, r) => {
      row.forEach((cell, c) => {
        if (cell.t === "s" && cell.v === "") return; // empty cell
        const ref = XLSX.utils.encode_cell({ r, c });
        ws[ref] = cell.t === "n" ? { t: "n", v: cell.v, z: cell.z } : { t: "s", v: cell.v };
      });
    });
    const cols = Math.max(0, ...grid.map((row) => row.length));
    ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(grid.length - 1, 0), c: Math.max(cols - 1, 0) } });
    ws["!cols"] = sheet.widths.map((wch) => ({ wch }));
    if (sheet.filter && sheet.header) ws["!autofilter"] = { ref: ws["!ref"] };
    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  });
  return wb;
}

export const reconExportFileName = (statement) =>
  `Reconciliation_${statement.account}_${statement.period_start || "start"}_to_${statement.period_end || "end"}.xlsx`;

export async function exportReconExcel(input) {
  const XLSX = await import("xlsx");
  const wb = buildReconWorkbook(XLSX, buildReconExportModel(input));
  XLSX.writeFile(wb, reconExportFileName(input.statement));
}
