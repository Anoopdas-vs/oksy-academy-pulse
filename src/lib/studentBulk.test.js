import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  STUDENT_BULK_HEADERS,
  MAX_UPLOAD_ROWS,
  checkUploadFile,
  cellToText,
  parseStudentSheet,
  findDuplicateIds,
  canApply,
  summaryLine,
} from "./studentBulk.js";

const fullRow = (over = {}) => ({
  "Student ID": "dbhm200", Name: "Jane", Course: "C", Batch: "B1", Status: "Registered",
  "Student Phone": "98470 12345", "Student Email": "j@x.in", "Parent Name": "P",
  "Parent Phone": "9847012346", Place: "Kochi", Address: "A",
  "Registration Fee": 100, "Course Fee": 200, "Exam Fee": 0, "Other Fee": "", Waiver: "",
  ...over,
});

describe("checkUploadFile", () => {
  test("accepts .xlsx only", () => {
    assert.equal(checkUploadFile({ name: "a.xlsx", size: 10 }), null);
    assert.equal(checkUploadFile({ name: "A.XLSX", size: 10 }), null);
    assert.match(checkUploadFile({ name: "a.xls", size: 10 }), /\.xlsx/);
    assert.match(checkUploadFile({ name: "a.csv", size: 10 }), /\.xlsx/);
    assert.match(checkUploadFile({ name: "a.xlsx.exe", size: 10 }), /\.xlsx/);
    assert.ok(checkUploadFile(null));
  });
  test("rejects oversize files", () => {
    assert.match(checkUploadFile({ name: "a.xlsx", size: 6 * 1024 * 1024 }), /5 MB/);
  });
});

describe("cellToText", () => {
  test("numbers, blanks and whitespace", () => {
    assert.equal(cellToText(9847012345), "9847012345");
    assert.equal(cellToText(null), "");
    assert.equal(cellToText(undefined), "");
    assert.equal(cellToText("  x  "), "x");
    assert.equal(cellToText(NaN), "");
  });
});

describe("parseStudentSheet", () => {
  test("maps headers to payload keys, normalises ID and phone, numbers row from 2", () => {
    const out = parseStudentSheet([fullRow()]);
    assert.equal(out.fatal, null);
    assert.equal(out.rows.length, 1);
    const r = out.rows[0];
    assert.equal(r.row, 2);
    assert.equal(r.id, "DBHM200");
    assert.equal(r.student_phone, "9847012345"); // spaces stripped
    assert.equal(r.registration_fee, "100");
    assert.equal(r.other_fee, ""); // blank stays blank (server decides)
  });

  test("header match is case/whitespace-insensitive; extra columns reported, not fatal", () => {
    const row = fullRow();
    row["  student id "] = row["Student ID"];
    delete row["Student ID"];
    row["Notes"] = "hello";
    const out = parseStudentSheet([row]);
    assert.equal(out.fatal, null);
    assert.deepEqual(out.extraHeaders, ["Notes"]);
    assert.equal(out.rows[0].id, "DBHM200");
  });

  test("a missing column is fatal (it would otherwise blank the field everywhere)", () => {
    const row = fullRow();
    delete row["Place"];
    delete row["Waiver"];
    const out = parseStudentSheet([row]);
    assert.match(out.fatal, /Missing columns: Place, Waiver/);
    assert.deepEqual(out.rows, []);
  });

  test("fully blank rows are skipped but row numbers still line up", () => {
    const blank = Object.fromEntries(STUDENT_BULK_HEADERS.map((h) => [h, ""]));
    const out = parseStudentSheet([fullRow(), blank, fullRow({ "Student ID": "DBHM201" })]);
    assert.deepEqual(out.rows.map((r) => r.row), [2, 4]);
  });

  test("empty file and header-only file are fatal", () => {
    assert.match(parseStudentSheet([]).fatal, /no data rows/);
    const blank = Object.fromEntries(STUDENT_BULK_HEADERS.map((h) => [h, ""]));
    assert.match(parseStudentSheet([blank]).fatal, /no data rows/);
  });

  test("row cap", () => {
    const rows = Array.from({ length: MAX_UPLOAD_ROWS + 1 }, (_, i) => fullRow({ "Student ID": `DBHM${1000 + i}` }));
    assert.match(parseStudentSheet(rows).fatal, /at most 2000/);
    assert.equal(parseStudentSheet(rows.slice(0, MAX_UPLOAD_ROWS)).fatal, null);
  });
});

describe("findDuplicateIds", () => {
  test("groups rows sharing an ID, case-insensitively", () => {
    const dups = findDuplicateIds([
      { row: 2, id: "DBHM200" }, { row: 3, id: "dbhm200" }, { row: 4, id: "DBHM201" }, { row: 5, id: "" }, { row: 6, id: "" },
    ]);
    assert.deepEqual(dups, [{ id: "DBHM200", rows: [2, 3] }]);
  });
});

describe("canApply / summaryLine", () => {
  const ok = { updates: 2, new: 1, errors: 0, warnings: 1, blank_overwrites: 0, unchanged: 0 };
  test("apply gating", () => {
    assert.equal(canApply(null), false);
    assert.equal(canApply(ok), true);
    assert.equal(canApply({ ...ok, errors: 1 }), false);
    assert.equal(canApply({ ...ok, updates: 0, new: 0 }), false);
    assert.equal(canApply({ ...ok, blank_overwrites: 3 }), false);
    assert.equal(canApply({ ...ok, blank_overwrites: 3 }, { confirmedBlanks: true }), true);
  });
  test("summary wording", () => {
    assert.equal(summaryLine(ok), "2 updates · 1 new · 0 errors · 1 warning");
    assert.equal(summaryLine({ ...ok, updates: 1, unchanged: 4 }), "1 update · 1 new · 0 errors · 1 warning · 4 unchanged");
  });
});
