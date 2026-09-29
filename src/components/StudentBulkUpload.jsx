import React, { useState } from "react";
import { ErrorBanner, Modal } from "./ui.jsx";
import { bulkUpsertStudents } from "../lib/data.js";
import { friendlyError } from "../lib/validation.js";
import {
  checkUploadFile,
  parseStudentSheet,
  canApply,
  summaryLine,
} from "../lib/studentBulk.js";

// "Upload Excel" for the Student Enrollment page: pick .xlsx -> parse ->
// database dry run -> preview -> confirm -> apply (all-or-nothing). Rendered
// for Owner/Admin only; the RPC enforces that regardless of what the UI shows.
export default function StudentBulkUpload({ onApplied }) {
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null); // { fileName, rows, result, extraHeaders }
  const [confirmedBlanks, setConfirmedBlanks] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState("");
  const [done, setDone] = useState("");

  const close = () => {
    setPreview(null);
    setConfirmedBlanks(false);
    setApplyError("");
  };

  const onFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    setError("");
    setDone("");
    const problem = checkUploadFile(file);
    if (problem) {
      setError(problem);
      return;
    }
    setReading(true);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const parsed = parseStudentSheet(XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true }));
      if (parsed.fatal) {
        setError(parsed.fatal);
        return;
      }
      const result = await bulkUpsertStudents(parsed.rows, { dryRun: true });
      setConfirmedBlanks(false);
      setPreview({ fileName: file.name, rows: parsed.rows, result, extraHeaders: parsed.extraHeaders });
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setReading(false);
    }
  };

  const apply = async () => {
    setApplying(true);
    setApplyError("");
    try {
      const result = await bulkUpsertStudents(preview.rows, { dryRun: false, confirmBlanks: confirmedBlanks });
      setDone(`Upload applied: ${result.updates} updated, ${result.new} added.`);
      close();
      await onApplied?.();
    } catch (err) {
      // Nothing was saved (the whole upload rolls back).
      setApplyError(`Nothing was saved. ${friendlyError(err)}`);
    } finally {
      setApplying(false);
    }
  };

  return (
    <>
      <label className={`button secondary${reading ? " disabled" : ""}`} aria-busy={reading}>
        {reading ? "Reading file..." : "Upload Excel"}
        <input type="file" accept=".xlsx" onChange={onFile} disabled={reading} hidden />
      </label>
      {error && <ErrorBanner message={error} />}
      {done && <div className="auth-message notice page-error" role="status">{done}</div>}

      {preview && (
        <Modal title="Upload Students — Review" onClose={applying ? undefined : close}>
          <PreviewBody
            preview={preview}
            confirmedBlanks={confirmedBlanks}
            setConfirmedBlanks={setConfirmedBlanks}
            applying={applying}
            applyError={applyError}
            onApply={apply}
            onCancel={close}
          />
        </Modal>
      )}
    </>
  );
}

const ACTION_LABEL = { update: "Update", new: "New", unchanged: "No change", error: "Error" };
const MAX_LISTED = 200;

function PreviewBody({ preview, confirmedBlanks, setConfirmedBlanks, applying, applyError, onApply, onCancel }) {
  const { result, extraHeaders, fileName } = preview;
  const flagged = result.rows.filter((r) => r.errors.length || r.warnings.length);
  const clean = result.rows.filter((r) => !r.errors.length && !r.warnings.length && r.action !== "unchanged");
  // Problems first, then clean rows.
  const listed = [...flagged, ...clean];
  const enabled = canApply(result, { confirmedBlanks }) && !applying;

  return (
    <div className="import-preview">
      <p className="page-lead">{fileName}</p>
      <div className="import-summary">
        <span className="import-ok">{result.updates} update{result.updates === 1 ? "" : "s"}</span>
        <span className="import-ok">{result.new} new</span>
        <span className={result.errors ? "import-bad" : "import-ok"}>{result.errors} error{result.errors === 1 ? "" : "s"}</span>
        <span className={result.warnings ? "import-warn" : "import-ok"}>{result.warnings} warning{result.warnings === 1 ? "" : "s"}</span>
        {result.unchanged > 0 && <span className="import-ok">{result.unchanged} unchanged</span>}
      </div>
      <p className="import-more" aria-live="polite">{summaryLine(result)}</p>

      {extraHeaders.length > 0 && (
        <p className="import-more">Ignored columns: {extraHeaders.join(", ")}.</p>
      )}
      <p className="import-more">
        Student ID, Status and Batch can't be changed by an upload. New students start as Registered, dated today.
      </p>

      {result.errors > 0 && (
        <ErrorBanner message="Fix the rows marked Error and upload the file again. Nothing is saved while any row has an error." />
      )}

      {result.blank_overwrites > 0 && (
        <label className="import-confirm">
          <input
            type="checkbox"
            checked={confirmedBlanks}
            onChange={(e) => setConfirmedBlanks(e.target.checked)}
            disabled={applying}
          />
          <span>
            <strong>{result.blank_overwrites} blank cell{result.blank_overwrites === 1 ? "" : "s"}</strong> will
            erase existing values (listed below). I confirm this overwrite.
          </span>
        </label>
      )}

      {listed.length === 0 ? (
        <p className="table-empty">Nothing to change — every row already matches the database.</p>
      ) : (
        <div className="import-table-wrap">
          <table className="import-table">
            <thead>
              <tr><th>Row</th><th>Student ID</th><th>Action</th><th>Messages</th></tr>
            </thead>
            <tbody>
              {listed.slice(0, MAX_LISTED).map((r) => (
                <tr key={r.row}>
                  <td>{r.row}</td>
                  <td>{r.id || "—"}</td>
                  <td>{ACTION_LABEL[r.action] || r.action}</td>
                  <td className="import-messages">
                    {r.errors.map((m, i) => <div key={`e${i}`} className="import-problem">{m}</div>)}
                    {r.warnings.map((m, i) => <div key={`w${i}`} className="import-warning">{m}</div>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {listed.length > MAX_LISTED && <p className="import-more">...and {listed.length - MAX_LISTED} more rows.</p>}
        </div>
      )}

      {applyError && <ErrorBanner message={applyError} />}

      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onCancel} disabled={applying}>Cancel</button>
        <button type="button" className="button primary" onClick={onApply} disabled={!enabled}>
          {applying ? "Applying..." : `Apply ${result.updates + result.new} change${result.updates + result.new === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}
