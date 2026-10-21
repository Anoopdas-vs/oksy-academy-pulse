// Data layer for the Academy Suite (Timetable, Live Class, Assignments,
// Exams, Reviews, Notifications). Mirrors lib/data.js for the finance side.
// Every call is a thin wrapper over a Supabase query so pages stay declarative.
//
// If migration-academy-suite-v2.sql has not been run yet the underlying
// tables/relations are missing; helpers below return empty results and set a
// `.suitePending` flag on the error so pages can show a friendly notice
// instead of crashing.

import { supabase } from "./supabaseClient.js";

const PENDING_CODES = new Set(["42P01", "42703", "PGRST205", "PGRST200"]);

function soft(error) {
  if (!error) return null;
  const pending = PENDING_CODES.has(error.code) || /does not exist/i.test(error.message || "");
  return { message: error.message, code: error.code, suitePending: pending };
}

// ---------------------------------------------------------------- Timetable ---

export async function fetchTimetable() {
  const { data, error } = await supabase
    .from("timetable_slots")
    .select("*")
    .order("day_of_week")
    .order("starts_at");
  return { rows: data || [], error: soft(error) };
}

export async function saveTimetableSlot(slot) {
  const { data, error } = await supabase
    .from("timetable_slots")
    .upsert(slot, { onConflict: "id" })
    .select()
    .single();
  return { row: data, error: soft(error) };
}

export async function deleteTimetableSlot(id) {
  const { error } = await supabase.from("timetable_slots").delete().eq("id", id);
  return { error: soft(error) };
}

// ------------------------------------------------------------- Live sessions ---

export async function startLiveSession(slotId, hostId) {
  const { data, error } = await supabase
    .from("live_sessions")
    .insert({ slot_id: slotId, host_id: hostId })
    .select()
    .single();
  return { row: data, error: soft(error) };
}

export async function endLiveSession(id) {
  const { error } = await supabase
    .from("live_sessions")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", id);
  return { error: soft(error) };
}

export async function fetchLiveSessions() {
  const { data, error } = await supabase
    .from("live_sessions")
    .select("*, slot:timetable_slots(*)")
    .order("started_at", { ascending: false });
  return { rows: data || [], error: soft(error) };
}

export async function joinLiveSession(sessionId, studentId) {
  const { error } = await supabase
    .from("attendance")
    .upsert({ session_id: sessionId, student_id: studentId }, { onConflict: "session_id,student_id" });
  return { error: soft(error) };
}

export async function fetchAttendance(sessionId) {
  const { data, error } = await supabase
    .from("attendance")
    .select("*, student:profiles(full_name,email)")
    .eq("session_id", sessionId);
  return { rows: data || [], error: soft(error) };
}

export async function fetchAllAttendance() {
  const { data, error } = await supabase.from("attendance").select("session_id, student_id, present");
  return { rows: data || [], error: soft(error) };
}

// -------------------------------------------------------------- Assignments ---

export async function fetchAssignments() {
  const { data, error } = await supabase
    .from("assignments")
    .select("*")
    .order("created_at", { ascending: false });
  return { rows: data || [], error: soft(error) };
}

export async function saveAssignment(a) {
  const { data, error } = await supabase
    .from("assignments")
    .upsert({ ...a, updated_at: new Date().toISOString() }, { onConflict: "id" })
    .select()
    .single();
  return { row: data, error: soft(error) };
}

export async function deleteAssignment(id) {
  const { error } = await supabase.from("assignments").delete().eq("id", id);
  return { error: soft(error) };
}

export async function fetchSubmissions(assignmentIds) {
  let q = supabase
    .from("assignment_submissions")
    // Two FKs point at profiles (student_id, graded_by); name the one we want.
    .select("*, student:profiles!assignment_submissions_student_id_fkey(full_name,email)");
  if (assignmentIds?.length) q = q.in("assignment_id", assignmentIds);
  const { data, error } = await q;
  return { rows: data || [], error: soft(error) };
}

