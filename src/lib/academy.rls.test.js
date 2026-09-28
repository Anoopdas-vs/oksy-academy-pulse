// Integration tests for the H-2 fix (assignment self-grading column gap —
// see docs/audits/02-security-audit.md and
// docs/claude-project/audits/03b-crit1-h2-fix-plan.md §2/§3.2).
//
// These hit a REAL Supabase project over the network and cannot run inside
// `node --test src/lib/*.test.js` the way fees.test.js/reconcile.test.js do
// (no Supabase connection is available in this repo's default test setup —
// see 03b §3.2's "infrastructure gap" note). They are written to be
// ready-to-run against a disposable/staging Supabase project — never
// production — and SKIP with a clear console message (not fail) if the
// required env vars aren't set, so `npm test` stays green with no
// connection configured.
//
// Required env vars (set these to point at a disposable/staging project —
// never a production database):
//   TEST_SUPABASE_URL            - the staging project's API URL
//   TEST_SUPABASE_ANON_KEY       - its anon/public key
//   TEST_SUPABASE_SERVICE_KEY    - its service_role key (used only to seed
//                                  and tear down fixtures; never used to
//                                  perform the actual assertions, which all
//                                  run as a real authenticated student/
//                                  grader session so RLS is genuinely
//                                  exercised)
//   TEST_STUDENT_A_EMAIL / TEST_STUDENT_A_PASSWORD
//     - a real login with role = 'student' (owns the submission under test)
//   TEST_STUDENT_B_EMAIL / TEST_STUDENT_B_PASSWORD
//     - a second, different student login (used for the "someone else's
//       row" negative case)
//   TEST_GRADER_EMAIL / TEST_GRADER_PASSWORD
//     - a login with role 'staff', 'admin', or 'super_admin' (so
//       is_staff_or_admin() is true and it can grade via sub_grader_update)
//
// Run with all nine set, e.g.:
//   TEST_SUPABASE_URL=https://xxxx.supabase.co \
//   TEST_SUPABASE_ANON_KEY=... TEST_SUPABASE_SERVICE_KEY=... \
//   TEST_STUDENT_A_EMAIL=a@test TEST_STUDENT_A_PASSWORD=... \
//   TEST_STUDENT_B_EMAIL=b@test TEST_STUDENT_B_PASSWORD=... \
//   TEST_GRADER_EMAIL=g@test TEST_GRADER_PASSWORD=... \
//   node --test src/lib/academy.rls.test.js

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
  describe("H-2 assignment_submissions grading-column guard (live Supabase)", () => {
    test("skipped: no test Supabase connection configured", (t) => {
      console.log(
        `[academy.rls.test.js] Skipping — missing env var(s): ${missing.join(", ")}. ` +
          "These tests need a disposable/staging Supabase project (never production); " +
          "see the file header for the full list and an example invocation, or run the " +
          "manual verification steps in the PR description instead."
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

  describe("H-2 assignment_submissions grading-column guard (live Supabase)", () => {
    test("full checklist: resubmit RPC, raw PATCH bypass, grader path, already-graded guard", async () => {
      // Must satisfy the batch-name rule (migration 25): ^[A-Z0-9]+$.
      const batchName = `H2TEST${Date.now()}`;
      let assignmentId;

      const studentA = await signIn(process.env.TEST_STUDENT_A_EMAIL, process.env.TEST_STUDENT_A_PASSWORD);
      const studentB = await signIn(process.env.TEST_STUDENT_B_EMAIL, process.env.TEST_STUDENT_B_PASSWORD);
      const grader = await signIn(process.env.TEST_GRADER_EMAIL, process.env.TEST_GRADER_PASSWORD);

      try {
        // --- Fixtures (service role) ---
        const { error: batchErr } = await admin
          .from("batches")
          .insert({ name: batchName, course_name: "H2 test", course_fee: 0 });
        assert.equal(batchErr, null, `seed batch: ${batchErr?.message}`);

        const { error: profErr } = await admin
          .from("profiles")
          .update({ batch_name: batchName })
          .eq("id", studentA.id);
        assert.equal(profErr, null, `assign student A to batch: ${profErr?.message}`);

        const { data: asg, error: asgErr } = await admin
          .from("assignments")
          .insert({ batch_name: batchName, title: "H2 test assignment", status: "published" })
          .select()
          .single();
        assert.equal(asgErr, null, `seed assignment: ${asgErr?.message}`);
        assignmentId = asg.id;

        // --- 1. First submission (direct insert, sub_student_insert) ---
        const { data: firstSub, error: firstErr } = await studentA.client
          .from("assignment_submissions")
          .insert({
            assignment_id: assignmentId,
            student_id: studentA.id,
            link: "https://example.com/v1",
            status: "submitted",
          })
          .select()
          .single();
        assert.equal(firstErr, null, `first submission should succeed: ${firstErr?.message}`);
        assert.equal(firstSub.status, "submitted");

        // --- 2. Raw PATCH bypass attempt: student directly UPDATEs marks ---
        // sub_student_update no longer exists, so this must touch 0 rows.
        const { data: bypassRows, error: bypassErr } = await studentA.client
          .from("assignment_submissions")
          .update({ marks: 100, feedback: "self-graded" })
          .eq("id", firstSub.id)
          .select();
        assert.ok(
          bypassErr !== null || (bypassRows ?? []).length === 0,
          "raw PATCH of marks/feedback by the owning student must be denied or affect 0 rows"
        );
        const { data: afterBypass } = await admin
          .from("assignment_submissions")
          .select("marks, feedback")
          .eq("id", firstSub.id)
          .single();
        assert.equal(afterBypass.marks, null, "marks must still be unset after the bypass attempt");
        assert.equal(afterBypass.feedback, null, "feedback must still be unset after the bypass attempt");

        // --- 3. resubmit_assignment as the owning student: succeeds ---
        const { data: resub, error: resubErr } = await studentA.client.rpc("resubmit_assignment", {
          p_assignment_id: assignmentId,
          p_link: "https://example.com/v2",
          p_notes: "updated notes",
          p_file_path: null,
          p_is_late: false,
        });
        assert.equal(resubErr, null, `resubmit as owner should succeed: ${resubErr?.message}`);
        assert.equal(resub.link, "https://example.com/v2");
        assert.equal(resub.marks, null, "resubmit must never touch marks");
        assert.equal(resub.feedback, null, "resubmit must never touch feedback");

        // --- 4. resubmit_assignment as a different student: fails ---
        await assert.rejects(
          () =>
            studentB.client
              .rpc("resubmit_assignment", {
                p_assignment_id: assignmentId,
                p_link: "https://example.com/hijack",
                p_notes: null,
                p_file_path: null,
                p_is_late: false,
              })
              .then(({ error }) => {
                if (error) throw new Error(error.message);
              }),
          /no editable submission found/,
          "resubmit as a non-owning student must be rejected"
        );

        // --- 5. Grader path (sub_grader_update) still works ---
        const { data: graded, error: gradeErr } = await grader.client
          .from("assignment_submissions")
          .update({
            marks: 90,
            feedback: "nice work",
            status: "graded",
            graded_by: grader.id,
            graded_at: new Date().toISOString(),
          })
          .eq("id", firstSub.id)
          .select()
          .single();
        assert.equal(gradeErr, null, `grader update should succeed: ${gradeErr?.message}`);
        assert.equal(graded.status, "graded");
        assert.equal(graded.marks, 90);

        // --- 6. resubmit on an already-graded row: fails ---
        await assert.rejects(
          () =>
            studentA.client
              .rpc("resubmit_assignment", {
                p_assignment_id: assignmentId,
                p_link: "https://example.com/v3",
                p_notes: null,
                p_file_path: null,
                p_is_late: false,
              })
              .then(({ error }) => {
                if (error) throw new Error(error.message);
              }),
          /no editable submission found/,
          "resubmit on an already-graded row must be rejected"
        );
      } finally {
        // --- Cleanup (service role) ---
        if (assignmentId) {
          await admin.from("assignment_submissions").delete().eq("assignment_id", assignmentId);
          await admin.from("assignments").delete().eq("id", assignmentId);
        }
        await admin.from("profiles").update({ batch_name: null }).eq("id", studentA.id);
        await admin.from("batches").delete().eq("name", batchName);
      }
    });
  });
}
