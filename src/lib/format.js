import { istToday } from "./batchStatus.js";

export const formatMoney = (value) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value || 0);

// Today's date in India (Asia/Kolkata) as YYYY-MM-DD. Not toISOString(): that is
// the UTC date, which is still "yesterday" in IST between 00:00 and 05:30.
export const today = (now = new Date()) => istToday(now);

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

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

const belowThousand = (n) => {
  const parts = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : ""));
  } else if (n > 0) {
    parts.push(ONES[n]);
  }
  return parts.join(" ");
};

// 1000 -> "Rupees One Thousand Only" (Indian numbering: lakh / crore).
export function amountInWords(value) {
  const total = Math.round(Number(value) * 100);
  if (!Number.isFinite(total) || total <= 0) return "";
  let rupees = Math.floor(total / 100);
  const paise = total % 100;
  const parts = [];
  const crore = Math.floor(rupees / 10000000);
  rupees %= 10000000;
  const lakh = Math.floor(rupees / 100000);
  rupees %= 100000;
  const thousand = Math.floor(rupees / 1000);
  rupees %= 1000;
  if (crore) parts.push(`${belowThousand(crore)} Crore`);
  if (lakh) parts.push(`${belowThousand(lakh)} Lakh`);
  if (thousand) parts.push(`${belowThousand(thousand)} Thousand`);
  if (rupees) parts.push(belowThousand(rupees));
  let words = parts.length ? `Rupees ${parts.join(" ")}` : "Rupees Zero";
  if (paise) words += ` and ${belowThousand(paise)} Paise`;
  return `${words} Only`;
}

// "sneha. m" / "anoopdas vs" -> "Sneha M" / "Anoopdas VS" (display only;
// 1-2 letter parts are treated as initials).
export function tidyName(name) {
  return String(name || "")
    .replace(/\./g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .split(" ")
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}
