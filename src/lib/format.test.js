// Receipt No / Expense ID parsing gates whether a bulk-upload row overwrites
// an existing financial record — App.jsx's handleCollectionFile /
// handleExpenseFile treat a blank cell as "insert new", an unparsable cell
// as an error (never silently insert), and a parsable cell as "update this
// record". These tests pin that contract.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { receiptNo, expenseCode, parseReceiptNo, parseExpenseId } from "./format.js";

describe("receiptNo / parseReceiptNo", () => {
  test("formats and round-trips", () => {
    assert.equal(receiptNo(7), "OKSY/000007");
    assert.equal(parseReceiptNo(receiptNo(7)), 7);
  });

  test("accepts the bare prefix and a plain number", () => {
    assert.equal(parseReceiptNo("OKSY/123"), 123);
    assert.equal(parseReceiptNo("123"), 123);
    assert.equal(parseReceiptNo("0123"), 123);
  });

  test("is case-insensitive on the prefix", () => {
    assert.equal(parseReceiptNo("oksy/000009"), 9);
  });

  test("blank/missing cell means 'no ID given' (null), not an error", () => {
    assert.equal(parseReceiptNo(undefined), null);
    assert.equal(parseReceiptNo(null), null);
    assert.equal(parseReceiptNo(""), null);
    assert.equal(parseReceiptNo("   "), null);
  });

  test("garbage input is NaN, distinct from blank, so callers can flag it as an error", () => {
    assert.ok(Number.isNaN(parseReceiptNo("not-a-receipt")));
    assert.ok(Number.isNaN(parseReceiptNo("EXP-00042")));
  });
});

describe("expenseCode / parseExpenseId", () => {
  test("formats and round-trips", () => {
    assert.equal(expenseCode(42), "EXP-00042");
    assert.equal(parseExpenseId(expenseCode(42)), 42);
  });

  test("accepts the bare prefix and a plain number", () => {
    assert.equal(parseExpenseId("EXP-45"), 45);
    assert.equal(parseExpenseId("45"), 45);
  });

  test("blank/missing cell means 'no ID given' (null), not an error", () => {
    assert.equal(parseExpenseId(""), null);
    assert.equal(parseExpenseId(null), null);
  });

  test("garbage input is NaN, distinct from blank", () => {
    assert.ok(Number.isNaN(parseExpenseId("not-an-expense")));
    assert.ok(Number.isNaN(parseExpenseId("OKSY/000007")));
  });
});
