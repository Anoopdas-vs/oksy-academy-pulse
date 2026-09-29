// Integration + security tests for migration 27: bulk_upsert_students().
//
// Same setup as studentId.rls.test.js: these hit a REAL Supabase project and
// SKIP (not fail) unless the env vars below are set, so `npm test` stays
// green offline. Point them at a disposable/staging project with migration
// 27 applied — never production.
//
// Required env vars:
//   TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY
//   TEST_SUPABASE_SERVICE_KEY   - seeds/tears down fixtures only; every
//                                 assertion runs as a real signed-in user
//   TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD   - role 'admin' or 'super_admin'
//   TEST_STAFF_EMAIL / TEST_STAFF_PASSWORD   - role 'staff' (Executive)
// Optional:
//   TEST_STUDENT_A_EMAIL / TEST_STUDENT_A_PASSWORD - role 'student'
//
// Note: each applied upload leaves one audit_log row (the table has no API
// delete path); they are harmless on a test project.
//
// Run: node --test src/lib/studentBulk.rls.test.js

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const REQUIRED_ENV = [
  "TEST_SUPABASE_URL",
  "TEST_SUPABASE_ANON_KEY",
  "TEST_SUPABASE_SERVICE_KEY",
  "TEST_ADMIN_EMAIL",
  "TEST_ADMIN_PASSWORD",
  "TEST_STAFF_EMAIL",
  "TEST_STAFF_PASSWORD",
];

const missing = REQUIRED_ENV.filter((k) => !process.env[k]);

