// Integration tests for migration 26: database-assigned Student IDs and the
// Owner/Admin-only safe delete of mistaken enrolments.
//
// Same setup as students.rls.test.js: these hit a REAL Supabase project and
// SKIP (not fail) unless the env vars below are set, so `npm test` stays
// green offline. Point them at a disposable/staging project with migration
// 26 applied — never production.
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
// Run: node --test src/lib/studentId.rls.test.js

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
  describe("student ID allocation + safe delete (live Supabase)", () => {
    test("skipped: no test Supabase connection configured", (t) => {
      console.log(
        `[studentId.rls.test.js] Skipping — missing env var(s): ${missing.join(", ")}. ` +
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

  // Unique fixtures per run: batch names must be A-Z0-9 (migration 25).
  const tag = Date.now().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const CODE = `ZT${tag}`;
  const COURSE = `RLS Test Course ${tag}`;
  const BATCH = `RLSB${tag}`;
  const NOCODE_COURSE = `RLS No Code ${tag}`;
  const NOCODE_BATCH = `RLSN${tag}`;
  const enrolled = [];

  let admin;
  let staff;

  const payload = (name) => ({
    batch: BATCH,
    name,
    student_phone: "9000000001",
    parent_name: "Test Parent",
    parent_phone: "9000000002",
    place: "Kochi",
  });

  async function enrollAs(client, name) {
    const { data, error } = await client.rpc("enroll_student", { p_student: payload(name) });
    if (!error) enrolled.push(data);
    return { data, error };
  }

  describe("student ID allocation + safe delete (live Supabase)", () => {
    before(async () => {
      admin = await signIn(process.env.TEST_ADMIN_EMAIL, process.env.TEST_ADMIN_PASSWORD);
      staff = await signIn(process.env.TEST_STAFF_EMAIL, process.env.TEST_STAFF_PASSWORD);
      const { error: cErr } = await service.from("courses").insert([
        { code: CODE, name: COURSE },
        { code: null, name: NOCODE_COURSE },
      ]);
      assert.equal(cErr, null, `seed courses: ${cErr?.message}`);
      // Trailing space on purpose: matching must trim both sides.
      const { error: bErr } = await service.from("batches").insert([
        { name: BATCH, course_name: `${COURSE} `, course_fee: 0, registration_fee: 0, exam_fee: 0 },
        { name: NOCODE_BATCH, course_name: NOCODE_COURSE, course_fee: 0, registration_fee: 0, exam_fee: 0 },
      ]);
      assert.equal(bErr, null, `seed batches: ${bErr?.message}`);
      // Existing numbering with a gap: next must be 117, never a gap-fill.
      const { error: sErr } = await service.from("students").insert([
        { id: `${CODE}001`, name: "Seed 1", batch: BATCH },
        { id: `${CODE}116`, name: "Seed 116", batch: BATCH },
      ]);
      assert.equal(sErr, null, `seed students: ${sErr?.message}`);
      enrolled.push(`${CODE}001`, `${CODE}116`);
    });

    after(async () => {
      await service.from("profiles").update({ student_ref: null }).in("student_ref", enrolled);
      await service.from("collections").delete().in("student_id", enrolled);
      await service.from("students").delete().in("id", enrolled);
      await service.from("batches").delete().in("name", [BATCH, NOCODE_BATCH]);
      await service.from("courses").delete().in("name", [COURSE, NOCODE_COURSE]);
    });

    test("preview + enrol: next number after the highest, gap not filled", async () => {
      const { data: preview, error: pErr } = await staff.rpc("preview_student_id", { p_batch: BATCH });
      assert.equal(pErr, null, pErr?.message);
      assert.equal(preview, `${CODE}117`);
      const { data: id, error } = await enrollAs(staff, "First Real");
      assert.equal(error, null, error?.message);
      assert.equal(id, `${CODE}117`);
      const { data: row } = await staff.from("students").select("status, course").eq("id", id).single();
      assert.equal(row.status, "Registered", "default status");
    });

    test("a client-supplied id is ignored", async () => {
      const { data, error } = await staff.rpc("enroll_student", {
        p_student: { ...payload("Sneaky"), id: "HACK001" },
      });
      assert.equal(error, null, error?.message);
      enrolled.push(data);
      assert.match(data, new RegExp(`^${CODE}\\d{3,}$`));
    });

    test("concurrent enrolments get distinct, consecutive IDs", async () => {
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => enrollAs(i % 2 ? admin : staff, `Concurrent ${i}`))
      );
      for (const r of results) assert.equal(r.error, null, r.error?.message);
      const ids = results.map((r) => r.data);
      assert.equal(new Set(ids).size, ids.length, `duplicate IDs: ${ids.join(",")}`);
      const nums = ids.map((id) => Number(id.slice(CODE.length))).sort((a, b) => a - b);
      for (let i = 1; i < nums.length; i++) assert.equal(nums[i], nums[i - 1] + 1, "consecutive");
    });

    test("batch whose course has no code is refused with a clear message", async () => {
      const { error } = await staff.rpc("enroll_student", {
        p_student: { ...payload("No Code"), batch: NOCODE_BATCH },
      });
      assert.match(error?.message || "", /no course code/i);
    });

    test("student IDs cannot be changed", async () => {
      const { error } = await staff.from("students").update({ id: `${CODE}999` }).eq("id", `${CODE}001`);
      assert.match(error?.message || "", /can never be changed/);
    });

    test("non-admin cannot delete, and there is no direct DELETE path", async () => {
      const { data: id } = await enrollAs(staff, "Staff Delete Target");
      const { error } = await staff.rpc("delete_mistaken_student", { p_id: id });
      assert.match(error?.message || "", /Only the Owner or an Admin/);

      // Plain REST delete — even by an admin — matches no policy, so 0 rows.
      const { data: gone } = await admin.from("students").delete().eq("id", id).select();
      assert.equal((gone ?? []).length, 0);
      const { data: still } = await service.from("students").select("id").eq("id", id);
      assert.equal(still.length, 1, "row must still exist");

      if (process.env.TEST_STUDENT_A_EMAIL && process.env.TEST_STUDENT_A_PASSWORD) {
        const student = await signIn(process.env.TEST_STUDENT_A_EMAIL, process.env.TEST_STUDENT_A_PASSWORD);
        const { error: sDel } = await student.rpc("delete_mistaken_student", { p_id: id });
        assert.match(sDel?.message || "", /Only the Owner or an Admin/);
        const { error: sEnr } = await student.rpc("enroll_student", { p_student: payload("Student Enrol") });
        assert.match(sEnr?.message || "", /Only Owner, Admin or Executive/);
      }
    });

    test("admin cannot delete a student with records or past Registered", async () => {
      const { data: withReceipt } = await enrollAs(staff, "Has Receipt");
      const { error: colErr } = await service.from("collections").insert({
        student_id: withReceipt, student_name: "Has Receipt", date: "2026-09-01",
        type: "Course Fee", account: "Cash", amount: 1,
      });
      assert.equal(colErr, null, colErr?.message);
      const { error: e1 } = await admin.rpc("delete_mistaken_student", { p_id: withReceipt });
      assert.match(e1?.message || "", /fee receipts.*Dropped/);

      const { data: active } = await enrollAs(staff, "Now Active");
      await service.from("students").update({ status: "Active" }).eq("id", active);
      const { error: e2 } = await admin.rpc("delete_mistaken_student", { p_id: active });
      assert.match(e2?.message || "", /Only a Registered enrolment.*Dropped/);
    });

    test("admin can delete a clean Registered enrolment", async () => {
      const { data: id } = await enrollAs(staff, "Typo Enrolment");
      const { error } = await admin.rpc("delete_mistaken_student", { p_id: id });
      assert.equal(error, null, error?.message);
      const { data: rows } = await service.from("students").select("id").eq("id", id);
      assert.equal(rows.length, 0);
    });
  });
}
