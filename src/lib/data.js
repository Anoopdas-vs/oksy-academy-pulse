import { supabase } from "./supabaseClient.js";
import { isLinkConflict, LINK_CONFLICT_MESSAGE } from "./reconcile.js";

// -------- Students --------

export async function fetchStudents() {
  const { data, error } = await supabase
    .from("students")
    .select("*")
    .order("enrollment_date", { ascending: false });
  if (error) throw error;
  return data || [];
}

// Edits an existing student. `id` is never sent: Student IDs are immutable
// (migration 26 trigger), and an upsert with a changed id would have
// silently created a second student.
export async function updateStudent(id, student, userId) {
  const fields = { ...student };
  delete fields.id;
  delete fields.created_at;
  delete fields.created_by;
  const { error } = await supabase
    .from("students")
    .update({ ...fields, updated_at: new Date().toISOString(), updated_by: userId })
    .eq("id", id);
  if (error) throw error;
}

// New enrolment. The database allocates the Student ID (course code +
// next number, under a per-prefix lock) and returns it — see migration 26.
export async function enrollStudent(student) {
  const fields = { ...student };
  delete fields.id;
  const { data, error } = await supabase.rpc("enroll_student", { p_student: fields });
  if (error) throw error;
  return data;
}

// The ID the next enrolment into `batch` would get. Preview only — the final
// ID is allocated at save and can differ if someone enrols first.
export async function previewStudentId(batch) {
  const { data, error } = await supabase.rpc("preview_student_id", { p_batch: batch });
  if (error) throw error;
  return data;
}

// Owner/Admin only; the RPC refuses unless the student is Registered and has
// no receipts or linked login.
export async function deleteMistakenStudent(id) {
  const { error } = await supabase.rpc("delete_mistaken_student", { p_id: id });
  if (error) throw error;
}

// Owner/Admin only (enforced inside the RPC, migration 27). One transaction:
// with dryRun the database validates and returns the preview without writing;
// otherwise every row is applied or none is. `rows` are studentBulk.js records.
export async function bulkUpsertStudents(rows, { dryRun = true, confirmBlanks = false } = {}) {
  const { data, error } = await supabase.rpc("bulk_upsert_students", {
    p_rows: rows,
    p_dry_run: dryRun,
    p_confirm_blanks: confirmBlanks,
  });
  if (error) throw error;
  return data;
}

// Owner/Admin only (enforced inside both RPCs, migration 28).
// Read-only dry run, reverts included:
// [{ student_id, student_name, batch, old_status, new_status, batch_start, batch_end, is_revert }].
export async function previewBatchStatusChanges() {
  const { data, error } = await supabase.rpc("preview_batch_status_changes");
  if (error) throw error;
  return data || [];
}

// Batches whose end date is before their start date (skipped by the rule).
export async function batchStatusDataIssues() {
  const { data, error } = await supabase.rpc("batch_status_data_issues");
  if (error) throw error;
  return data || [];
}

// Re-syncs every student's status with today's (IST) batch dates.
// Returns { run_date, to_registered, to_active, to_completed, total }.
export async function runBatchStatusAutomation() {
  const { data, error } = await supabase.rpc("run_batch_status_automation");
  if (error) throw error;
  return data;
}

// -------- Fee collections --------

