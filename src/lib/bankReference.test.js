import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { filterRows } from "./usePagedList.js";
import { COLLECTION_SEARCH_FIELDS } from "./fees.js";
import {
  extractUtr,
  EXPENSE_SEARCH_FIELDS,
  TRANSFER_SEARCH_FIELDS,
  FEE_TEMPLATE_HEADERS,
  TRANSFER_TEMPLATE_HEADERS,
} from "./bankReference.js";

test("extractUtr picks the digit run of 9+ digits", () => {
  assert.equal(extractUtr("UPI/534608284353/UPI/x@ybl/SBI"), "534608284353");
});

test("extractUtr returns empty when there is no 9+ digit run", () => {
  assert.equal(extractUtr("NEFT/RENT/JAN 2026"), "");
  assert.equal(extractUtr("ref 12345678"), "");
  assert.equal(extractUtr(null), "");
  assert.equal(extractUtr(undefined), "");
});

test("extractUtr takes the longest run when several exist (first on a tie)", () => {
  assert.equal(extractUtr("A123456789 B1234567890123 C987654321"), "1234567890123");
  assert.equal(extractUtr("111111111 / 222222222"), "111111111");
});

const expenses = [
  { id: 1, category: "Rent", account: "HDFC", description: "Jan rent", reference: "R1", bank_reference: "NEFT/UTR998877665544" },
  { id: 2, category: "Travel", account: "Cash", description: "Taxi", reference: "R2", bank_reference: null },
];
const transfers = [
  { id: 1, from_account: "Cash", to_account: "ICICI", purpose: "Deposit", reference: "D1", note: "", bank_reference: "IMPS/412345678901" },
  { id: 2, from_account: "HDFC", to_account: "ICICI", purpose: "Move", reference: "D2", note: "", bank_reference: null },
];

test("Expense search matches bank_reference and keeps other fields working", () => {
  assert.deepEqual(filterRows(expenses, "998877665544", EXPENSE_SEARCH_FIELDS).map((r) => r.id), [1]);
  assert.deepEqual(filterRows(expenses, "taxi", EXPENSE_SEARCH_FIELDS).map((r) => r.id), [2]);
});

test("Transfer search matches bank_reference and keeps other fields working", () => {
  assert.deepEqual(filterRows(transfers, "412345678901", TRANSFER_SEARCH_FIELDS).map((r) => r.id), [1]);
  assert.deepEqual(filterRows(transfers, "move", TRANSFER_SEARCH_FIELDS).map((r) => r.id), [2]);
});

test("Fee search still matches bank_reference", () => {
  const fees = [{ id: 1, student_id: "S1", student_name: "A", type: "Fee", reference: "", bank_reference: "UPI/534608284353" }];
  assert.equal(filterRows(fees, "534608284353", COLLECTION_SEARCH_FIELDS).length, 1);
});

test("download templates end with a Bank Reference column and leave other columns untouched", () => {
  assert.deepEqual(FEE_TEMPLATE_HEADERS, ["Receipt No", "Student ID", "Date", "Type", "Payment A/C", "Amount", "Reference", "Bank Reference"]);
  assert.deepEqual(TRANSFER_TEMPLATE_HEADERS, ["Date", "From Account", "To Account", "Amount", "Purpose", "Reference", "Note", "Bank Reference"]);
});

test("import parsers never read Bank Reference, so uploads cannot blank an existing value", () => {
  const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  assert.ok(!/row\[["']Bank Reference["']\]/i.test(app));
});
