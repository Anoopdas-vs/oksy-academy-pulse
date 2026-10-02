// Guard for "references are written only by Sync to books": linking, upload
// auto-match and Re-run must never write bank_reference onto an EXISTING
// entry. The only bank_reference writes left in App.jsx are the three that
// stamp a brand-new record created from a bank line (Create new tab).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");

test("no helper fills or overwrites an existing entry's bank_reference", () => {
  assert.ok(!app.includes("fillBankReference"));
});

test("bank_reference is only set while inserting a new collection / expense / transfer from a bank line", () => {
  const start = app.indexOf("const classifyBankLine");
  const end = app.indexOf("const setBankLineIgnored");
  assert.ok(start > 0 && end > start);
  const classify = app.slice(start, end);
  const inClassify = classify.split("\n").filter((l) => /bank_reference:\s*bankReferenceText\(/.test(l));
  assert.equal(inClassify.length, 3);
  assert.equal((classify.match(/created = await insert(Collection|Expense|Transfer)\(/g) || []).length, 3);
  // ...and nowhere else in the file
  const everywhere = app.split("\n").filter((l) => /bank_reference:\s*bankReferenceText\(/.test(l));
  assert.equal(everywhere.length, 3);
});
