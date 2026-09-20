import React from "react";
import { Modal } from "./ui.jsx";

// Shows a review screen before an Excel import is actually saved: which
// rows are valid and ready to import, and which rows have a problem and
// will be skipped, with the reason for each shown next to it. Nothing is
// written to the database until the user clicks the Import button.
export default function ImportPreviewModal({
  title,
  validRows,
  invalidRows,
  columns,
  onConfirm,
  onCancel,
  busy,
}) {
  // `mode` is only set by the Fee Collection / Expenses import parsers
  // (a row with a Receipt No / Expense ID overwrites an existing record
  // instead of adding a new one) — undefined everywhere else, so this
  // stays invisible for Students/Transfers imports.
  const hasUpdateMode = validRows.some((r) => r.mode === "update") || invalidRows.some((r) => r.mode === "update");
  const updateCount = validRows.filter((r) => r.mode === "update").length;
  const insertCount = validRows.length - updateCount;

  return (
    <Modal title={title} onClose={onCancel}>
      <div className="import-preview">
        <div className="import-summary">
          <span className="import-ok">
            {hasUpdateMode
              ? `${insertCount} new · ${updateCount} update${updateCount === 1 ? "" : "s"} ready to import`
              : `${validRows.length} row${validRows.length === 1 ? "" : "s"} ready to import`}
          </span>
          {invalidRows.length > 0 && (
            <span className="import-bad">
              {invalidRows.length} row{invalidRows.length === 1 ? "" : "s"} will be skipped
            </span>
          )}
        </div>

        {invalidRows.length > 0 && (
          <div className="import-table-wrap">
            <h4>Rows that will be skipped</h4>
            <table className="import-table">
              <thead>
                <tr>
                  <th>Row</th>
                  {hasUpdateMode && <th>Action</th>}
                  {columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                  <th>Problem</th>
                </tr>
              </thead>
              <tbody>
                {invalidRows.slice(0, 50).map((r) => (
                  <tr key={r.rowNumber}>
                    <td>{r.rowNumber}</td>
                    {hasUpdateMode && <td>{r.mode === "update" ? "Update" : "New"}</td>}
                    {columns.map((c) => (
                      <td key={c}>{String(r.preview[c] ?? "")}</td>
                    ))}
                    <td className="import-problem">{r.problems.join("; ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {invalidRows.length > 50 && (
              <p className="import-more">...and {invalidRows.length - 50} more.</p>
            )}
          </div>
        )}

        {validRows.length > 0 && (
          <div className="import-table-wrap">
            <h4>Rows ready to import</h4>
            <table className="import-table">
              <thead>
                <tr>
                  <th>Row</th>
                  {hasUpdateMode && <th>Action</th>}
                  {columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {validRows.slice(0, 50).map((r) => (
                  <tr key={r.rowNumber}>
                    <td>{r.rowNumber}</td>
                    {hasUpdateMode && <td>{r.mode === "update" ? "Update" : "New"}</td>}
                    {columns.map((c) => (
                      <td key={c}>{String(r.preview[c] ?? "")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {validRows.length > 50 && (
              <p className="import-more">...and {validRows.length - 50} more.</p>
            )}
          </div>
        )}

        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="button primary"
            onClick={onConfirm}
            disabled={busy || validRows.length === 0}
          >
            {busy ? "Importing..." : `Import ${validRows.length} row${validRows.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
