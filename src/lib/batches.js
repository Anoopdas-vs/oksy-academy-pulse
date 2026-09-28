// Batch rules shared by Admin -> Batches and the enrollment form.
// Mirrors migration 25 (batches_name_rule trigger + fee checks); the
// database stays the backstop.

import { isBlank } from "./validation.js";

// New (or renamed) batch names: capital letters and digits only.
export const BATCH_NAME_RE = /^[A-Z0-9]+$/;

// Upper-cases as the user types. Doesn't strip anything, so a stray space
// or hyphen stays visible and the validation message explains it.
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
  const name = String(form.name ?? "").trim();

  if (!name) {
    problems.push("Batch name is required.");
  } else if ((!original || name !== original.name) && !isValidBatchName(name)) {
    problems.push("Batch name must use capital letters and digits only (A-Z, 0-9), no spaces or symbols.");
  }

  const keepsLegacyCourse = original && form.course_name === original.course_name;
  if (!keepsLegacyCourse && !courseNames.includes(form.course_name)) {
    problems.push("Choose a course from the list.");
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
