import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatStudentId,
  parseStudentIdNumber,
  nextStudentId,
  canOfferStudentDelete,
} from "./studentId.js";

test("formatStudentId pads to 3 digits and never truncates", () => {
  assert.equal(formatStudentId("DBHM", 1), "DBHM001");
  assert.equal(formatStudentId("ODHM", 16), "ODHM016");
  assert.equal(formatStudentId("DBHM", 117), "DBHM117");
  assert.equal(formatStudentId("DBHM", 999), "DBHM999");
  assert.equal(formatStudentId("DBHM", 1000), "DBHM1000");
  assert.equal(formatStudentId("DBHM", 12345), "DBHM12345");
});

test("parseStudentIdNumber reads only <code><digits>", () => {
  assert.equal(parseStudentIdNumber("DBHM116", "DBHM"), 116);
  assert.equal(parseStudentIdNumber("DBHM001", "DBHM"), 1);
  assert.equal(parseStudentIdNumber("dbhm042", "DBHM"), 42, "case-insensitive");
  assert.equal(parseStudentIdNumber(" DBHM007 ", "DBHM"), 7, "trimmed");
  assert.equal(parseStudentIdNumber("DBHM1000", "DBHM"), 1000);
  assert.equal(parseStudentIdNumber("ODHM015", "DBHM"), null, "other prefix");
  assert.equal(parseStudentIdNumber("DBHM", "DBHM"), null, "no digits");
  assert.equal(parseStudentIdNumber("DBHM12A", "DBHM"), null, "trailing letter");
  assert.equal(parseStudentIdNumber("DBHM-12", "DBHM"), null, "separator");
  assert.equal(parseStudentIdNumber("TST001", "DBHM"), null);
  assert.equal(parseStudentIdNumber("", "DBHM"), null);
  assert.equal(parseStudentIdNumber("DBHM001", ""), null);
});

test("nextStudentId = highest + 1, never fills gaps", () => {
  // DBHM001-DBHM116 with a gap (DBHM050 missing), plus ODHM001-ODHM015.
  const ids = [];
  for (let i = 1; i <= 116; i++) if (i !== 50) ids.push(formatStudentId("DBHM", i));
  for (let i = 1; i <= 15; i++) ids.push(formatStudentId("ODHM", i));
  ids.push("TST001", "fff");

  assert.equal(nextStudentId("DBHM", ids), "DBHM117");
  assert.equal(nextStudentId("ODHM", ids), "ODHM016");
  assert.equal(nextStudentId("NEWC", ids), "NEWC001", "first ID for a new course");
  assert.equal(nextStudentId("DBHM", [...ids, "DBHM999"]), "DBHM1000");
});

test("canOfferStudentDelete: admin + Registered + no receipts only", () => {
  const reg = { id: "DBHM117", status: "Registered" };
  assert.equal(canOfferStudentDelete(reg, { isAdmin: true }), true);
  assert.equal(canOfferStudentDelete(reg, { isAdmin: false }), false, "non-admin");
  assert.equal(canOfferStudentDelete(reg, { isAdmin: true, hasReceipts: true }), false);
  for (const status of ["Active", "Completed", "Dropped"]) {
    assert.equal(canOfferStudentDelete({ ...reg, status }, { isAdmin: true }), false, status);
  }
  assert.equal(canOfferStudentDelete(null, { isAdmin: true }), false);
});