// First submission is a direct insert (governed by the "sub_student_insert"
// RLS policy). Resubmitting an existing, not-yet-graded row goes through the
// "resubmit_assignment" RPC instead of a direct update — students no longer
// hold an UPDATE grant on assignment_submissions at all (see
// supabase/11_assignment_resubmit_guard.sql), so a raw conflict-triggered
// upsert can't work here; the unique-violation on retry is what selects the
// RPC path.
export async function submitAssignment(assignmentId, studentId, { link, notes, isLate, filePath }) {
  const { data, error } = await supabase
    .from("assignment_submissions")
    .insert({
      assignment_id: assignmentId,
      student_id: studentId,
      link,
      notes,
      file_path: filePath ?? null,
      is_late: !!isLate,
      submitted_at: new Date().toISOString(),
      status: "submitted",
    })
    .select()
    .single();

  if (!error) return { row: data, error: null };
  if (error.code !== "23505") return { row: null, error: soft(error) };

  const { data: rpcRow, error: rpcError } = await supabase.rpc("resubmit_assignment", {
    p_assignment_id: assignmentId,
    p_link: link,
    p_notes: notes,
    p_file_path: filePath ?? null,
    p_is_late: !!isLate,
  });
  return { row: rpcRow, error: soft(rpcError) };
}

// Upload a submission file to the private `submissions` bucket. Returns its
// storage path (store on assignment_submissions.file_path).
export async function uploadSubmissionFile(assignmentId, studentId, file) {
  const safe = file.name.replace(/[^\w.-]+/g, "_");
  const path = `${assignmentId}/${studentId}/${Date.now()}_${safe}`;
  const { error } = await supabase.storage
    .from("submissions")
    .upload(path, file, { upsert: true });
  return { path, error: soft(error) };
}

export async function signedSubmissionUrl(path, expiresIn = 300) {
  if (!path) return { url: null, error: null };
  const { data, error } = await supabase.storage
    .from("submissions")
    .createSignedUrl(path, expiresIn);
  return { url: data?.signedUrl || null, error: soft(error) };
}

