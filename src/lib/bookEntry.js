// Read-only detail lines for the Book ID popup in Banking. Pure: the page
// supplies already-loaded rows and, for an entry not in memory, a single-id
// fetcher (the existing data helpers, normal RLS).
import { formatMoney } from "./format.js";

const dash = (v) => (v === null || v === undefined || v === "" ? "—" : String(v));
const isoDay = (d) => (d ? String(d).slice(0, 10) : "");

const LISTS = { collection: "collections", expense: "expenses", transfer: "transfers" };

// The row for kind:id from the loaded lists, or undefined.
export function findLoadedEntry(kind, id, lists = {}) {
  const list = lists[LISTS[kind]] || [];
  return list.find((r) => String(r.id) === String(id));
}

// [[label, value], ...] for one entry. Amount and date are the book values.
export function bookEntryFields(kind, row, students = []) {
  if (kind === "collection") {
    const student = students.find((s) => s.id === row.student_id);
    return [
      ["Student ID", dash(row.student_id)],
      ["Student name", dash(row.student_name || student?.name)],
      ["Batch", dash(student?.batch ?? row.batch)],
      ["Fee type", dash(row.type)],
      ["Amount", formatMoney(row.amount)],
      ["Date", dash(isoDay(row.date))],
    ];
  }
  if (kind === "expense") {
    return [
      ["Category", dash(row.category)],
      ["Description", dash(row.description)],
      ["Amount", formatMoney(row.amount)],
      ["Date", dash(isoDay(row.date))],
    ];
  }
  return [
    ["From → To", `${dash(row.from_account)} → ${dash(row.to_account)}`],
    ["Description", dash(row.purpose)],
    ["Amount", formatMoney(row.amount)],
    ["Date", dash(isoDay(row.date))],
  ];
}

// Memory first; otherwise ONE fetch by id. Never throws:
// { status: "found", fields } | { status: "notfound" }.
export async function resolveBookEntry({ kind, id, lists, students, fetchEntry }) {
  let row = findLoadedEntry(kind, id, lists);
  if (!row && fetchEntry) {
    try {
      row = await fetchEntry(kind, id);
    } catch {
      row = null;
    }
  }
  return row ? { status: "found", fields: bookEntryFields(kind, row, students) } : { status: "notfound" };
}
