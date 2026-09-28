export const formatMoney = (value) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value || 0);

export const today = () => new Date().toISOString().slice(0, 10);

// Fee collection receipt number <-> collections.id, and expense code <->
// expenses.id. Shared by the page tables (display), reports.js (export
// column) and App.jsx's bulk-import parser (matching a "Receipt No" /
// "Expense ID" cell back to the record it should overwrite), so the format
// only lives in one place.
export const receiptNo = (id) => `OKSY/${String(id).padStart(6, "0")}`;
export const expenseCode = (id) => `EXP-${String(id).padStart(5, "0")}`;

// Accepts the full formatted string ("OKSY/000123"), the prefix without
// padding ("OKSY/123"), or a bare number ("123"/"000123"). Returns null
// (not NaN) when the cell is blank or doesn't look like an ID at all, so
// callers can tell "no ID given" apart from "malformed ID".
export function parseReceiptNo(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const m = String(raw).trim().match(/^(?:OKSY\/)?0*(\d+)$/i);
  return m ? Number(m[1]) : NaN;
}

export function parseExpenseId(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const m = String(raw).trim().match(/^(?:EXP-)?0*(\d+)$/i);
  return m ? Number(m[1]) : NaN;
}
