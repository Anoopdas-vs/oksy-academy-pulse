// Unit tests for batches.js — batch-name rule (mirrors migration 25's
// batches_name_rule trigger), Admin -> Batches form validation, and the
// enrollment fee auto-fill from a batch.
//
// Run directly with: node --test src/lib/batches.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  isValidBatchName,
  normalizeBatchName,
  validateBatchForm,
  unsetBatchFees,
  enrollmentPatchForBatch,
} from "./batches.js";

describe("batch name rule", () => {
  test("accepts capital letters and digits only", () => {
    for (const n of ["DBHM2026A", "B1", "ODHM", "2026"]) assert.equal(isValidBatchName(n), true, n);
  });

  test("rejects lowercase, spaces, hyphens, symbols and blanks", () => {
    for (const n of ["dbhm2026", "BATCH 1", "DBHM-2026", "DBHM_2026", "B1!", "", " B1", null]) {
      assert.equal(isValidBatchName(n), false, String(n));
    }
  });

  test("normalizeBatchName upper-cases as typed but strips nothing", () => {
    assert.equal(normalizeBatchName("dbhm2026a"), "DBHM2026A");
    assert.equal(normalizeBatchName("batch 1"), "BATCH 1"); // still invalid, visibly
    assert.equal(normalizeBatchName(undefined), "");
  });
});

describe("validateBatchForm", () => {
  const courseNames = ["Diploma in Hospital Management"];
  const good = {
    name: "DBHM2026A",
    course_name: "Diploma in Hospital Management",
    course_fee: "45000",
    registration_fee: "5000",
    exam_fee: "0",
  };

  test("a valid new batch passes", () => {
    assert.deepEqual(validateBatchForm(good, { courseNames }), []);
  });

  test("new batch: bad name is rejected", () => {
    const problems = validateBatchForm({ ...good, name: "DBHM 2026" }, { courseNames });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /capital letters and digits/);
  });

  test("new batch: course must come from the courses list", () => {
    assert.match(validateBatchForm({ ...good, course_name: "Free text course" }, { courseNames })[0], /course/i);
    assert.match(validateBatchForm({ ...good, course_name: "" }, { courseNames })[0], /course/i);
  });

  test("editing a legacy batch keeps its name and course without tripping the rules", () => {
    const original = { name: "BATCH 1", course_name: "Old free-text course" };
    const legacy = { ...good, name: "BATCH 1", course_name: "Old free-text course" };
    assert.deepEqual(validateBatchForm(legacy, { original, courseNames }), []);
  });

  test("editing: renaming or changing course applies the rules", () => {
    const original = { name: "BATCH 1", course_name: "Old free-text course" };
    assert.equal(validateBatchForm({ ...good, name: "BATCH 1X", course_name: original.course_name }, { original, courseNames }).length, 1);
    assert.equal(validateBatchForm({ ...good, name: "BATCH 1", course_name: "Another free text" }, { original, courseNames }).length, 1);
    assert.deepEqual(validateBatchForm({ ...good, name: "BATCH1" }, { original, courseNames }), []);
  });

  test("fees are required and must be >= 0", () => {
    const problems = validateBatchForm(
      { ...good, course_fee: "", registration_fee: "-1", exam_fee: "abc" },
      { courseNames }
    );
    assert.equal(problems.length, 3);
    assert.deepEqual(validateBatchForm({ ...good, course_fee: 0, registration_fee: 0, exam_fee: 0 }, { courseNames }), []);
  });
});

describe("unsetBatchFees", () => {
  test("flags fees still at 0 (old batches)", () => {
    assert.deepEqual(unsetBatchFees({ course_fee: 45000, registration_fee: 0, exam_fee: 0 }), ["registration_fee", "exam_fee"]);
    assert.deepEqual(unsetBatchFees({ course_fee: 45000, registration_fee: 5000, exam_fee: 2000 }), []);
    assert.deepEqual(unsetBatchFees({ course_fee: 1 }), ["registration_fee", "exam_fee"]);
  });
});

describe("enrollmentPatchForBatch (fee auto-fill)", () => {
  const batch = { name: "DBHM2026A", course_name: "DBHM course", course_fee: 45000, registration_fee: 5000, exam_fee: 2000 };
  const form = { course: "", course_fee: "", registration_fee: "", exam_fee: "", other_fee: "100" };

  test("new enrollment: course and all three fees come from the batch", () => {
    assert.deepEqual(enrollmentPatchForBatch(batch, form), {
      course: "DBHM course",
      course_fee: 45000,
      registration_fee: 5000,
      exam_fee: 2000,
    });
  });

  test("never touches other_fee or waiver", () => {
    const patch = enrollmentPatchForBatch(batch, form);
    assert.equal("other_fee" in patch, false);
    assert.equal("waiver" in patch, false);
  });

  test("editing an existing student: fees are NOT overwritten, only course follows", () => {
    assert.deepEqual(enrollmentPatchForBatch(batch, { ...form, course_fee: 40000 }, { isNew: false }), {
      course: "DBHM course",
    });
  });

  test("an old batch without the new fee columns keeps whatever the form had", () => {
    const old = { name: "BATCH 1", course_name: "", course_fee: 30000 };
    const patch = enrollmentPatchForBatch(old, { ...form, course: "Kept", registration_fee: "500" });
    assert.equal(patch.course, "Kept");
    assert.equal(patch.course_fee, 30000);
    assert.equal(patch.registration_fee, "500");
  });

  test("no batch selected: no fee changes", () => {
    assert.deepEqual(enrollmentPatchForBatch(undefined, form), {});
  });

  test("auto-filled amounts are a copy, so editing them doesn't mutate the batch", () => {
    const patch = enrollmentPatchForBatch(batch, form);
    patch.course_fee = 40000; // discount typed by staff
    assert.equal(batch.course_fee, 45000);
  });
});
