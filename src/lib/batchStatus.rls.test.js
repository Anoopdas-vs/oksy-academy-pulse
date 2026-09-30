// Integration + security tests for migrations 28/28b: preview_batch_status_changes(),
// batch_status_data_issues(), run_batch_status_automation() and the two triggers
// (students_follow_batch_dates, batches_resync_students). Migration 28b must be
// applied (triggers enabled).
//
// Like studentBulk.rls.test.js: these hit a REAL Supabase project and SKIP
// (not fail) unless the env vars below are set. Point them at a disposable
// staging project with migration 28 applied — NEVER production: the run
// function re-syncs EVERY student in the database, not just the fixtures, so
// an apply test on production would really change statuses.
//
// Required env vars:
//   TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY
//   TEST_SUPABASE_SERVICE_KEY   - seeds/tears down fixtures only
//   TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD   - role 'admin' or 'super_admin'
//   TEST_STAFF_EMAIL / TEST_STAFF_PASSWORD   - role 'staff'
//   TEST_STUDENT_A_EMAIL / TEST_STUDENT_A_PASSWORD - role 'student'
//
// Run: node --test src/lib/batchStatus.rls.test.js

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { istToday } from "./batchStatus.js";

const REQUIRED_ENV = [
  "TEST_SUPABASE_URL",
  "TEST_SUPABASE_ANON_KEY",
  "TEST_SUPABASE_SERVICE_KEY",
  "TEST_ADMIN_EMAIL",
  "TEST_ADMIN_PASSWORD",
  "TEST_STAFF_EMAIL",
  "TEST_STAFF_PASSWORD",
  "TEST_STUDENT_A_EMAIL",
  "TEST_STUDENT_A_PASSWORD",
];

const missing = REQUIRED_ENV.filter((k) => !process.env[k]);

