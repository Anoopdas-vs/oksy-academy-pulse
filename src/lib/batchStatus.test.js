// Unit tests for batchStatus.js — the rule of migrations 28 / 28b.
// Run directly with: node --test src/lib/batchStatus.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { istToday, batchStatusFor, planStatusChanges } from "./batchStatus.js";

const TODAY = "2026-09-29";
const batch = (start_date, end_date) => ({ name: "B", start_date, end_date });

describe("istToday (India date, not UTC)", () => {
  test("18:29 UTC is still the same IST day, 18:30 UTC rolls to the next", () => {
    assert.equal(istToday(new Date("2026-09-28T18:29:59Z")), "2026-09-28");
    assert.equal(istToday(new Date("2026-09-28T18:30:00Z")), "2026-09-29");
  });
  test("the 02:30 IST job (21:00 UTC) sees the new IST date", () => {
    assert.equal(istToday(new Date("2026-09-28T21:00:00Z")), "2026-09-29");
  });
});

describe("batchStatusFor — the rule", () => {
  test("before the start date -> Registered (any of Registered/Active/Completed)", () => {
    for (const s of ["Registered", "Active", "Completed"]) {
      assert.equal(batchStatusFor(s, batch("2026-09-30", "2027-01-01"), TODAY), "Registered", s);
    }
  });
  test("on the start date -> Active (inclusive)", () => {
    assert.equal(batchStatusFor("Registered", batch(TODAY, "2027-01-01"), TODAY), "Active");
  });
  test("between start and end -> Active", () => {
    assert.equal(batchStatusFor("Registered", batch("2026-09-01", "2027-01-01"), TODAY), "Active");
  });
  test("the end date itself is Completed", () => {
    assert.equal(batchStatusFor("Active", batch("2026-01-01", TODAY), TODAY), "Completed");
  });
  test("the day before the end date is still Active", () => {
    assert.equal(batchStatusFor("Active", batch("2026-01-01", "2026-09-30"), TODAY), "Active");
  });
  test("after the end date -> Completed, straight from Registered (no step-by-step)", () => {
    assert.equal(batchStatusFor("Registered", batch("2026-01-01", "2026-09-01"), TODAY), "Completed");
  });
  test("start and end on the same day -> Completed", () => {
    assert.equal(batchStatusFor("Registered", batch(TODAY, TODAY), TODAY), "Completed");
  });
  test("no end date -> Active from the start date on", () => {
    assert.equal(batchStatusFor("Registered", batch("2026-09-01", null), TODAY), "Active");
  });
});

describe("batchStatusFor — both directions", () => {
  test("extended end date turns Completed back to Active", () => {
    assert.equal(batchStatusFor("Completed", batch("2026-01-01", "2026-12-31"), TODAY), "Active");
  });
  test("start date moved later turns Active back to Registered", () => {
    assert.equal(batchStatusFor("Active", batch("2026-11-01", "2027-03-01"), TODAY), "Registered");
  });
});

describe("batchStatusFor — never changed", () => {
  test("Dropped, whatever the dates", () => {
    for (const b of [batch("2026-01-01", "2026-02-01"), batch("2027-01-01", null), batch(null, null)]) {
      assert.equal(batchStatusFor("Dropped", b, TODAY), "Dropped");
    }
  });
  test("a batch with no start date is skipped, even with an end date", () => {
    for (const s of ["Registered", "Active", "Completed"]) {
      assert.equal(batchStatusFor(s, batch(null, null), TODAY), s);
      assert.equal(batchStatusFor(s, batch(null, "2026-01-01"), TODAY), s);
    }
  });
  test("a batch with end before start (bad data) is skipped", () => {
    for (const s of ["Registered", "Active", "Completed"]) {
      assert.equal(batchStatusFor(s, batch("2026-10-10", "2026-10-01"), TODAY), s);
    }
  });
  test("a Completed student in a batch with no end date is left alone", () => {
    assert.equal(batchStatusFor("Completed", batch("2026-01-01", null), TODAY), "Completed");
    assert.equal(batchStatusFor("Completed", batch("2027-01-01", null), TODAY), "Completed");
  });
  test("a student with no matching batch is skipped", () => {
    assert.equal(batchStatusFor("Registered", undefined, TODAY), "Registered");
  });
});

describe("planStatusChanges", () => {
  const batches = [
    { name: "A", start_date: "2026-09-01", end_date: "2027-12-01" },
    { name: "E", start_date: "2026-08-01", end_date: "2026-09-01" },
    { name: "F", start_date: "2027-01-01", end_date: "2027-06-01" },
    { name: "N", start_date: null, end_date: null },
  ];
  const students = [
    { id: "3", batch: "A", status: "Registered" },
    { id: "5", batch: "A", status: "Completed" }, // end extended -> revert to Active
    { id: "1", batch: "E", status: "Active" },
    { id: "2", batch: "E", status: "Dropped" },
    { id: "6", batch: "F", status: "Active" }, // start moved later -> revert
    { id: "4", batch: "N", status: "Registered" },
  ];

  test("lists forward changes and reverts, sorted by batch then id", () => {
    assert.deepEqual(planStatusChanges(students, batches, TODAY), [
      { student_id: "3", batch: "A", old_status: "Registered", new_status: "Active", is_revert: false },
      { student_id: "5", batch: "A", old_status: "Completed", new_status: "Active", is_revert: true },
      { student_id: "1", batch: "E", old_status: "Active", new_status: "Completed", is_revert: false },
      { student_id: "6", batch: "F", old_status: "Active", new_status: "Registered", is_revert: true },
    ]);
  });

  test("idempotent: applying the plan and planning again finds nothing", () => {
    const applied = students.map((s) => {
      const c = planStatusChanges([s], batches, TODAY)[0];
      return c ? { ...s, status: c.new_status } : s;
    });
    assert.deepEqual(planStatusChanges(applied, batches, TODAY), []);
  });
});
