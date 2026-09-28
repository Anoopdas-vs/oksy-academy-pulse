// Student ID rule (Phase D): course code + number, zero-padded to at least
// 3 digits — DBHM117, ODHM016, and past 999 simply DBHM1000.
//
// Mirrors migration 26 (format_student_id / student_id_next_number). The
// database is the authority: the real ID is allocated by the enroll_student
// RPC under a per-prefix lock. These helpers exist for the form, for tests,
// and for validating manual IDs in the later Excel upload.

import { isBlank } from "./validation.js";

// Pads short numbers to 3 digits; never truncates longer ones.
export function formatStudentId(code, number) {
  const n = String(number);
  return `${code}${n.length < 3 ? n.padStart(3, "0") : n}`;
}

// The number part of `id` when it is exactly <code><digits> (compared
// trimmed + upper-cased, like the database), else null.
export function parseStudentIdNumber(id, code) {
  if (isBlank(id) || isBlank(code)) return null;
  const s = String(id).trim().toUpperCase();
  const prefix = String(code).trim().toUpperCase();
  if (!s.startsWith(prefix)) return null;
  const digits = s.slice(prefix.length);
  return /^[0-9]+$/.test(digits) ? Number(digits) : null;
}

// Highest existing number for `code` + 1. Gaps are never filled.
export function nextStudentId(code, existingIds = []) {
  let max = 0;
  for (const id of existingIds) {
    const n = parseStudentIdNumber(id, code);
    if (n !== null && n > max) max = n;
  }
  return formatStudentId(code, max + 1);
}

// Whether to OFFER the Delete button (a courtesy only — the
// delete_mistaken_student RPC enforces the real rule, including linked
// logins the UI doesn't load).
export function canOfferStudentDelete(student, { isAdmin = false, hasReceipts = false } = {}) {
  return !!student && isAdmin && student.status === "Registered" && !hasReceipts;
}
