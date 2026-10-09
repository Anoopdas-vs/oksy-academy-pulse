// Read-only detail lines for the Book ID popup in Banking. Pure: the page
// supplies already-loaded rows and, for an entry not in memory, a single-id
// fetcher (the existing data helpers, normal RLS).
import { formatMoney, receiptNo, expenseCode } from "./format.js";

const dash = (v) => (v === null || v === undefined || v === "" ? "—" : String(v));
const isoDay = (d) => (d ? String(d).slice(0, 10) : "");

const LISTS = { collection: "collections", expense: "expenses", transfer: "transfers" };

// The row for kind:id from the loaded lists, or undefined.
export function findLoadedEntry(kind, id, lists = {}) {
  const list = lists[LISTS[kind]] || [];
  return list.find((r) => String(r.id) === String(id));
}

// [[label, value], ...] for one entry. Amount and date are the book values.
// The bank reference is NOT in this list: the popup shows it in its own
// copyable block (bookEntryDetail).
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
      ["Account", dash(row.account)],
      ["Reference", dash(row.reference)],
    ];
  }
  if (kind === "expense") {
    return [
      ["Category", dash(row.category)],
      ["Description", dash(row.description)],
      ["Amount", formatMoney(row.amount)],
      ["Date", dash(isoDay(row.date))],
      ["Account", dash(row.account)],
      ["Reference", dash(row.reference)],
    ];
  }
  return [
    ["From → To", `${dash(row.from_account)} → ${dash(row.to_account)}`],
    ["Description", dash(row.purpose)],
    ["Amount", formatMoney(row.amount)],
    ["Date", dash(isoDay(row.date))],
    ["Reference", dash(row.reference)],
  ];
}

const KIND_LABEL = { collection: "Fee receipt", expense: "Expense", transfer: "Transfer" };

// Human Book ID for the popup header: OKSY/000236, EXP-00273, TRF-00012.
export function bookEntryCode(kind, id) {
  if (kind === "collection") return receiptNo(id);
  if (kind === "expense") return expenseCode(id);
  return `TRF-${String(id).padStart(5, "0")}`;
}

// Everything the popup renders, plus the plain text "Copy all" puts on the
// clipboard (one "Label: value" per line).
export function bookEntryDetail(kind, row, students = []) {
  const code = bookEntryCode(kind, row.id);
  const fields = bookEntryFields(kind, row, students);
  const bankReference = row.bank_reference ? String(row.bank_reference).trim() : "";
  const copyText = [
    `${KIND_LABEL[kind] || kind}: ${code}`,
    ...fields.map(([k, v]) => `${k}: ${v}`),
    `Bank reference: ${bankReference || "—"}`,
  ].join("\n");
  return { code, kindLabel: KIND_LABEL[kind] || kind, fields, bankReference, copyText };
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
  if (!row) return { status: "notfound" };
  const detail = bookEntryDetail(kind, row, students);
  return { status: "found", fields: detail.fields, detail };
}

export const CLOSE_DELAY_MS = 150;

// Delayed close so the pointer can travel from the Book ID onto the popup:
// schedule() starts the timer, cancel() (pointer reached the popup or came
// back) stops it. Timer functions are injectable for tests.
export function createDelayedClose(onClose, ms = CLOSE_DELAY_MS, timers = { set: setTimeout, clear: clearTimeout }) {
  let t = null;
  const cancel = () => {
    if (t !== null) timers.clear(t);
    t = null;
  };
  const schedule = () => {
    cancel();
    t = timers.set(() => {
      t = null;
      onClose();
    }, ms);
  };
  return { schedule, cancel };
}