// Always read the masked view, never the base table: collections_basic
// decides server-side (via can_view_financials()) whether to reveal the
// real `account` value for the querying user, so the frontend doesn't need
// to — and, as of migration 06, the base table's own SELECT grant has been
// revoked for `authenticated`, so querying it directly would fail anyway.
export async function fetchCollections() {
  const { data, error } = await supabase
    .from("collections_basic")
    .select("*")
    .order("date", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function insertCollection(collection, userId) {
  // Only `id` is requested back (for the receipt number): the base table's
  // SELECT grant for `authenticated` covers just that one column (see
  // migration 06), so a bare `.select()` here would fail.
  const { data, error } = await supabase
    .from("collections")
    .insert({ ...collection, created_by: userId })
    .select("id")
    .single();
  if (error) throw error;
  return data;
}

// -------- Expenses (confidential) --------

export async function fetchExpenses() {
  const { data, error } = await supabase
    .from("expenses")
    .select("*")
    .order("date", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function insertExpense(expense, userId) {
  const { data, error } = await supabase
    .from("expenses")
    .insert({ ...expense, created_by: userId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function bulkInsertExpenses(expenses, userId) {
  const payload = expenses.map((e) => ({ ...e, created_by: userId }));
  const { error } = await supabase.from("expenses").insert(payload);
  if (error) throw error;
}

export async function updateExpense(id, patch, userId) {
  const { error } = await supabase
    .from("expenses")
    .update({ ...patch, updated_at: new Date().toISOString(), updated_by: userId })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteExpense(id) {
  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) throw error;
}

export async function bulkInsertCollections(collections, userId) {
  const payload = collections.map((c) => ({ ...c, created_by: userId }));
  const { error } = await supabase.from("collections").insert(payload);
  if (error) throw error;
}

export async function updateCollection(id, patch) {
  const { error } = await supabase.from("collections").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteCollection(id) {
  const { error } = await supabase.from("collections").delete().eq("id", id);
  if (error) throw error;
}

// -------- Transfers (money moved between accounts — not income/expense) --------

export async function fetchTransfers() {
  const { data, error } = await supabase
    .from("transfers")
    .select("*")
    .order("date", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function insertTransfer(transfer, userId) {
  const { data, error } = await supabase
    .from("transfers")
    .insert({ ...transfer, created_by: userId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function bulkInsertTransfers(transfers, userId) {
  const payload = transfers.map((t) => ({ ...t, created_by: userId }));
  const { error } = await supabase.from("transfers").insert(payload);
  if (error) throw error;
}

export async function updateTransfer(id, patch) {
  const { error } = await supabase.from("transfers").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteTransfer(id) {
  const { error } = await supabase.from("transfers").delete().eq("id", id);
  if (error) throw error;
}

// -------- Batches --------

export async function fetchBatches() {
  const { data, error } = await supabase
    .from("batches")
    .select("*")
    .order("start_date", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function insertBatch(batch, userId) {
  const { error } = await supabase.from("batches").insert({ ...batch, created_by: userId });
  if (error) throw error;
}

export async function updateBatch(id, patch) {
  const { error } = await supabase.from("batches").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteBatch(id) {
  const { error } = await supabase.from("batches").delete().eq("id", id);
  if (error) throw error;
}

// -------- Courses (migration 23) --------

export async function fetchCourses() {
  const { data, error } = await supabase
    .from("courses")
    .select("*")
    .order("code", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function insertCourse(course, userId) {
  const { error } = await supabase.from("courses").insert({ ...course, created_by: userId });
  if (error) throw error;
}

export async function updateCourse(id, patch) {
  const { error } = await supabase
    .from("courses")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteCourse(id) {
  const { error } = await supabase.from("courses").delete().eq("id", id);
  if (error) throw error;
}

// -------- Expense categories --------

export async function fetchExpenseCategories() {
  const { data, error } = await supabase
    .from("expense_categories")
    .select("*")
    .order("name", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function insertExpenseCategory(name, userId) {
  const { error } = await supabase
    .from("expense_categories")
    .insert({ name: name.trim(), created_by: userId });
  if (error) throw error;
}

export async function renameExpenseCategory(id, name) {
  const { error } = await supabase
    .from("expense_categories")
    .update({ name: name.trim() })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteExpenseCategory(id) {
  const { error } = await supabase.from("expense_categories").delete().eq("id", id);
  if (error) throw error;
}

// Merge `fromName` into `toName`: repoint every expense, then drop the old row.
export async function mergeExpenseCategory(fromId, fromName, toName) {
  const { error: upErr } = await supabase
    .from("expenses")
    .update({ category: toName })
    .eq("category", fromName);
  if (upErr) throw upErr;
  const { error: delErr } = await supabase
    .from("expense_categories")
    .delete()
    .eq("id", fromId);
  if (delErr) throw delErr;
}

// -------- Staff / management users (via the create-user Edge Function) --------

export async function createStaffUser(payload) {
  const { data, error } = await supabase.functions.invoke("create-user", { body: payload });
  if (error) {
    // FunctionsHttpError: the function ran and returned a non-2xx response —
    // its JSON body (set by the function's own `json({ error: ... })` helper)
    // has the real, specific reason (e.g. "Only the Owner can create logins.").
    if (error.name === "FunctionsHttpError") {
      let msg = error.message || "Could not create the user.";
      try {
        const body = await error.context?.json?.();
        if (body?.error) msg = body.error;
      } catch {
        /* keep msg */
      }
      throw new Error(msg);
    }
    // FunctionsFetchError / FunctionsRelayError: the request never got a
    // response from the function at all — almost always means create-user
    // hasn't been deployed to this Supabase project yet (or the project is
    // paused). Surface that specifically instead of a generic network
    // error, since this is the one case the admin can actually act on.
    throw new Error(
      "Couldn't reach the create-user function. It may not be deployed to " +
      "this Supabase project yet — see supabase/functions/create-user, or " +
      "ask whoever manages the project to check."
    );
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// -------- Bank reconciliation --------

export async function fetchBankStatements() {
  const { data, error } = await supabase
    .from("bank_statements")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function fetchBankStatementLines() {
  const { data, error } = await supabase
    .from("bank_statement_lines")
    .select("*")
    .order("txn_date", { ascending: true });
  if (error) throw error;
  return data || [];
}

// Creates the statement row, then all its lines. Returns the statement id.
export async function createBankStatement(statement, lines, userId) {
  const { data, error } = await supabase
    .from("bank_statements")
    .insert({ ...statement, created_by: userId })
    .select()
    .single();
  if (error) throw error;

  if (lines.length) {
    const payload = lines.map((l) => ({
      ...l,
      statement_id: data.id,
      account: statement.account,
      created_by: userId,
    }));
    const { error: lineErr } = await supabase.from("bank_statement_lines").insert(payload);
    if (lineErr) throw lineErr;
  }
  return data.id;
}

export async function updateBankStatementLine(id, patch) {
  const { error } = await supabase
    .from("bank_statement_lines")
    .update(patch)
    .eq("id", id);
  if (error) throw error;
}

// Same as updateBankStatementLine, but the row is only updated while it is
// still 'review' or 'unmatched' -- the database-side guard behind "Re-run
// auto-match", so a line someone matched in the meantime is never overridden.
// Resolves to true if the row was updated, false if it was skipped.
export async function updateBankStatementLineIfOpen(id, patch) {
  const { data, error } = await supabase
    .from("bank_statement_lines")
    .update(patch)
    .eq("id", id)
    .in("status", ["review", "unmatched"])
    .select("id");
  if (error) throw error;
  return (data || []).length > 0;
}

// -------- Bank match links (bank_match_links, migration 32) --------
// One bank line -> many book entries; a book entry -> only one bank line.
// During rollout every write is mirrored into bank_statement_lines
// (status + match_kind/match_id = first link) so the older page logic keeps
// working. Reads prefer the link rows (see attachLinks in reconcile.js).

// Links for one statement, or for every statement when `statementId` is null.
export async function fetchMatchLinks(statementId = null) {
  let query = supabase
    .from("bank_match_links")
    .select("id, line_id, book_kind, book_id, source, bank_statement_lines!inner(statement_id)");
  if (statementId != null) query = query.eq("bank_statement_lines.statement_id", statementId);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(({ bank_statement_lines: _join, ...row }) => row);
}

// id + seq of a statement's stored lines, to pair upload results with ids.
export async function fetchStatementLineIds(statementId) {
  const { data, error } = await supabase
    .from("bank_statement_lines")
    .select("id, seq")
    .eq("statement_id", statementId);
  if (error) throw error;
  return data || [];
}

// Replace the links of one line with `links` ([{ bookKind, bookId, source? }])
// in ONE database transaction (RPC, migration 34), which also mirrors the
// first link into the line and stamps matched_at / matched_by (auth.uid()).
// `status` is 'matched' for matches and 'classified' for lines that created
// their own record. `userId` is accepted for older callers and ignored.
export async function saveMatchLinks(lineId, links, source = "manual", { status = "matched" } = {}) {
  const { error } = await supabase.rpc("save_bank_match_links", {
    p_line_id: lineId,
    p_links: links.map((k) => ({ book_kind: k.bookKind, book_id: k.bookId, source: k.source || source })),
    p_source: source,
    p_status: status,
  });
  if (error) throw isLinkConflict(error) ? new Error(LINK_CONFLICT_MESSAGE) : error;
}

// Remove every link of a line and clear the mirrored columns (RPC). `status`
// is the line's new status ('unmatched' for Unmatch, 'ignored' for Ignore).
export async function removeMatchLinks(lineId, { status = "unmatched" } = {}) {
  const { error } = await supabase.rpc("remove_bank_match_links", { p_line_id: lineId, p_status: status });
  if (error) throw error;
}

export async function deleteBankStatement(id) {
  const { error } = await supabase.from("bank_statements").delete().eq("id", id);
  if (error) throw error;
}

// -------- App settings (super admin only for writes) --------

export async function fetchAppSettings() {
  const { data, error } = await supabase
    .from("app_settings")
    .select("data")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  return data?.data || {};
}

export async function updateAppSettings(nextData, userId) {
  const { error } = await supabase
    .from("app_settings")
    .update({ data: nextData, updated_at: new Date().toISOString(), updated_by: userId })
    .eq("id", 1);
  if (error) throw error;
}
