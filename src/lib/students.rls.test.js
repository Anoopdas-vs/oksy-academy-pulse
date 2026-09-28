// Integration tests for students row isolation (migration 22) now that the
// table carries personal/contact fields (migration 24): a student login may
// read ONLY its own students row, never another student's phone/email/
// parent details; staff+ read all; faculty read none.
//
// Same setup as academy.rls.test.js: these hit a REAL Supabase project and
// SKIP (not fail) unless the env vars below are set, so `npm test` stays
// green offline. Point them at a disposable/staging project with migrations
// 22-24 applied — never production.
//
// Required env vars:
//   TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY
//   TEST_SUPABASE_SERVICE_KEY   - seeds/tears down fixtures only; every
//                                 assertion runs as a real signed-in user
//   TEST_STUDENT_A_EMAIL / TEST_STUDENT_A_PASSWORD   - role 'student'
//   TEST_STUDENT_B_EMAIL / TEST_STUDENT_B_PASSWORD   - a second 'student'
//   TEST_GRADER_EMAIL / TEST_GRADER_PASSWORD         - 'staff'/'admin'/'super_admin'
// Optional:
//   TEST_FACULTY_EMAIL / TEST_FACULTY_PASSWORD       - role 'faculty'
//
// Run: node --test src/lib/students.rls.test.js

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const REQUIRED_ENV = [
  "TEST_SUPABASE_URL",
  "TEST_SUPABASE_ANON_KEY",
  "TEST_SUPABASE_SERVICE_KEY",
  "TEST_STUDENT_A_EMAIL",
  "TEST_STUDENT_A_PASSWORD",
  "TEST_STUDENT_B_EMAIL",
  "TEST_STUDENT_B_PASSWORD",
  "TEST_GRADER_EMAIL",
  "TEST_GRADER_PASSWORD",
];

const missing = REQUIRED_ENV.filter((k) => !process.env[k]);

if (missing.length) {
  describe("students personal-field isolation (live Supabase)", () => {
    test("skipped: no test Supabase connection configured", (t) => {
      console.log(
        `[students.rls.test.js] Skipping — missing env var(s): ${missing.join(", ")}. ` +
          "These tests need a disposable/staging Supabase project (never production); " +
          "see the file header for the full list."
      );
      t.skip();
    });
  });
} else {
  const url = process.env.TEST_SUPABASE_URL;
  const anonKey = process.env.TEST_SUPABASE_ANON_KEY;
  const admin = createClient(url, process.env.TEST_SUPABASE_SERVICE_KEY);

  async function signIn(email, password) {
    const client = createClient(url, anonKey);
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
    const {
      data: { user },
    } = await client.auth.getUser();
    return { client, id: user.id };
  }

  describe("students personal-field isolation (live Supabase)", () => {
    test("a student reads only their own row; staff read all; faculty read none", async () => {
      const stamp = Date.now();
      const rowA = `RLS-A-${stamp}`;
      const rowB = `RLS-B-${stamp}`;

      const studentA = await signIn(process.env.TEST_STUDENT_A_EMAIL, process.env.TEST_STUDENT_A_PASSWORD);
      const studentB = await signIn(process.env.TEST_STUDENT_B_EMAIL, process.env.TEST_STUDENT_B_PASSWORD);
      const staff = await signIn(process.env.TEST_GRADER_EMAIL, process.env.TEST_GRADER_PASSWORD);

      // Remember existing links so teardown restores them exactly.
      const { data: prevLinks } = await admin
        .from("profiles")
        .select("id, student_ref")
        .in("id", [studentA.id, studentB.id]);

      try {
        const { error: seedErr } = await admin.from("students").insert([
          { id: rowA, name: "RLS Student A", student_phone: "9000000001", parent_name: "Parent A", parent_phone: "9000000011", place: "Kochi" },
          { id: rowB, name: "RLS Student B", student_phone: "9000000002", parent_name: "Parent B", parent_phone: "9000000022", place: "Thrissur", student_email: "b@example.com" },
        ]);
        assert.equal(seedErr, null, `seed students: ${seedErr?.message}`);
        for (const [pid, ref] of [[studentA.id, rowA], [studentB.id, rowB]]) {
          const { error } = await admin.from("profiles").update({ student_ref: ref }).eq("id", pid);
          assert.equal(error, null, `link profile: ${error?.message}`);
        }

        // --- Student A cannot read student B's personal fields ---
        const { data: crossRows, error: crossErr } = await studentA.client
          .from("students")
          .select("id, student_phone, student_email, parent_name, parent_phone, place")
          .eq("id", rowB);
        assert.equal(crossErr, null, crossErr?.message);
        assert.equal(crossRows.length, 0, "student A must not see student B's row");

        // --- A full-table read by student A returns only their own row ---
        const { data: allForA } = await studentA.client.from("students").select("id, student_phone");
        assert.deepEqual(allForA.map((r) => r.id), [rowA]);
        assert.equal(allForA[0].student_phone, "9000000001");

        // --- Student cannot write personal fields (insert/update are staff+) ---
        const { data: upd } = await studentA.client
          .from("students")
          .update({ parent_phone: "9999999999" })
          .eq("id", rowA)
          .select();
        assert.equal((upd ?? []).length, 0, "students must not update their own record");

        // --- Staff read both rows ---
        const { data: staffRows } = await staff.client.from("students").select("id").in("id", [rowA, rowB]);
        assert.equal(staffRows.length, 2, "staff+ must see every student row");

        // --- Faculty (optional) read none ---
        if (process.env.TEST_FACULTY_EMAIL && process.env.TEST_FACULTY_PASSWORD) {
          const faculty = await signIn(process.env.TEST_FACULTY_EMAIL, process.env.TEST_FACULTY_PASSWORD);
          const { data: facRows } = await faculty.client.from("students").select("id").in("id", [rowA, rowB]);
          assert.equal(facRows.length, 0, "faculty must not see student rows");
        }

        // --- Backend CHECK constraints reject malformed values ---
        const { error: badPhone } = await staff.client.from("students").update({ student_phone: "12345" }).eq("id", rowA);
        assert.match(badPhone?.message || "", /students_student_phone_format/);
        const { error: badEmail } = await staff.client.from("students").update({ student_email: "nope" }).eq("id", rowA);
        assert.match(badEmail?.message || "", /students_student_email_format/);
      } finally {
        for (const p of prevLinks || []) {
          await admin.from("profiles").update({ student_ref: p.student_ref }).eq("id", p.id);
        }
        await admin.from("students").delete().in("id", [rowA, rowB]);
      }
    });
  });
}