if (missing.length) {
  describe("batch status automation (live Supabase)", () => {
    test("skipped: no test Supabase connection configured", (t) => {
      console.log(
        `[batchStatus.rls.test.js] Skipping — missing env var(s): ${missing.join(", ")}. ` +
          "These tests need a disposable/staging Supabase project (never production)."
      );
      t.skip();
    });
  });
} else {
  const url = process.env.TEST_SUPABASE_URL;
  const anonKey = process.env.TEST_SUPABASE_ANON_KEY;
  const service = createClient(url, process.env.TEST_SUPABASE_SERVICE_KEY);

  async function signIn(email, password) {
    const client = createClient(url, anonKey);
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
    return client;
  }

  const addDays = (iso, n) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  const tag = Date.now().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const today = istToday();
  const B = {
    running: `BSA${tag}`, // started yesterday, ends in 30 days
    endsToday: `BSB${tag}`,
    noDates: `BSC${tag}`,
    future: `BSD${tag}`,
    noEnd: `BSE${tag}`,
    noStart: `BSF${tag}`,
  };
  const S = (n) => `ZBS${tag}${n}`;
  const ids = [];
  let admin, staff, student;

  const status = async (sid) => (await service.from("students").select("status").eq("id", sid).single()).data.status;
  const addStudent = async (n, batch, st) => {
    ids.push(S(n));
    // The students trigger corrects the status on insert, so the fixture is
    // inserted with whatever the test asks for and then read back.
    const { error } = await service.from("students").insert({ id: S(n), name: `BS ${n}`, batch, status: st });
    assert.equal(error, null, error?.message);
    return status(S(n));
  };
  const setBatch = (name, patch) => admin.from("batches").update(patch).eq("name", name);
  const previewFor = async (client, asOf) => {
    const { data, error } = await client.rpc("preview_batch_status_changes", asOf ? { p_as_of: asOf } : {});
    assert.equal(error, null, error?.message);
    return data.filter((r) => ids.includes(r.student_id));
  };

  describe("batch status automation (live Supabase)", () => {
    before(async () => {
      admin = await signIn(process.env.TEST_ADMIN_EMAIL, process.env.TEST_ADMIN_PASSWORD);
      staff = await signIn(process.env.TEST_STAFF_EMAIL, process.env.TEST_STAFF_PASSWORD);
      student = await signIn(process.env.TEST_STUDENT_A_EMAIL, process.env.TEST_STUDENT_A_PASSWORD);
      const { error } = await service.from("batches").insert([
        { name: B.running, start_date: addDays(today, -1), end_date: addDays(today, 30) },
        { name: B.endsToday, start_date: addDays(today, -30), end_date: today },
        { name: B.noDates, start_date: null, end_date: null },
        { name: B.future, start_date: addDays(today, 5), end_date: addDays(today, 60) },
        { name: B.noEnd, start_date: addDays(today, -2), end_date: null },
        { name: B.noStart, start_date: null, end_date: addDays(today, -1) },
      ]);
      assert.equal(error, null, `seed batches: ${error?.message}`);
    });

    after(async () => {
      await service.from("students").delete().in("id", ids);
      await service.from("batches").delete().in("name", Object.values(B));
    });

    // ---- authorization: preview, data-issues and run ----
    for (const [label, getClient] of [["staff", () => staff], ["student", () => student]]) {
      test(`${label} is blocked from preview, data-issues and run`, async () => {
        for (const fn of ["preview_batch_status_changes", "batch_status_data_issues", "run_batch_status_automation"]) {
          const { error } = await getClient().rpc(fn);
          assert.match(error?.message || "", /Only the Owner or an Admin/, `${label}/${fn}`);
        }
      });
    }

    test("anonymous callers cannot execute any of them", async () => {
      const anon = createClient(url, anonKey);
      for (const fn of ["preview_batch_status_changes", "batch_status_data_issues", "run_batch_status_automation"]) {
        assert.ok((await anon.rpc(fn)).error, `anon/${fn} must be refused`);
      }
    });

    test("internal helpers are not callable through the API", async () => {
      assert.ok((await admin.rpc("batch_status_targets", { p_today: today })).error);
      assert.ok((await admin.rpc("batch_status_for", { p_status: "Active", p_start: today, p_end: null, p_today: today })).error);
    });

    // ---- student trigger: correct on insert ----
    test("insert: a Registered student in a running batch is stored as Active", async () => {
      assert.equal(await addStudent(1, B.running, "Registered"), "Active");
    });
    test("insert: a student in a future batch is stored as Registered", async () => {
      assert.equal(await addStudent(2, B.future, "Active"), "Registered");
    });
    test("insert: Dropped is never changed", async () => {
      assert.equal(await addStudent(3, B.running, "Dropped"), "Dropped");
    });
    test("insert: a no-date batch is skipped (status kept)", async () => {
      assert.equal(await addStudent(4, B.noDates, "Registered"), "Registered");
      assert.equal(await addStudent(5, B.noStart, "Registered"), "Registered"); // end date ignored
    });
    test("insert: end date itself is Completed", async () => {
      assert.equal(await addStudent(6, B.endsToday, "Registered"), "Completed");
    });
    test("insert: Completed in a batch with no end date is left alone", async () => {
      assert.equal(await addStudent(7, B.noEnd, "Completed"), "Completed");
    });

    // ---- manual edits are enforced too ----
    test("a manual status edit is re-derived from the dates; Dropped sticks; un-drop re-derives", async () => {
      await admin.from("students").update({ status: "Completed" }).eq("id", S(1));
      assert.equal(await status(S(1)), "Active");
      await admin.from("students").update({ status: "Dropped" }).eq("id", S(1));
      assert.equal(await status(S(1)), "Dropped");
      await admin.from("students").update({ status: "Registered" }).eq("id", S(1));
      assert.equal(await status(S(1)), "Active");
    });

    test("moving a student to another batch re-derives the status", async () => {
      await admin.from("students").update({ batch: B.future }).eq("id", S(1));
      assert.equal(await status(S(1)), "Registered");
      await admin.from("students").update({ batch: B.running }).eq("id", S(1));
      assert.equal(await status(S(1)), "Active");
    });

    // ---- batch trigger: both directions, Dropped untouched ----
    test("extended end date turns Completed back to Active", async () => {
      await setBatch(B.endsToday, { end_date: addDays(today, 20) });
      assert.equal(await status(S(6)), "Active");
    });
    test("start date moved later turns Active back to Registered; Dropped untouched", async () => {
      await setBatch(B.running, { start_date: addDays(today, 3), end_date: addDays(today, 40) });
      assert.equal(await status(S(1)), "Registered");
      assert.equal(await status(S(3)), "Dropped");
    });
    test("giving a no-date batch dates activates its students; Completed stays without an end date", async () => {
      await service.from("students").update({ status: "Registered" }).eq("id", S(4));
      await setBatch(B.noDates, { start_date: addDays(today, -1), end_date: null });
      assert.equal(await status(S(4)), "Active");
    });
    test("a staff (Executive) batch-date edit re-syncs students and is logged with the staff user", async () => {
      const { error } = await staff.from("batches").update({ end_date: addDays(today, 10) }).eq("name", B.noEnd);
      assert.equal(error, null, error?.message);
      assert.equal(await status(S(7)), "Active"); // Completed + end date now in the future
      const { data } = await service
        .from("audit_log").select("changed_by")
        .eq("table_name", "students").eq("row_id", 0)
        .contains("new_row", { batch_status_automation: true, source: "batch_trigger", batch: B.noEnd })
        .order("id", { ascending: false }).limit(1);
      assert.ok(data?.length && data[0].changed_by, "expected a batch_trigger audit row with changed_by set");
    });

    // ---- dry run, run, idempotence ----
    test("dry run for a later date lists the change, flags is_revert, and writes nothing", async () => {
      const rows = await previewFor(admin, addDays(today, 100));
      const r = rows.find((x) => x.student_id === S(1));
      assert.ok(r, "expected the fixture student in the list");
      assert.equal(r.old_status, "Registered");
      assert.equal(r.new_status, "Completed");
      assert.equal(r.is_revert, false);
      assert.equal(await status(S(1)), "Registered");
    });

    test("run is idempotent: nothing left to change, and a second run does nothing", async () => {
      await admin.rpc("run_batch_status_automation");
      const { data, error } = await admin.rpc("run_batch_status_automation");
      assert.equal(error, null, error?.message);
      assert.equal(data.total, 0);
      assert.equal(data.run_date, today);
    });

    test("batch_status_data_issues lists a batch whose end is before its start", async () => {
      await setBatch(B.future, { start_date: addDays(today, 10), end_date: addDays(today, 5) });
      const { data, error } = await admin.rpc("batch_status_data_issues");
      assert.equal(error, null, error?.message);
      assert.ok(data.some((r) => r.batch === B.future));
      assert.equal(await status(S(2)), "Registered"); // bad-data batch: skipped
    });
  });
}