if (missing.length) {
  describe("student bulk upload (live Supabase)", () => {
    test("skipped: no test Supabase connection configured", (t) => {
      console.log(
        `[studentBulk.rls.test.js] Skipping — missing env var(s): ${missing.join(", ")}. ` +
          "These tests need a disposable/staging Supabase project (never production); " +
          "see the file header for the full list."
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

  const tag = Date.now().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const CODE = `ZB${tag}`;
  const OTHER_CODE = `ZC${tag}`;
  const COURSE = `Bulk Test Course ${tag}`;
  const OTHER_COURSE = `Bulk Other Course ${tag}`;
  const BATCH = `BULKB${tag}`;
  const OTHER_BATCH = `BULKC${tag}`;
  const id = (n) => `${CODE}${String(n).padStart(3, "0")}`;
  const created = new Set();

  let admin;
  let staff;
  const call = (client, rows, { dryRun = false, confirm = false } = {}) =>
    client.rpc("bulk_upsert_students", { p_rows: rows, p_dry_run: dryRun, p_confirm_blanks: confirm });
  const stored = async (sid) =>
    (await service.from("students").select("*").eq("id", sid).maybeSingle()).data;

  describe("student bulk upload (live Supabase)", () => {
    before(async () => {
      admin = await signIn(process.env.TEST_ADMIN_EMAIL, process.env.TEST_ADMIN_PASSWORD);
      staff = await signIn(process.env.TEST_STAFF_EMAIL, process.env.TEST_STAFF_PASSWORD);
      const { error: cErr } = await service.from("courses").insert([
        { code: CODE, name: COURSE },
        { code: OTHER_CODE, name: OTHER_COURSE },
      ]);
      assert.equal(cErr, null, `seed courses: ${cErr?.message}`);
      const fees = { course_fee: 0, registration_fee: 0, exam_fee: 0 };
      const { error: bErr } = await service.from("batches").insert([
        { name: BATCH, course_name: COURSE, ...fees },
        { name: OTHER_BATCH, course_name: OTHER_COURSE, ...fees },
      ]);
      assert.equal(bErr, null, `seed batches: ${bErr?.message}`);
      const { error: sErr } = await service.from("students").insert([
        { id: id(1), name: "Seed One", batch: BATCH, status: "Active", place: "Kochi",
          student_phone: "9000000001", parent_name: "Old Parent", registration_fee: 500 },
      ]);
      assert.equal(sErr, null, `seed students: ${sErr?.message}`);
      created.add(id(1));
    });

    after(async () => {
      const ids = [...created];
      await service.from("students").delete().in("id", ids);
      await service.from("batches").delete().in("name", [BATCH, OTHER_BATCH]);
      await service.from("courses").delete().in("name", [COURSE, OTHER_COURSE]);
    });

    // ---- authorization ----
    test("staff (Executive) is blocked, dry run and apply", async () => {
      const rows = [{ id: id(50), name: "Nope", batch: BATCH }];
      for (const dryRun of [true, false]) {
        const { error } = await call(staff, rows, { dryRun, confirm: true });
        assert.match(error?.message || "", /Only the Owner or an Admin/);
      }
      assert.equal(await stored(id(50)), null, "no row may be created");
    });

    test("anonymous callers cannot execute the RPC", async () => {
      const anon = createClient(url, anonKey);
      const { error } = await call(anon, [{ id: id(51), name: "Anon", batch: BATCH }], { dryRun: true });
      assert.ok(error, "must be refused");
      assert.equal(await stored(id(51)), null);
    });

    test("student login is blocked", async (t) => {
      if (!process.env.TEST_STUDENT_A_EMAIL) return t.skip("no TEST_STUDENT_A_* configured");
      const student = await signIn(process.env.TEST_STUDENT_A_EMAIL, process.env.TEST_STUDENT_A_PASSWORD);
      const { error } = await call(student, [{ id: id(52), name: "Stu", batch: BATCH }], { dryRun: true });
      assert.match(error?.message || "", /Only the Owner or an Admin/);
    });

    // ---- validation ----
    test("dry run classifies rows and writes nothing", async () => {
      const rows = [
        { row: 2, id: id(1), name: "Seed One", batch: BATCH, status: "Active", place: "Kochi",
          student_phone: "9000000001", parent_name: "Old Parent", registration_fee: "500" },
        { row: 3, id: id(60), name: "Fresh", batch: BATCH },
        { row: 4, id: `${OTHER_CODE}100`, name: "Wrong prefix", batch: BATCH },
        { row: 5, id: id(61), name: "Dup A", batch: BATCH },
        { row: 6, id: id(61), name: "Dup B", batch: BATCH },
        { row: 7, id: id(62), name: "Bad", batch: BATCH, student_phone: "123", student_email: "x" },
        { row: 8, id: id(63), name: "No batch" },
      ];
      const { data, error } = await call(admin, rows, { dryRun: true });
      assert.equal(error, null, error?.message);
      assert.equal(data.dry_run, true);
      assert.equal(data.unchanged, 1);
      assert.equal(data.new, 1);
      assert.equal(data.errors, 5);
      const by = Object.fromEntries(data.rows.map((r) => [r.row, r]));
      assert.match(by[4].errors[0], /must start with/);
      assert.match(by[5].errors[0], /Duplicate/);
      assert.match(by[6].errors[0], /Duplicate/);
      assert.match(by[7].errors.join(" "), /10 digits/);
      assert.match(by[8].errors[0], /Batch is required/);
      assert.equal(await stored(id(60)), null, "dry run must not insert");
    });

    test("ID format: at least 3 digits, no extra leading zeros", async () => {
      const { data } = await call(admin, [
        { id: `${CODE}5`, name: "Short", batch: BATCH },
        { id: `${CODE}0005`, name: "Padded", batch: BATCH },
        { id: `${CODE}1000`, name: "Long ok", batch: BATCH },
      ], { dryRun: true });
      assert.deepEqual(data.rows.map((r) => r.action), ["error", "error", "new"]);
    });

    test("row cap: 2001 rows refused", async () => {
      const rows = Array.from({ length: 2001 }, (_, i) => ({ id: `${CODE}${3000 + i}`, name: "n", batch: BATCH }));
      const { error } = await call(admin, rows, { dryRun: true });
      assert.match(error?.message || "", /at most 2000/);
    });

    // ---- blank overwrite confirmation ----
    test("blank cells warn, and apply requires explicit confirmation", async () => {
      const rows = [{ id: id(1), name: "Seed One", batch: BATCH, student_phone: "9000000001" }]; // place, parent, fee blank
      const dry = await call(admin, rows, { dryRun: true });
      assert.equal(dry.data.blank_overwrites, 3);
      assert.equal(dry.data.updates, 1);

      const refused = await call(admin, rows, { dryRun: false, confirm: false });
      assert.match(refused.error?.message || "", /blank cell.*confirm/i);
      assert.equal((await stored(id(1))).place, "Kochi", "nothing may change without confirmation");

      const ok = await call(admin, rows, { dryRun: false, confirm: true });
      assert.equal(ok.error, null, ok.error?.message);
      const row = await stored(id(1));
      assert.equal(row.place, null);
      assert.equal(row.parent_name, null);
      assert.equal(Number(row.registration_fee), 0);
    });

    // ---- immutability ----
    test("ID, status and batch cannot be changed by an upload", async () => {
      const before = await stored(id(1));
      const { data, error } = await call(admin, [
        { id: id(1).toLowerCase(), name: "Renamed", batch: OTHER_BATCH, status: "Dropped", student_phone: "9111111111" },
      ], { confirm: true });
      assert.equal(error, null, error?.message);
      assert.match(data.rows[0].warnings.join(" "), /Batch .* ignored/);
      assert.match(data.rows[0].warnings.join(" "), /Status .* ignored/);
      const after = await stored(id(1));
      assert.equal(after.id, before.id);
      assert.equal(after.batch, before.batch);
      assert.equal(after.status, before.status);
      assert.equal(after.name, "Renamed");
      assert.equal(after.student_phone, "9111111111");
    });

    // ---- new students + counter ----
    test("new student: forced Registered, dated today, created_by is the caller; counter advances", async () => {
      const { data, error } = await call(admin, [
        { id: id(200), name: "Manual", batch: BATCH, status: "Active", student_phone: "9222222222" },
      ], { confirm: true });
      assert.equal(error, null, error?.message);
      created.add(id(200));
      assert.equal(data.new, 1);
      const row = await stored(id(200));
      assert.equal(row.status, "Registered");
      assert.equal(row.enrollment_date, new Date().toISOString().slice(0, 10));
      assert.ok(row.created_by);

      const { data: next } = await admin.rpc("preview_student_id", { p_batch: BATCH });
      assert.equal(next, id(201), "auto-ID counter must move past the manual ID");

      // Jump far ahead; the form's next ID follows and never collides.
      const far = `${CODE}1500`;
      const r2 = await call(admin, [{ id: far, name: "Far", batch: BATCH }], { confirm: true });
      assert.equal(r2.error, null, r2.error?.message);
      created.add(far);
      const { data: enrolled, error: eErr } = await admin.rpc("enroll_student", {
        p_student: { name: "After Manual", batch: BATCH, student_phone: "9000000009", parent_name: "P", parent_phone: "9000000008", place: "K" },
      });
      assert.equal(eErr, null, eErr?.message);
      created.add(enrolled);
      assert.equal(enrolled, `${CODE}1501`);
    });

    test("an existing ID is an update, never a duplicate insert (any case/padding)", async () => {
      const { data } = await call(admin, [{ id: ` ${id(200).toLowerCase()} `, name: "Manual", batch: BATCH }], { dryRun: true });
      assert.notEqual(data.rows[0].action, "new");
      assert.equal(data.rows[0].id, id(200));
    });

    // ---- atomicity ----
    test("any error rolls back the whole upload", async () => {
      const { error } = await call(admin, [
        { id: id(70), name: "Good", batch: BATCH },
        { id: id(1), name: "Would rename", batch: BATCH, student_phone: "9111111111" },
        { id: `${OTHER_CODE}999`, name: "Bad prefix", batch: BATCH },
      ], { confirm: true });
      assert.match(error?.message || "", /have errors; nothing was saved/);
      assert.equal(await stored(id(70)), null);
      assert.equal((await stored(id(1))).name, "Renamed");
    });
  });
}
