// Student status follows batch start/end dates (migrations 28 / 28b).
//
// A pure JS mirror of the SQL rule batch_status_for(): the database is the
// authority (triggers + nightly job); this exists so the rule is unit-testable
// and documented next to the code that shows it. Dates are 'YYYY-MM-DD'
// strings, compared in the India calendar (Asia/Kolkata), never UTC.

const IST_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// Today's India date as 'YYYY-MM-DD' for an instant (default: now).
export function istToday(now = new Date()) {
  return IST_DATE.format(now);
}

// The status a student SHOULD have on `today` (IST date). Returns the input
// status unchanged when the rule does not apply.
//   today <  start                        -> Registered
//   start <= today < end (or no end)      -> Active
//   today >= end                          -> Completed   (the end day itself)
// Never changed: Dropped; a batch with no start date; a batch with
// end < start (bad data); a Completed student in a batch with no end date.
export function batchStatusFor(status, batch, today) {
  if (status === "Dropped" || !batch || !batch.start_date) return status;
  const { start_date: start, end_date: end } = batch;
  if (end && end < start) return status;
  if (!end && status === "Completed") return status;
  if (end && today >= end) return "Completed";
  if (today < start) return "Registered";
  return "Active";
}

const RANK = { Registered: 1, Active: 2, Completed: 3 };

// Rows the dry run / run would produce, mirroring preview_batch_status_changes().
export function planStatusChanges(students, batches, today) {
  const byName = new Map(batches.map((b) => [b.name, b]));
  const out = [];
  for (const s of students) {
    const to = batchStatusFor(s.status, byName.get(s.batch), today);
    if (to !== s.status) {
      out.push({
        student_id: s.id,
        batch: s.batch,
        old_status: s.status,
        new_status: to,
        is_revert: RANK[to] < RANK[s.status],
      });
    }
  }
  return out.sort((a, b) => a.batch.localeCompare(b.batch) || a.student_id.localeCompare(b.student_id));
}

// Label for the Admin -> Batches list. No new rule: it asks batchStatusFor()
// what an Active student of this batch would become today (Registered /
// Active / Completed) and renames that for the batch itself. end < start is
// the "Date issue" that batch_status_data_issues() reports; no start date
// means the rule doesn't apply (null -> shown as "—").
export const BATCH_STATUS_LABEL = { Registered: "Upcoming", Active: "Running", Completed: "Completed" };

export function batchDisplayStatus(batch, today) {
  if (!batch || !batch.start_date) return null;
  if (batch.end_date && batch.end_date < batch.start_date) return "Date issue";
  return BATCH_STATUS_LABEL[batchStatusFor("Active", batch, today)] ?? null;
}
