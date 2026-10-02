import { test } from "node:test";
import assert from "node:assert/strict";
import { filterRows } from "./usePagedList.js";
import { COLLECTION_SEARCH_FIELDS } from "./fees.js";

const rows = [
  { id: 1, student_id: "OKS-1", student_name: "Aboobeker", type: "Course Fee", reference: "R-1", bank_reference: "UPI/534608284353/UPI/x@ybl/SBI" },
  { id: 2, student_id: "OKS-2", student_name: "Mayiza", type: "Exam Fee", reference: "R-2", bank_reference: null },
];

test("the Fee list search finds a fee by its UTR / bank reference", () => {
  assert.deepEqual(filterRows(rows, "534608284353", COLLECTION_SEARCH_FIELDS).map((r) => r.id), [1]);
  assert.deepEqual(filterRows(rows, "upi/5346", COLLECTION_SEARCH_FIELDS).map((r) => r.id), [1]);
});

test("existing search fields still work and rows without a bank reference never crash", () => {
  assert.deepEqual(filterRows(rows, "mayiza", COLLECTION_SEARCH_FIELDS).map((r) => r.id), [2]);
  assert.deepEqual(filterRows(rows, "r-2", COLLECTION_SEARCH_FIELDS).map((r) => r.id), [2]);
  assert.equal(filterRows(rows, "   ", COLLECTION_SEARCH_FIELDS).length, 2);
});
