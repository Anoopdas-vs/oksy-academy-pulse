// Integration tests for migration 29: batches_end_after_start CHECK.
//
// Hits a REAL Supabase project and SKIPS (not fails) unless the env vars below
// are set. Point it at a disposable/staging project with migration 29 applied.
//
// Required env vars: TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY,
//   TEST_SUPABASE_SERVICE_KEY (seeds/tears down fixtures only),
//   TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD
//
// Run: node --test src/lib/batchDates.rls.test.js

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const REQUIRED_ENV = [
  "TEST_SUPABASE_URL",
  "TEST_SUPABASE_ANON_KEY",
  "TEST_SUPABASE_SERVICE_KEY",
  "TEST_ADMIN_EMAIL",
  "TEST_ADMIN_PASSWORD",
];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);

if (missing.length) {
  describe("batch date order check (live Supabase)", () => {
    test("skipped: no test Supabase connection configured", (t) => {
      console.log(`[batchDates.rls.test.js] Skipping — missing env var(s): ${missing.join(", ")}.`);
      t.skip();
    });
  });
} else {
  const url = process.env.TEST_SUPABASE_URL;
  const service = createClient(url, process.env.TEST_SUPABASE_SERVICE_KEY);
  const tag = Date.now().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const N = (s) => `BD${s}${tag}`;
  let admin;

  describe("batch date order check (live Supabase)", () => {
    before(async () => {
      admin = createClient(url, process.env.TEST_SUPABASE_ANON_KEY);
      const { error } = await admin.auth.signInWithPassword({
        email: process.env.TEST_ADMIN_EMAIL,
        password: process.env.TEST_ADMIN_PASSWORD,
      });
      assert.equal(error, null, error?.message);
    });

    after(async () => {
      await service.from("batches").delete().like("name", `BD%${tag}`);
    });

    test("insert with end before start is refused", async () => {
      const { error } = await admin.from("batches").insert({ name: N("A"), start_date: "2026-09-03", end_date: "2026-03-02" });
      assert.match(error?.message || "", /batches_end_after_start/);
    });

    test("valid, equal, and null date combinations are accepted", async () => {
      const rows = [
        { name: N("B"), start_date: "2026-09-03", end_date: "2027-03-02" },
        { name: N("C"), start_date: "2026-09-03", end_date: "2026-09-03" },
        { name: N("D"), start_date: "2026-09-03", end_date: null },
        { name: N("E"), start_date: null, end_date: "2026-03-02" },
        { name: N("F"), start_date: null, end_date: null },
      ];
      const { error } = await admin.from("batches").insert(rows);
      assert.equal(error, null, error?.message);
    });

    test("update to an invalid range is refused, and the row is unchanged", async () => {
      const { error } = await admin.from("batches").update({ end_date: "2026-01-01" }).eq("name", N("B"));
      assert.match(error?.message || "", /batches_end_after_start/);
      const { data } = await service.from("batches").select("end_date").eq("name", N("B")).single();
      assert.equal(data.end_date, "2027-03-02");
    });

    test("changing dates to another valid range is accepted", async () => {
      const { error } = await admin.from("batches").update({ start_date: "2026-10-01", end_date: "2027-04-01" }).eq("name", N("B"));
      assert.equal(error, null, error?.message);
    });
  });
}
