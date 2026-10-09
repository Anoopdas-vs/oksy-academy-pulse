import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { bookEntryFields, bookEntryDetail, resolveBookEntry, createDelayedClose } from "./bookEntry.js";

const students = [{ id: "S1", name: "Asha", batch: "B-7" }];
const lists = {
  collections: [{ id: 1, student_id: "S1", student_name: "Asha", type: "Tuition", amount: 5000, date: "2026-03-04" }],
  expenses: [{ id: 2, category: "Rent", description: "March rent", amount: 12000, date: "2026-03-05" }],
  transfers: [{ id: 3, from_account: "Cash", to_account: "ICICI", purpose: "Deposit", amount: 2500, date: "2026-03-06" }],
};
const get = (fields, k) => fields.find(([n]) => n === k)?.[1];

describe("bookEntryFields", () => {
  test("fee", () => {
    const f = bookEntryFields("collection", lists.collections[0], students);
    assert.deepEqual(f.map(([k]) => k), ["Student ID", "Student name", "Batch", "Fee type", "Amount", "Date", "Account", "Reference"]);
    assert.equal(get(f, "Student ID"), "S1");
    assert.equal(get(f, "Batch"), "B-7");
    assert.equal(get(f, "Fee type"), "Tuition");
    assert.match(get(f, "Amount"), /5,000/);
    assert.equal(get(f, "Date"), "2026-03-04");
  });
  test("expense", () => {
    const f = bookEntryFields("expense", lists.expenses[0]);
    assert.deepEqual(f.map(([k]) => k), ["Category", "Description", "Amount", "Date", "Account", "Reference"]);
    assert.equal(get(f, "Category"), "Rent");
    assert.equal(get(f, "Description"), "March rent");
  });
  test("transfer", () => {
    const f = bookEntryFields("transfer", lists.transfers[0]);
    assert.equal(get(f, "From → To"), "Cash → ICICI");
    assert.equal(get(f, "Description"), "Deposit");
    assert.match(get(f, "Amount"), /2,500/);
  });
  test("missing values show a dash", () => {
    assert.equal(get(bookEntryFields("collection", { student_id: "X", amount: 1 }, []), "Batch"), "—");
  });
});

describe("bookEntryDetail", () => {
  test("header code, bank reference and copy text", () => {
    const row = { ...lists.collections[0], account: "ICICI", bank_reference: " UPI/123/ASHA " };
    const d = bookEntryDetail("collection", row, students);
    assert.equal(d.code, "OKSY/000001");
    assert.equal(d.kindLabel, "Fee receipt");
    assert.equal(d.bankReference, "UPI/123/ASHA");
    assert.match(d.copyText, /^Fee receipt: OKSY\/000001\n/);
    assert.match(d.copyText, /Account: ICICI/);
    assert.match(d.copyText, /Bank reference: UPI\/123\/ASHA$/);
  });
  test("codes for expense and transfer; empty bank reference", () => {
    assert.equal(bookEntryDetail("expense", lists.expenses[0]).code, "EXP-00002");
    const t = bookEntryDetail("transfer", lists.transfers[0]);
    assert.equal(t.code, "TRF-00003");
    assert.equal(t.bankReference, "");
    assert.match(t.copyText, /Bank reference: —$/);
  });
});

describe("resolveBookEntry", () => {
  test("uses loaded data without fetching", async () => {
    let calls = 0;
    const r = await resolveBookEntry({ kind: "expense", id: 2, lists, students, fetchEntry: async () => { calls++; } });
    assert.equal(r.status, "found");
    assert.equal(calls, 0);
  });
  test("a missing entry triggers one single-id fetch", async () => {
    const calls = [];
    const row = { id: 9, category: "Tea", description: "", amount: 50, date: "2026-01-01" };
    const r = await resolveBookEntry({ kind: "expense", id: 9, lists, students, fetchEntry: async (k, i) => { calls.push([k, i]); return row; } });
    assert.deepEqual(calls, [["expense", 9]]);
    assert.equal(get(r.fields, "Category"), "Tea");
  });
  test("not found", async () => {
    const r = await resolveBookEntry({ kind: "transfer", id: 99, lists, students, fetchEntry: async () => null });
    assert.deepEqual(r, { status: "notfound" });
  });
  test("fetch failure is not found", async () => {
    const r = await resolveBookEntry({ kind: "transfer", id: 99, lists, students, fetchEntry: async () => { throw new Error("rls"); } });
    assert.deepEqual(r, { status: "notfound" });
  });
});

describe("createDelayedClose", () => {
  const fake = () => {
    const q = new Map();
    let n = 0;
    return {
      q,
      timers: { set: (fn, ms) => { q.set(++n, { fn, ms }); return n; }, clear: (id) => q.delete(id) },
    };
  };
  test("closes only after the delay fires", () => {
    const f = fake();
    let closed = 0;
    const c = createDelayedClose(() => closed++, 150, f.timers);
    c.schedule();
    assert.equal(closed, 0);
    assert.equal([...f.q.values()][0].ms, 150);
    [...f.q.values()][0].fn();
    assert.equal(closed, 1);
  });
  test("reaching the popup (cancel) keeps it open", () => {
    const f = fake();
    let closed = 0;
    const c = createDelayedClose(() => closed++, 150, f.timers);
    c.schedule();
    c.cancel();
    assert.equal(f.q.size, 0);
    assert.equal(closed, 0);
  });
  test("rescheduling leaves a single pending timer", () => {
    const f = fake();
    const c = createDelayedClose(() => {}, 150, f.timers);
    c.schedule();
    c.schedule();
    assert.equal(f.q.size, 1);
  });
});