export async function gradeSubmission(id, { marks, feedback, graderId }) {
  const { data, error } = await supabase
    .from("assignment_submissions")
    .update({
      marks,
      feedback,
      status: "graded",
      graded_by: graderId,
      graded_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();
  return { row: data, error: soft(error) };
}

// --------------------------------------------------------------------- Exams ---

export async function fetchExams() {
  const { data, error } = await supabase
    .from("exams")
    .select("*")
    .order("created_at", { ascending: false });
  return { rows: data || [], error: soft(error) };
}

export async function saveExam(e) {
  const { data, error } = await supabase
    .from("exams")
    .upsert(e, { onConflict: "id" })
    .select()
    .single();
  return { row: data, error: soft(error) };
}

export async function deleteExam(id) {
  const { error } = await supabase.from("exams").delete().eq("id", id);
  return { error: soft(error) };
}

// Manager view — includes correct_index for editing/evaluation.
export async function fetchExamQuestions(examId) {
  const { data, error } = await supabase
    .from("exam_questions")
    .select("*")
    .eq("exam_id", examId)
    .order("position");
  return { rows: data || [], error: soft(error) };
}

// Student view — no answer key.
export async function fetchExamQuestionsForStudent(examId) {
  const { data, error } = await supabase
    .from("exam_questions_public")
    .select("*")
    .eq("exam_id", examId)
    .order("position");
  return { rows: data || [], error: soft(error) };
}

export async function saveExamQuestions(examId, questions) {
  await supabase.from("exam_questions").delete().eq("exam_id", examId);
  const payload = questions.map((q, i) => ({
    exam_id: examId,
    position: i + 1,
    question: q.question,
    options: q.options,
    correct_index: q.correctIndex ?? q.correct_index ?? 0,
    marks: q.marks || 1,
  }));
  const { error } = await supabase.from("exam_questions").insert(payload);
  return { error: soft(error) };
}

export async function startExamAttempt(examId, studentId) {
  const { data, error } = await supabase
    .from("exam_attempts")
    .upsert({ exam_id: examId, student_id: studentId }, { onConflict: "exam_id,student_id" })
    .select()
    .single();
  return { row: data, error: soft(error) };
}

export async function saveExamAnswer(attemptId, questionId, chosenIndex) {
  const { error } = await supabase
    .from("exam_answers")
    .upsert(
      { attempt_id: attemptId, question_id: questionId, chosen_index: chosenIndex },
      { onConflict: "attempt_id,question_id" }
    );
  return { error: soft(error) };
}

export async function submitExamAttempt(attemptId) {
  const { data, error } = await supabase.rpc("score_exam_attempt", { p_attempt: attemptId });
  return { row: data, error: soft(error) };
}

export async function fetchExamAttempts(examId) {
  const { data, error } = await supabase
    .from("exam_attempts")
    .select("*, student:profiles(full_name,email)")
    .eq("exam_id", examId);
  return { rows: data || [], error: soft(error) };
}

export async function fetchAllExamAttempts() {
  const { data, error } = await supabase.from("exam_attempts").select("*");
  return { rows: data || [], error: soft(error) };
}

// Saved answers for an in-progress attempt — used to resume after a refresh.
export async function fetchExamAnswers(attemptId) {
  const { data, error } = await supabase
    .from("exam_answers")
    .select("*")
    .eq("attempt_id", attemptId);
  return { rows: data || [], error: soft(error) };
}

export async function fetchMyExamAttempts(studentId) {
  const { data, error } = await supabase
    .from("exam_attempts")
    .select("*")
    .eq("student_id", studentId);
  return { rows: data || [], error: soft(error) };
}

// ------------------------------------------------------------------- Reviews ---

export async function fetchFacultyReviews() {
  const { data, error } = await supabase
    .from("faculty_reviews")
    .select("*")
    .order("created_at", { ascending: false });
  return { rows: data || [], error: soft(error) };
}

export async function submitFacultyReview(review) {
  const { data, error } = await supabase
    .from("faculty_reviews")
    .insert(review)
    .select()
    .single();
  return { row: data, error: soft(error) };
}

// ----------------------------------------------------- Executive analytics ---

// One round of parallel reads → the numbers the Executive dashboard shows.
// Any table still missing (migration not run) is treated as empty.
export async function fetchAcademySnapshot() {
  const [asg, subs, exams, attempts, att, reviews] = await Promise.all([
    fetchAssignments(),
    fetchSubmissions(),
    fetchExams(),
    fetchAllExamAttempts(),
    fetchAllAttendance(),
    fetchFacultyReviews(),
  ]);
  if (asg.error?.suitePending) return { pending: true, stats: null };

  const submissions = subs.rows || [];
  const graded = submissions.filter((s) => s.status === "graded");
  const attList = att.rows || [];
  const present = attList.filter((a) => a.present).length;
  const done = (attempts.rows || []).filter((a) => a.submitted_at);
  const passed = done.filter((a) => a.passed).length;
  const rv = reviews.rows || [];
  const avgRating = rv.length
    ? rv.reduce((s, r) => s + Number(r.rating || 0), 0) / rv.length
    : 0;

  return {
    pending: false,
    stats: {
      assignments: (asg.rows || []).length,
      published: (asg.rows || []).filter((a) => a.status === "published").length,
      submissions: submissions.length,
      gradingPct: submissions.length ? Math.round((graded.length / submissions.length) * 100) : 0,
      exams: (exams.rows || []).length,
      examAttempts: done.length,
      passPct: done.length ? Math.round((passed / done.length) * 100) : 0,
      attendancePct: attList.length ? Math.round((present / attList.length) * 100) : 0,
      reviews: rv.length,
      avgRating: Math.round(avgRating * 10) / 10,
    },
  };
}

// ------------------------------------------------------------- Notifications ---

export async function fetchNotifications(limit = 30) {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  return { rows: data || [], error: soft(error) };
}

export async function markNotificationRead(id) {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id);
  return { error: soft(error) };
}

export async function markAllNotificationsRead() {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);
  return { error: soft(error) };
}

// Fan a notification out to every student in a batch (server-side function).
export async function notifyBatch(batchName, { type, title, body, link }) {
  const { data, error } = await supabase.rpc("notify_batch", {
    p_batch: batchName,
    p_type: type,
    p_title: title,
    p_body: body || null,
    p_link: link || null,
  });
  return { count: data ?? 0, error: soft(error) };
}

// --------------------------------------------------------- Roster / batches ---

// Faculty ↔ batch assignments (for scheduling and "my batches").
export async function fetchFacultyBatches() {
  const { data, error } = await supabase.from("faculty_batches").select("*");
  return { rows: data || [], error: soft(error) };
}

export async function setFacultyBatches(facultyId, batchNames) {
  await supabase.from("faculty_batches").delete().eq("faculty_id", facultyId);
  if (!batchNames.length) return { error: null };
  const { error } = await supabase
    .from("faculty_batches")
    .insert(batchNames.map((b) => ({ faculty_id: facultyId, batch_name: b })));
  return { error: soft(error) };
}

// Approved faculty logins, for the "assign faculty" pickers.
export async function fetchFacultyProfiles() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .eq("role", "faculty")
    .eq("is_approved", true);
  return { rows: data || [], error: soft(error) };
}
