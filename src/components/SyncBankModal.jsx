import React, { useMemo, useState } from "react";
import { ErrorBanner, Modal } from "./ui.jsx";
import { friendlyError } from "../lib/validation.js";
import {
  BOOK_KIND_TAG,
  buildSyncPayload,
  buildSyncPreview,
  buildReconRows,
  defaultSyncSelection,
  ledgerByKeyOf,
  reviewHints,
  selectAllSync,
  setMasterDate,
} from "../lib/reconcile.js";

const clip = (t, n = 60) => (t.length > n ? `${t.slice(0, n)}…` : t);
const toggled = (set, key) => {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
};

// Preview + apply for "Sync to books": fills empty bank references, optionally
// replaces differing ones, optionally moves book dates to the bank date. Only
// book rows change; bank lines and links are never touched. Single-tenant.
export default function SyncBankModal({ statement, lines, allLines, data, onClose, onApply, onUndo }) {
  const preview = useMemo(() => {
    const ledger = ledgerByKeyOf(data);
    const hints = reviewHints(lines, allLines, statement.account, data);
    return buildSyncPreview(buildReconRows(lines, ledger, hints), ledger);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, allLines, statement, data.collections, data.expenses, data.transfers]);

  const [selection, setSelection] = useState(() => defaultSyncSelection(preview));
  const [masterDate, setMaster] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null); // { runId, changed }
  const [undoResult, setUndoResult] = useState(null);

  const actionable = preview.items.filter((i) => i.reference.status !== "same" || i.date);
  const payload = buildSyncPayload(preview, selection);
  const t = preview.totals;
  const skippedText = Object.entries(preview.skippedByReason).map(([why, n]) => `${n} ${why}`).join(", ");

  const toggleMaster = (on) => {
    setMaster(on);
    setSelection((sel) => setMasterDate(preview, sel, on));
  };

  const apply = async () => {
    setSaving(true);
    setError("");
    try {
      setDone(await onApply(payload));
      setUndoResult(null);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  };

  const undo = async () => {
    setSaving(true);
    setError("");
    try {
      setUndoResult(await onUndo(done.runId));
      setDone(null);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Sync to books" onClose={onClose}>
      <div className="recon-chips">
        <span className="recon-chip">{t.fills} references to fill</span>
        <span className="recon-chip">{t.conflicts} conflicts</span>
        <span className="recon-chip">{t.dateChanges} date corrections</span>
        <span className="recon-chip">{t.monthChanges} month changes</span>
      </div>
      <p className="field-hint sync-note">
        {t.eligible} lines eligible, {t.skipped} skipped{skippedText ? ` (${skippedText})` : ""}. Only lines whose
        linked entries add up to the bank amount are synced. Bank lines and links are never changed.
      </p>

      {done && (
        <div className="info-box sync-done" role="status">
          <strong>Synced {done.changed} {done.changed === 1 ? "change" : "changes"}</strong>
          <button type="button" className="button secondary small" onClick={undo} disabled={saving}>
            Undo this sync
          </button>
        </div>
      )}
      {undoResult && (
        <div className="info-box" role="status">
          <strong>Undone</strong>
          <span>{undoResult.restored} restored, {undoResult.skipped} skipped (changed since the sync).</span>
        </div>
      )}

      <div className="link-toolbar">
        <label className="link-check">
          <input type="checkbox" checked={masterDate} onChange={(e) => toggleMaster(e.target.checked)} /> Book date → Bank date
        </label>
        <button type="button" className="button ghost small" onClick={() => setSelection(selectAllSync(preview, true))}>
          Select all
        </button>
        <button type="button" className="button ghost small" onClick={() => setSelection(selectAllSync(preview, false))}>
          Select none
        </button>
      </div>

      <div className="link-list table-scroll">
        <table>
          <thead>
            <tr><th>Book ID</th><th>Bank date</th><th>Reference</th><th>Date</th></tr>
          </thead>
          <tbody>
            {actionable.length === 0 && (
              <tr><td colSpan={4} className="recon-empty">Nothing to sync — books already match the bank.</td></tr>
            )}
            {actionable.map((i) => {
              const ref = i.reference;
              return (
                <tr key={i.key} className={ref.status === "conflict" ? "sync-conflict" : ""}>
                  <td className="recon-num">
                    {i.label} <span className="mini-tag recon-kind">{BOOK_KIND_TAG[i.kind]}</span>
                  </td>
                  <td>{i.bankDate}</td>
                  <td>
                    {ref.status === "same" ? (
                      "—"
                    ) : (
                      <label className="sync-cell">
                        <input
                          type="checkbox"
                          checked={selection.refKeys.has(i.key)}
                          onChange={() => setSelection((s) => ({ ...s, refKeys: toggled(s.refKeys, i.key) }))}
                          aria-label={`Sync reference for ${i.label}`}
                        />
                        <span title={`${ref.current ? `${ref.current} → ` : ""}${ref.next}`}>
                          {ref.status === "conflict" ? (
                            <>
                              <span className="mini-tag warn">Conflict</span> {clip(ref.current, 30)} → {clip(ref.next, 30)}
                            </>
                          ) : (
                            <>(empty) → {clip(ref.next)}</>
                          )}
                        </span>
                      </label>
                    )}
                  </td>
                  <td>
                    {i.date ? (
                      <label className="sync-cell">
                        <input
                          type="checkbox"
                          checked={selection.dateKeys.has(i.key)}
                          onChange={() => setSelection((s) => ({ ...s, dateKeys: toggled(s.dateKeys, i.key) }))}
                          aria-label={`Sync date for ${i.label}`}
                        />
                        <span>
                          {i.date.from} → {i.date.to}
                          {i.date.monthChanges && <span className="mini-tag warn sync-month">Month changes</span>}
                        </span>
                      </label>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ErrorBanner message={error} />

      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onClose} disabled={saving}>Close</button>
        <button type="button" className="button primary" onClick={apply} disabled={saving || payload.length === 0}>
          {saving ? "Working..." : `Apply ${payload.length} ${payload.length === 1 ? "change" : "changes"}`}
        </button>
      </div>
    </Modal>
  );
}
