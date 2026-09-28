import { supabase } from "./supabaseClient.js";

// -------- Students --------

export async function fetchStudents() {
  const { data, error } = await supabase
    .from("students")
    .select("*")
    .order("enrollment_date", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function upsertStudent(student, userId) {
  const payload = {
    ...student,
    updated_at: new Date().toISOString(),
    updated_by: userId,
  };

  const { error } = await supabase.from("students").upsert(payload, {
    onConflict: "id",
  });
  if (error) throw error;
}

export async function insertNewStudent(student, userId) {
  const payload = {
    ...student,
    created_by: userId,
    updated_by: userId,
  };
  const { error } = await supabase.from("students").insert(payload);
  if (error) throw error;
}

export async function bulkUpsertStudents(students, userId) {
  const payload = students.map((s) => ({
    ...s,
    created_by: userId,
    updated_by: userId,
  }));
  const { error } = await supabase
    .from("students")
    .upsert(payload, { onConflict: "id" });
  if (error) throw error;
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
