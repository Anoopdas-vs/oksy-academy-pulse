import React, { useState } from "react";
import { ErrorBanner } from "./ui.jsx";
import { previewBatchStatusChanges, runBatchStatusAutomation, batchStatusDataIssues } from "../lib/data.js";
import { friendlyError } from "../lib/validation.js";

// Admin -> Auto status. Shows the dry-run list from
// preview_batch_status_changes() (forward changes and reverts) and lets an
// Owner/Admin run the same rules now. Database triggers apply the rule on every
// batch-date / enrolment edit and a nightly job (02:30 IST) is the backup; all
// RPCs re-check the caller in the database, so this tab is a convenience, not
// the security.
export default function BatchStatusAutomation() {
  const [rows, setRows] = useState(null);
  const [issues, setIssues] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const preview = async () => {
    setBusy(true); setError(""); setMsg("");
    try {
      const [changes, bad] = await Promise.all([previewBatchStatusChanges(), batchStatusDataIssues()]);
      setRows(changes);
      setIssues(bad);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!rows?.length) return;
    if (!window.confirm(`Change the status of ${rows.length} student(s) now, including ${rows.filter((r) => r.is_revert).length} revert(s)? This cannot be undone automatically.`)) return;
    setBusy(true); setError(""); setMsg("");
    try {
      const r = await runBatchStatusAutomation();
      setMsg(`Done (${r.run_date}): ${r.to_registered} set to Registered, ${r.to_active} to Active, ${r.to_completed} to Completed.`);
      setRows(await previewBatchStatusChanges());
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="form-card">
      <h3>Automatic student status</h3>
      <p className="muted">
        A student's status follows the batch dates (India time): before the start date Registered, from the start
        date Active, and Completed on the end date itself. It works in both directions, so an extended end date or
        a later start date puts students back. It is applied instantly when a batch date or a student's batch/status
        is edited, and every night at 02:30 IST as a backup. Dropped students, batches without a start date and
        Completed students in batches with no end date are never changed.
      </p>
      <ErrorBanner error={error} />
      {msg && <div className="auth-message notice">{msg}</div>}
      <div className="page-actions">
        <button className="button" type="button" onClick={preview} disabled={busy}>
          {busy ? "Working..." : "Preview changes"}
        </button>
        <button className="button primary" type="button" onClick={run} disabled={busy || !rows?.length}>
          Run now
        </button>
      </div>
      {issues.length > 0 && (
        <ErrorBanner error={`Skipped: end date is before start date in ${issues.map((i) => `${i.batch} (${i.students} students)`).join(", ")}. Fix the dates in Batches.`} />
      )}
      {rows && (rows.length === 0 ? (
        <p className="muted">Every student already matches their batch dates.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Student ID</th><th>Name</th><th>Batch</th><th>Old status</th><th>New status</th><th>Batch dates</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.student_id}>
                  <td>{r.student_id}</td><td>{r.student_name}</td><td>{r.batch}</td>
                  <td>{r.old_status}</td>
                  <td>{r.new_status}{r.is_revert ? " (revert)" : ""}</td>
                  <td>{r.batch_start} → {r.batch_end || "no end date"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
