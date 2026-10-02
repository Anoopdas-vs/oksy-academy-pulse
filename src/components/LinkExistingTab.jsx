import React, { useMemo, useState } from "react";
import { ErrorBanner } from "./ui.jsx";
import { friendlyError } from "../lib/validation.js";
import {
  linkCandidates,
  filterLinkCandidates,
  summarizeSelection,
  BOOK_KIND_TAG,
} from "../lib/reconcile.js";

const money2 = (n) => Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// "Link existing" tab of the Match popup: pick one or more unlinked book
// entries for one bank line and save them together (one atomic RPC). Linking
// never edits the entries' bank_reference or date -- only Sync to books does.
// Single-tenant: one academy. `usedKeys` = entries already linked for this
// account (see linkedKeys).
export default function LinkExistingTab({ line, account, data, usedKeys, onClose, onConfirm }) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [picked, setPicked] = useState(() => new Set());
  const [ack, setAck] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const all = useMemo(
    () => linkCandidates(line, account, data, usedKeys, { showAllDates: showAll }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [line, account, data.collections, data.expenses, data.transfers, usedKeys, showAll]
  );
  const shown = useMemo(() => filterLinkCandidates(all, query), [all, query]);
  const selected = all.filter((c) => picked.has(c.key));
  const summary = summarizeSelection(line, selected);
  const canConfirm = summary.count > 0 && !saving && (!summary.needsConfirm || ack);

  const toggle = (key) => {
    setAck(false);
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const confirm = async () => {
    setSaving(true);
    setError("");
    try {
      await onConfirm(selected);
      onClose();
    } catch (err) {
      setError(friendlyError(err));
      setSaving(false);
    }
  };

  const days = Math.abs(summary.dateDiff);

  return (
    <>
      <div className="modal-body">
        <div className="link-toolbar">
          <input
            type="search"
            placeholder="Search ID, name, amount, date"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search entries"
          />
          <label className="link-check">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show all dates
          </label>
        </div>

        <div className="link-list table-scroll">
          <table>
            <thead>
              <tr><th></th><th>Entry</th><th>Date</th><th>Name / note</th><th>Amount</th></tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={5} className="recon-empty">
                    No unlinked entries match. Try &apos;Show all dates&apos; or Create new.
                  </td>
                </tr>
              )}
              {shown.map((c) => (
                <tr key={c.key} className={picked.has(c.key) ? "link-picked" : ""} title={c.bankReference || undefined}>
                  <td>
                    <input
                      type="checkbox"
                      checked={picked.has(c.key)}
                      onChange={() => toggle(c.key)}
                      aria-label={`Select ${c.label}`}
                    />
                  </td>
                  <td className="recon-num">
                    {c.label} <span className="mini-tag recon-kind">{BOOK_KIND_TAG[c.kind]}</span>
                    {c.suggested && <span className="mini-tag ok recon-src">Suggested</span>}
                  </td>
                  <td className="recon-num">{c.date}</td>
                  <td>{c.who || "—"}</td>
                  <td className="recon-num">{money2(c.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ErrorBanner message={error} />
      </div>

      <div className="modal-footer">
        <span className="modal-summary">
          Selected {money2(summary.total)} of {money2(summary.bankAmount)} · Diff{" "}
          <span className={summary.amountDiff !== 0 && summary.count ? "recon-diff warn-amount" : ""}>
            {money2(summary.amountDiff)}
          </span>{" "}
          · <span className={summary.dateDiff !== 0 ? "recon-diff warn-date" : ""}>{days} {days === 1 ? "day" : "days"}</span>
        </span>
        {summary.needsConfirm && (
          <label className="link-check">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I understand, link anyway
          </label>
        )}
        <button type="button" className="button secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" className="button primary" onClick={confirm} disabled={!canConfirm}>
          {saving ? "Linking..." : `Link ${summary.count} ${summary.count === 1 ? "entry" : "entries"}`}
        </button>
      </div>
    </>
  );
}
