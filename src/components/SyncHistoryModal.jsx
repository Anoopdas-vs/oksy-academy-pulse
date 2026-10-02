import React, { useEffect, useState } from "react";
import { ErrorBanner, Modal } from "./ui.jsx";
import { friendlyError } from "../lib/validation.js";

// Recent "Sync to books" runs, with Undo for runs not yet undone.
export default function SyncHistoryModal({ onClose, onLoadRuns, onUndo }) {
  const [runs, setRuns] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [results, setResults] = useState({}); // runId -> { restored, skipped }

  const load = async () => {
    try {
      setRuns(await onLoadRuns());
    } catch (err) {
      setError(friendlyError(err));
      setRuns([]);
    }
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const undo = async (runId) => {
    setBusyId(runId);
    setError("");
    try {
      const result = await onUndo(runId);
      setResults((r) => ({ ...r, [runId]: result }));
      await load();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal title="Sync history" onClose={onClose}>
      <ErrorBanner message={error} />
      <div className="link-list table-scroll">
        <table>
          <thead>
            <tr><th>When</th><th>Who</th><th>Changes</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {runs === null && <tr><td colSpan={5} className="recon-empty">Loading…</td></tr>}
            {runs && runs.length === 0 && <tr><td colSpan={5} className="recon-empty">No syncs yet.</td></tr>}
            {(runs || []).map((r) => (
              <tr key={r.runId}>
                <td>{new Date(r.syncedAt).toLocaleString()}</td>
                <td>{r.syncedByName || "—"}</td>
                <td className="recon-num">{r.changes}</td>
                <td>
                  {r.isUndone ? "Undone" : "Applied"}
                  {results[r.runId] && (
                    <div className="recon-reason">
                      Undone ({results[r.runId].restored} restored, {results[r.runId].skipped} skipped)
                    </div>
                  )}
                </td>
                <td>
                  {!r.isUndone && (
                    <button className="button ghost small danger" disabled={busyId !== null} onClick={() => undo(r.runId)}>
                      {busyId === r.runId ? "Undoing…" : "Undo"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
