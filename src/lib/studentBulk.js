// Bulk student update via Excel (Phase B; migration 27).
//
// The header row of the "Students" report download IS the upload template,
// so download -> edit -> upload round-trips. The database is the authority:
// bulk_upsert_students() re-validates every row and enforces Owner/Admin
// only, immutability of ID/status/batch, and all-or-nothing apply. What lives
// here is only parsing, cheap pre-flight checks, and shaping the RPC payload.
//
// Single-tenant assumption: one academy per database (no academy_id anywhere).

import { isBlank, normalizePhone } from "./validation.js";

export const MAX_UPLOAD_ROWS = 2000; // keep in sync with migration 27
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

// Template / report column order. `key` is the RPC payload key.
export const STUDENT_BULK_COLUMNS = [
  { key: "id", label: "Student ID" },
  { key: "name", label: "Name" },
  { key: "course", label: "Course" },
  { key: "batch", label: "Batch" },
  { key: "status", label: "Status" },
  { key: "student_phone", label: "Student Phone" },
  { key: "student_email", label: "Student Email" },
  { key: "parent_name", label: "Parent Name" },
  { key: "parent_phone", label: "Parent Phone" },
  { key: "place", label: "Place" },
  { key: "address", label: "Address" },
  { key: "registration_fee", label: "Registration Fee", money: true },
  { key: "course_fee", label: "Course Fee", money: true },
  { key: "exam_fee", label: "Exam Fee", money: true },
  { key: "other_fee", label: "Other Fee", money: true },
  { key: "waiver", label: "Waiver", money: true },
];

export const STUDENT_BULK_HEADERS = STUDENT_BULK_COLUMNS.map((c) => c.label);

export const STUDENT_BULK_SAMPLE_ROW = [
  "DBHM200", "Jane Doe", "Diploma in Hospital Management", "2026-B", "Registered",
  "9847012345", "jane@example.com", "John Doe", "9847012346", "Kochi", "House 1, Main Road",
  5000, 45000, 2000, 0, 0,
];

// Only .xlsx (not .xls/.csv): the template round-trips through Excel and the
// old formats parse differently (dates, leading zeros).
export function checkUploadFile(file) {
  if (!file) return "Choose an .xlsx file.";
  if (!/\.xlsx$/i.test(file.name || "")) return "Only .xlsx files are accepted. Download the template or the Students report and save as .xlsx.";
  if (file.size > MAX_UPLOAD_BYTES) return "That file is larger than 5 MB.";
  return null;
}

const norm = (h) => String(h ?? "").trim().toLowerCase();

// A cell as trimmed text. Numbers become plain digits (Excel stores phone
// numbers as numbers); dates and other objects are not expected here.
export function cellToText(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  return String(v).trim();
}

// Parses the rows of the first sheet (sheet_to_json with defval: "").
// Returns { fatal, extraHeaders, rows: [{ row, ...payload }] }.
//   fatal: a message when the file can't be processed at all.
// Every template header must be present: a missing column would otherwise
// read as "blank" and silently clear that field for every student.
export function parseStudentSheet(sheetRows) {
  if (!Array.isArray(sheetRows) || sheetRows.length === 0) {
    return { fatal: "The file has no data rows.", extraHeaders: [], rows: [] };
  }

  const present = new Map(Object.keys(sheetRows[0]).map((h) => [norm(h), h]));
  const missing = STUDENT_BULK_COLUMNS.filter((c) => !present.has(norm(c.label))).map((c) => c.label);
  if (missing.length) {
    return {
      fatal: `Missing column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}. Use the template or the Students report download.`,
      extraHeaders: [],
      rows: [],
    };
  }
  const known = new Set(STUDENT_BULK_HEADERS.map(norm));
  const extraHeaders = [...present.keys()].filter((h) => !known.has(h)).map((h) => present.get(h));

  const rows = [];
  sheetRows.forEach((raw, idx) => {
    const rec = { row: idx + 2 }; // row 1 is the header
    let anyValue = false;
    for (const c of STUDENT_BULK_COLUMNS) {
      let text = cellToText(raw[present.get(norm(c.label))]);
      if (c.key === "student_phone" || c.key === "parent_phone") text = normalizePhone(text);
      if (c.key === "id") text = text.toUpperCase();
      if (text !== "") anyValue = true;
      rec[c.key] = text;
    }
    if (anyValue) rows.push(rec); // fully blank rows are ignored
  });

  if (rows.length === 0) return { fatal: "The file has no data rows.", extraHeaders, rows: [] };
  if (rows.length > MAX_UPLOAD_ROWS) {
    return { fatal: `A file can have at most ${MAX_UPLOAD_ROWS} students (this one has ${rows.length}).`, extraHeaders, rows: [] };
  }
  return { fatal: null, extraHeaders, rows };
}

// Same Student ID more than once in the file (case-insensitive): row numbers
// grouped by ID. The server flags these too; this lets the UI say so before
// any network call.
export function findDuplicateIds(rows) {
  const seen = new Map();
  for (const r of rows) {
    if (isBlank(r.id)) continue;
    const k = r.id.trim().toUpperCase();
    seen.set(k, [...(seen.get(k) || []), r.row]);
  }
  return [...seen.entries()].filter(([, rowNums]) => rowNums.length > 1).map(([id, rowNums]) => ({ id, rows: rowNums }));
}

// Whether Apply may be enabled for a dry-run result.
export function canApply(result, { confirmedBlanks = false } = {}) {
  if (!result) return false;
  if (result.errors > 0) return false;
  if (result.updates + result.new === 0) return false;
  if (result.blank_overwrites > 0 && !confirmedBlanks) return false;
  return true;
}

export function summaryLine(result) {
  if (!result) return "";
  const parts = [
    `${result.updates} update${result.updates === 1 ? "" : "s"}`,
    `${result.new} new`,
    `${result.errors} error${result.errors === 1 ? "" : "s"}`,
    `${result.warnings} warning${result.warnings === 1 ? "" : "s"}`,
  ];
  if (result.unchanged > 0) parts.push(`${result.unchanged} unchanged`);
  return parts.join(" · ");
}
