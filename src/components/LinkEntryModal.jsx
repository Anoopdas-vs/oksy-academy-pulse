import React, { useMemo, useState } from "react";
import { ErrorBanner, Modal } from "./ui.jsx";
import { friendlyError } from "../lib/validation.js";
import {
  linkCandidates,
  filterLinkCandidates,
  summarizeSelection,
  BOOK_KIND_TAG,
} from "../lib/reconcile.js";

const money2 = (n) => Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Manual link popup: pick one or more unlinked book entries for one bank
// line and save them together (one atomic RPC). Single-tenant: one academy.
// `usedKeys` = entries already linked to any bank line of this account.
export default function LinkEntryModal({ line, account, data, usedKeys, onClose, onConfirm }) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [picked, setPicked] = useState(() => new Set());
  const [ack, setAck] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isDeposit = Number(line.deposit) > 0;
  const bankAmount = isDeposit ? Number(line.deposit) : Number(line.withdrawal);

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

  return (
    <Modal title="Link entry" onClose={onClose}>
      <div className="classify-summary">
        <strong>
          {line.txn_date} · {isDeposit ? "CR" : "DR"} ·{" "}
          <span className={isDeposit ? "amount-positive" : "amount-negative"}>{money2(bankAmount)}</span>
        </strong>
        <span>{line.description}</span>
      </div>

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
            <tr>
              <th></th><th>Book ID</th><th>Date</th><th>Name / note</th><th>Amount</th><th>Bank reference</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={6} className="recon-empty">No unlinked entries for this line.</td></tr>
            )}
            {shown.map((c) => (
              <tr key={c.key} className={picked.has(c.key) ? "link-picked" : ""}>
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
                <td>{c.date}</td>
                <td>{c.who || "—"}</td>
                <td className="recon-num">{money2(c.amount)}</td>
                <td className="desc-cell recon-desc" title={c.bankReference}>{c.bankReference || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="link-footer">
        <span>Selected total <b>{money2(summary.total)}</b></span>
        <span>Bank amount <b>{money2(summary.bankAmount)}</b></span>
        <span className={summary.amountDiff !== 0 && summary.count ? "recon-diff warn-amount" : ""}>
          Amount diff <b>{money2(summary.amountDiff)}</b>
        </span>
        <span className={summary.dateDiff !== 0 ? "recon-diff warn-date" : ""}>
          Date diff <b>{summary.dateDiff}</b> day(s)
        </span>
      </div>

      {summary.needsConfirm && (
        <div className="link-warning">
          <span>
            {summary.amountDiff !== 0 && "The selected total does not equal the bank amount. "}
            {summary.dateDiff !== 0 && "Book date and bank date differ. "}
            The table will show it as {summary.amountDiff !== 0 ? "Amount diff" : "Date diff"} so it can be corrected later.
          </span>
          <label className="link-check">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I understand, link anyway
          </label>
        </div>
      )}

      <ErrorBanner message={error} />

      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" className="button primary" onClick={confirm} disabled={!canConfirm}>
          {saving ? "Linking..." : `Link ${summary.count} ${summary.count === 1 ? "entry" : "entries"}`}
        </button>
      </div>
    </Modal>
  );
}
