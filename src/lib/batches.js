// Batch rules shared by Admin -> Batches and the enrollment form.
// Mirrors migration 30 (batch-name rule) and migration 25 (fee checks); the
// database stays the backstop.

import { isBlank } from "./validation.js";

// New (or renamed) batch names (migration 30): capital letters, digits and
// - / & . ( ) _ ; words separated by single spaces only (no leading,
// trailing or repeated space).
export const BATCH_NAME_RE = /^[A-Z0-9/&.()_-]+( [A-Z0-9/&.()_-]+)*$/;

export const BATCH_NAME_MESSAGE =
  "Batch name may use only capital letters, digits, single spaces between words, and - / & . ( ) _ (no lowercase, no leading or trailing space).";

// Upper-cases as the user types. Doesn't strip anything, so a stray space
// or symbol stays visible and the validation message explains it.
export function normalizeBatchName(v) {
  return String(v ?? "").toUpperCase();
}

export function isValidBatchName(v) {
  return BATCH_NAME_RE.test(String(v ?? ""));
}

export const BATCH_FEE_FIELDS = ["course_fee", "registration_fee", "exam_fee"];

const FEE_LABEL = {
  course_fee: "Course fee",
  registration_fee: "Registration fee",
  exam_fee: "Exam fee",
};

// Validates the Admin -> Batches form. `original` is the saved
// { name, course_name } when editing (null for a new batch): the name rule
// only applies when the name is new or actually changed, so legacy names
// like "BATCH 1" keep working. Likewise an existing batch may keep a legacy
// free-text course_name, but a new batch (or a changed course) must be a
// real course. `courseNames` = names of non-archived courses.
export function validateBatchForm(form, { original = null, courseNames = [] } = {}) {
  const problems = [];
  // The name rule is checked on the raw value so a leading/trailing space is
  // reported rather than silently trimmed.
  const name = String(form.name ?? "");

  if (!name.trim()) {
    problems.push("Batch name is required.");
  } else if ((!original || name !== original.name) && !isValidBatchName(name)) {
    problems.push(BATCH_NAME_MESSAGE);
  }

  const keepsLegacyCourse = original && form.course_name === original.course_name;
  if (!keepsLegacyCourse && !courseNames.includes(form.course_name)) {
    problems.push("Choose a course from the list.");
  }

  if (form.start_date && form.end_date && form.end_date < form.start_date) {
    problems.push("End date can't be before the start date.");
  }

  for (const f of BATCH_FEE_FIELDS) {
    const raw = form[f];
    if (isBlank(raw)) {
      problems.push(`${FEE_LABEL[f]} is required (enter 0 if none).`);
      continue;
    }
    const n = Number(raw);
    if (Number.isNaN(n) || n < 0) problems.push(`${FEE_LABEL[f]} must be 0 or more.`);
  }
  return problems;
}

// Fee fields a batch still has at 0 — shown as "not set" in the Batches
// table (old batches predate registration/exam fees).
export function unsetBatchFees(batch) {
  return BATCH_FEE_FIELDS.filter((f) => !Number(batch?.[f]));
}

// Form patch for picking a batch in the enrollment form. For a NEW
// enrollment, the batch's course name and all three fees pre-fill (still
// editable, for discounts). When EDITING an existing student, only the
// course name follows the batch — the student's agreed fees are never
// silently overwritten. The amounts are then saved on the student row,
// so later batch fee edits don't change existing students' dues.
export function enrollmentPatchForBatch(batch, form, { isNew = true } = {}) {
  if (!batch) return {};
  const patch = { course: batch.course_name || form.course };
  if (isNew) {
    for (const f of BATCH_FEE_FIELDS) {
      patch[f] = batch[f] ?? form[f];
    }
  }
  return patch;
}
