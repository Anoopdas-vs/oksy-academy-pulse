import React, { Suspense, lazy, useMemo, useState } from "react";
import { ErrorBanner, Input, Modal, MetricCard } from "../components/ui.jsx";
import { formatMoney } from "../lib/format.js";
import { SearchBox, Pager } from "../components/SearchPager.jsx";
import { usePagedList } from "../lib/usePagedList.js";
import { downloadTemplate } from "../lib/templates.js";
import BankReferenceCell from "../components/BankReferenceCell.jsx";
import { TRANSFER_SEARCH_FIELDS, TRANSFER_TEMPLATE_HEADERS } from "../lib/bankReference.js";
import { normalizeBankReference, validateBankReference } from "../lib/validation.js";

// Loaded on first use so they stay out of the page chunk until opened.
const MatchLineModal = lazy(() => import("../components/MatchLineModal.jsx"));
const SyncBankModal = lazy(() => import("../components/SyncBankModal.jsx"));
const SyncHistoryModal = lazy(() => import("../components/SyncHistoryModal.jsx"));
import {
  reconciliationSummary,
  matchKindLabel,
  bankReferenceMismatches,
  isOrderAssumed,
  planRerun,
  reviewHints,
  suggestSplitGroups,
  ledgerByKeyOf,
  bookOnlyEntries,
  linkedKeys,
  buildReconRows,
  reconFilterCounts,
  reconRowMatchesFilter,
  RECON_FILTERS,
  RESULT_LABEL,
  REASON_LABEL,
  BOOK_KIND_TAG,
} from "../lib/reconcile.js";

const ACCOUNTS = ["HDFC", "ICICI", "Cash", "Healthcare"];
const BANK_ACCOUNTS = ["HDFC", "ICICI"];

export default function BankingPage({
  totals,
  isAdmin,
  students,
  transfers,
  collections,
  expenses,
  bankStatements,
  bankLines,
  busy,
  transferForm,
  setTransferForm,
  onAddTransfer,
  savingTransfer,
  transferFormError,
  onTransferFile,
  onEditTransfer,
  onDeleteTransfer,
  onUploadStatement,
  onClassifyLine,
  onIgnoreLine,
  onUnmatchLine,
  onApplyRerun,
  onLinkLine,
  onSyncRun,
  onUndoSync,
  onLoadSyncRuns,
  onDeleteStatement,
  loading = false,
}) {
  const [view, setView] = useState("transfers");

  return (
    <section className="page">
      <div className="page-actions">
        <div className="subtab-switch">
          <button
            className={view === "transfers" ? "subtab active" : "subtab"}
            onClick={() => setView("transfers")}
          >
            Transfers
          </button>
          <button
            className={view === "reconcile" ? "subtab active" : "subtab"}
            onClick={() => setView("reconcile")}
          >
            Reconciliation
          </button>
        </div>
      </div>

      <div className="metric-grid four">
        <MetricCard label="Cash Balance" value={formatMoney(totals.cashBalance)} tone="auto" amount={totals.cashBalance} />
        <MetricCard label="HDFC Balance" value={formatMoney(totals.hdfcBalance)} tone="auto" amount={totals.hdfcBalance} />
        <MetricCard label="ICICI Balance" value={formatMoney(totals.iciciBalance)} tone="auto" amount={totals.iciciBalance} />
        <MetricCard
          label={totals.healthcareBalance >= 0 ? "Healthcare Receivable" : "Healthcare Payable"}
          value={formatMoney(Math.abs(totals.healthcareBalance))}
          tone={totals.healthcareBalance >= 0 ? "pos" : "neg"}
        />
      </div>

      {view === "transfers" ? (
        <TransfersView
          isAdmin={isAdmin}
          transfers={transfers}
          loading={loading}
          form={transferForm}
          setForm={setTransferForm}
          onSubmit={onAddTransfer}
          saving={savingTransfer}
          formError={transferFormError}
          onFile={onTransferFile}
          onEdit={onEditTransfer}
          onDelete={onDeleteTransfer}
        />
      ) : (
        <ReconcileView
          isAdmin={isAdmin}
          students={students}
          data={{ collections, expenses, transfers }}
          bankStatements={bankStatements}
          bankLines={bankLines}
          busy={busy}
          onUploadStatement={onUploadStatement}
          onClassifyLine={onClassifyLine}
          onIgnoreLine={onIgnoreLine}
          onUnmatchLine={onUnmatchLine}
          onApplyRerun={onApplyRerun}
          onLinkLine={onLinkLine}
          onSyncRun={onSyncRun}
          onUndoSync={onUndoSync}
          onLoadSyncRuns={onLoadSyncRuns}
          onDeleteStatement={onDeleteStatement}
        />
      )}
    </section>
  );
}

/* ------------------------------ Transfers ------------------------------ */

function TransfersView({ isAdmin, transfers, form, setForm, onSubmit, saving, formError, onFile, onEdit, onDelete, loading = false }) {
  const set = (patch) => setForm({ ...form, ...patch });
  const [editing, setEditing] = useState(null);
  const [rowBusy, setRowBusy] = useState(false);
  const paged = usePagedList(transfers, {
    searchFields: TRANSFER_SEARCH_FIELDS,
    pageSize: 20,
  });

  return (
    <div className={isAdmin ? "two-column" : ""}>
      {isAdmin && (
        <div className="form-card">
          <div className="card-heading between">
            <div><h3>New Transfer</h3><p>Move money between accounts</p></div>
            <div className="header-actions">
              <button
                className="button secondary small"
                onClick={() =>
                  downloadTemplate(
                    "transfer_template.xlsx",
                    TRANSFER_TEMPLATE_HEADERS,
                    ["2026-06-01", "Cash", "ICICI", 50000, "Cash deposit", "DEP-01", "", ""]
                  )
                }
              >
                Template
              </button>
              <label className="button secondary small">
                Import
                <input type="file" accept=".xlsx,.xls,.csv" onChange={onFile} hidden />
              </label>
            </div>
          </div>
          <form onSubmit={onSubmit}>
            <ErrorBanner error={formError} />
            <Input label="Date" type="date" value={form.date} onChange={(v) => set({ date: v })} required />
            <div className="field-row">
              <div className="field">
                <label>From Account</label>
                <select value={form.from_account} onChange={(e) => set({ from_account: e.target.value })}>
                  {ACCOUNTS.map((a) => <option key={a}>{a}</option>)}
                </select>
              </div>
              <div className="field">
                <label>To Account</label>
                <select value={form.to_account} onChange={(e) => set({ to_account: e.target.value })}>
                  {ACCOUNTS.map((a) => <option key={a}>{a}</option>)}
                </select>
              </div>
            </div>
            <Input label="Amount" type="number" min="0.01" step="0.01" value={form.amount} onChange={(v) => set({ amount: v })} required />
            <Input label="Purpose" placeholder="e.g. Cash deposit, Account opening payment, Healthcare repayment" value={form.purpose} onChange={(v) => set({ purpose: v })} />
            <Input label="Reference No." value={form.reference} onChange={(v) => set({ reference: v })} />
            <Input label="Note" value={form.note} onChange={(v) => set({ note: v })} />
            <div className="info-box">
              <strong>Not income or expense</strong>
              <span>A transfer only moves the balance between accounts — Net P&amp;L is unchanged.</span>
            </div>
            <button className="button primary full" type="submit" disabled={saving}>
              {saving ? "Saving..." : "Record Transfer"}
            </button>
          </form>
        </div>
      )}

      <div className="table-card">
        <div className="card-heading">
          <div><h3>Transfer History</h3><p>All account-to-account movements</p></div>
        </div>
        <div className="toolbar">
          <SearchBox value={paged.query} onChange={paged.setQuery} placeholder="Search account, purpose, reference, UTR..." />
          <Pager
            page={paged.page}
            totalPages={paged.totalPages}
            onPageChange={paged.setPage}
            filteredCount={paged.filteredCount}
            totalCount={paged.totalCount}
          />
        </div>
        <table>
          <thead>
            <tr>
              <th>Date</th><th>From</th><th>To</th><th>Amount</th>
              <th>Purpose</th><th>Reference</th><th>Bank reference</th>{isAdmin && <th></th>}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={isAdmin ? 8 : 7} className="table-empty">Loading transfers...</td></tr>
            )}
            {!loading && paged.pageRows.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 8 : 7} className="table-empty">
                  {paged.query ? "No transfers matching your search." : "No transfers recorded yet."}
                </td>
              </tr>
            )}
            {!loading && paged.pageRows.map((t) => (
              <tr key={t.id}>
                <td>{t.date}</td>
                <td><span className="mini-tag">{t.from_account}</span></td>
                <td><span className="mini-tag">{t.to_account}</span></td>
                <td>{formatMoney(t.amount)}</td>
                <td>{t.purpose}</td>
                <td>{t.reference}</td>
                <td><BankReferenceCell value={t.bank_reference} /></td>
                {isAdmin && (
                  <td className="row-actions">
                    <button className="button secondary small" onClick={() => setEditing(t)}>Edit</button>
                    <button
                      className="button ghost small danger"
                      onClick={() => {
                        if (window.confirm(`Delete this transfer (${formatMoney(t.amount)})?`)) onDelete(t.id);
                      }}
                    >
                      Delete
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal title="Edit Transfer" onClose={() => setEditing(null)}>
          <EditTransferForm
            row={editing}
            busy={rowBusy}
            onCancel={() => setEditing(null)}
            onSave={async (patch) => {
              setRowBusy(true);
              try {
                await onEdit(editing.id, patch);
                setEditing(null);
              } finally {
                setRowBusy(false);
              }
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function EditTransferForm({ row, busy, onCancel, onSave }) {
  const [f, setF] = useState({
    date: row.date,
    from_account: row.from_account,
    to_account: row.to_account,
    amount: row.amount,
    purpose: row.purpose || "",
    reference: row.reference || "",
    note: row.note || "",
    bank_reference: row.bank_reference || "",
  });
  const [refError, setRefError] = useState("");
  const set = (p) => setF({ ...f, ...p });
  const submit = (e) => {
    e.preventDefault();
    const problem = validateBankReference(f.bank_reference, row.bank_reference);
    setRefError(problem);
    if (problem) return;
    onSave({ ...f, bank_reference: normalizeBankReference(f.bank_reference) });
  };
  return (
    <form className="form-grid" onSubmit={submit}>
      <Input label="Date" type="date" value={f.date} onChange={(v) => set({ date: v })} required />
      <div className="field">
        <label>From Account</label>
        <select value={f.from_account} onChange={(e) => set({ from_account: e.target.value })}>
          {ACCOUNTS.map((a) => <option key={a}>{a}</option>)}
        </select>
      </div>
      <div className="field">
        <label>To Account</label>
        <select value={f.to_account} onChange={(e) => set({ to_account: e.target.value })}>
          {ACCOUNTS.map((a) => <option key={a}>{a}</option>)}
        </select>
      </div>
      <Input label="Amount" type="number" min="0.01" step="0.01" value={f.amount} onChange={(v) => set({ amount: v })} required />
      <Input label="Purpose" value={f.purpose} onChange={(v) => set({ purpose: v })} />
      <Input label="Reference No." value={f.reference} onChange={(v) => set({ reference: v })} />
      <Input label="Note" value={f.note} onChange={(v) => set({ note: v })} />
      <Input
        label="UTR / Reference no"
        value={f.bank_reference}
        onChange={(v) => set({ bank_reference: v })}
        error={refError}
        hint="UPI/bank reference number (e.g. 534608284353). Used to match the bank statement automatically."
      />
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="button primary" disabled={busy}>{busy ? "Saving..." : "Save changes"}</button>
      </div>
    </form>
  );
}

/* --------------------------- Reconciliation --------------------------- */

function ReconcileView({
  isAdmin,
  students,
  data,
  bankStatements,
  bankLines,
  busy,
  onUploadStatement,
  onClassifyLine,
  onIgnoreLine,
  onUnmatchLine,
  onApplyRerun,
  onLinkLine,
  onSyncRun,
  onUndoSync,
  onLoadSyncRuns,
  onDeleteStatement,
}) {
  const [account, setAccount] = useState("ICICI");
  const [openId, setOpenId] = useState(null);
  const [matching, setMatching] = useState(null); // { line, account } for the Match popup
  const [syncing, setSyncing] = useState(null); // { statement, lines } for the Sync to books preview
  const [showSyncHistory, setShowSyncHistory] = useState(false);
  const [rerun, setRerun] = useState(null); // { statementId, changes } dry-run awaiting confirmation

  const linesByStatement = useMemo(() => {
    const map = new Map();
    bankLines.forEach((l) => {
      if (!map.has(l.statement_id)) map.set(l.statement_id, []);
      map.get(l.statement_id).push(l);
    });
    return map;
  }, [bankLines]);

  const onFile = (e) => {
    const file = e.target.files[0];
    if (file) onUploadStatement(account, file);
    e.target.value = "";
  };

  return (
    <div className="recon">
      {isAdmin && (
        <div className="form-card recon-upload">
          <div className="card-heading">
            <div><h3>Upload Bank Statement</h3><p>Excel export from the bank (.xlsx / .csv)</p></div>
          </div>
          <div className="field-row">
            <div className="field">
              <label>Account</label>
              <select value={account} onChange={(e) => setAccount(e.target.value)}>
                {BANK_ACCOUNTS.map((a) => <option key={a}>{a}</option>)}
              </select>
            </div>
            <label className="button primary upload-btn">
              {busy ? "Working..." : "Choose file & upload"}
              <input type="file" accept=".xlsx,.xls,.csv" onChange={onFile} hidden disabled={busy} />
            </label>
          </div>
          <div className="info-box">
            <strong>How matching works</strong>
            <span>
              Each statement line is auto-matched to a fee collection, expense or transfer by
              date and amount. Unmatched lines are classified by hand — that creates the missing
              record. When nothing is left unmatched, the book balance equals the bank balance.
            </span>
          </div>
        </div>
      )}

      {bankStatements.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">▣</div>
          <h3>No statements uploaded</h3>
          <p>Upload a bank statement to start reconciling.</p>
        </div>
      )}

      <MismatchReport data={data} />

      {bankStatements.map((st) => {
        const lines = (linesByStatement.get(st.id) || []).slice().sort((a, b) => {
          if (a.txn_date !== b.txn_date) return a.txn_date < b.txn_date ? -1 : 1;
          return (a.seq || 0) - (b.seq || 0);
        });
        const summary = reconciliationSummary(st, lines, data);
        const isOpen = openId === st.id;

        return (
          <div className="table-card recon-statement" key={st.id}>
            <div className="card-heading between">
              <div>
                <h3>
                  {st.account} · {st.period_start} → {st.period_end}{" "}
                  {summary.reconciled ? (
                    <span className="mini-tag ok">Reconciled</span>
                  ) : (
                    <>
                      {summary.openCount > 0 && (
                        <span className="mini-tag warn">{summary.openCount} unmatched</span>
                      )}
                      {summary.reviewCount > 0 && (
                        <span className="mini-tag warn">{summary.reviewCount} needs review</span>
                      )}
                    </>
                  )}
                </h3>
                <p>{st.file_name}</p>
              </div>
              <div className="header-actions">
                <button
                  className="button secondary small"
                  disabled={busy || lines.length === 0}
                  onClick={async () => {
                    try {
                      const { exportReconExcel } = await import("../lib/reconExport.js");
                      await exportReconExcel({ statement: st, lines, allLines: bankLines, data, summary });
                    } catch (err) {
                      alert(`Could not build the Excel file: ${err?.message || err}`);
                    }
                  }}
                >
                  Export Excel
                </button>
                {isAdmin && (
                  <>
                    <button
                      className="button secondary small"
                      disabled={busy || lines.length === 0}
                      onClick={() => setSyncing({ statement: st, lines })}
                    >
                      Sync to books
                    </button>
                  </>
                )}
                <button className="button secondary small" onClick={() => setOpenId(isOpen ? null : st.id)}>
                  {isOpen ? "Hide lines" : "Show lines"}
                </button>
                {isAdmin && (summary.openCount > 0 || summary.reviewCount > 0) && (
                  <button
                    className="button secondary small"
                    disabled={busy}
                    onClick={() =>
                      setRerun({
                        statementId: st.id,
                        changes: planRerun(lines, bankLines, st.account, data),
                      })
                    }
                  >
                    Re-run auto-match
                  </button>
                )}
                {isAdmin && (
                  <button
                    className="button secondary small danger"
                    onClick={() => {
                      if (window.confirm("Delete this statement and all its lines? Records already created stay.")) {
                        onDeleteStatement(st.id);
                      }
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>

            {rerun && rerun.statementId === st.id && (
              <RerunPreview
                changes={rerun.changes}
                busy={busy}
                onCancel={() => setRerun(null)}
                onApply={async () => {
                  await onApplyRerun(rerun.changes);
                  setRerun(null);
                }}
              />
            )}
            {isOpen && <SplitSuggestions lines={lines} allLines={bankLines} account={st.account} data={data} />}

            <div className="summary-grid three recon-summary">
              <MetricCard label="Statement closing" value={formatMoney(summary.statementClosing)} tone="auto" amount={summary.statementClosing} />
              <MetricCard label="Book balance (as of end date)" value={formatMoney(summary.bookBalance)} tone="auto" amount={summary.bookBalance} />
              <MetricCard
                label="Difference"
                value={formatMoney(summary.difference)}
                tone={Math.round(summary.difference) === 0 ? "pos" : "neg"}
              />
            </div>

            {isOpen && (
              <ReconGrid
                lines={lines}
                allLines={bankLines}
                account={st.account}
                statement={st}
                data={data}
                isAdmin={isAdmin}
                onMatch={(ln) => setMatching({ line: ln, account: st.account })}
                onIgnoreLine={onIgnoreLine}
                onUnmatchLine={onUnmatchLine}
              />
            )}
          </div>
        );
      })}

      <Suspense fallback={null}>
        {syncing && (
          <SyncBankModal
            statement={syncing.statement}
            lines={syncing.lines}
            allLines={bankLines}
            data={data}
            onClose={() => setSyncing(null)}
            onApply={onSyncRun}
            onUndo={onUndoSync}
            onOpenHistory={() => setShowSyncHistory(true)}
          />
        )}
        {matching && (
          <MatchLineModal
            line={matching.line}
            account={matching.account}
            data={data}
            students={students}
            busy={busy}
            usedKeys={linkedKeys(bankLines, matching.account)}
            onClose={() => setMatching(null)}
            onLink={(entries) => onLinkLine(matching.line, entries)}
            onCreate={async (input) => {
              try {
                await onClassifyLine(matching.line, input);
                setMatching(null);
              } catch {
                /* error is surfaced by the page-level banner */
              }
            }}
          />
        )}
        {showSyncHistory && (
          <SyncHistoryModal onClose={() => setShowSyncHistory(false)} onLoadRuns={onLoadSyncRuns} onUndo={onUndoSync} />
        )}
      </Suspense>
    </div>
  );
}

const rerunLabel = (c) =>
  c.new_status === "matched"
    ? c.links.map((k) => `${matchKindLabel(k.bookKind)} #${k.bookId}`).join(" + ")
    : c.reason
      ? c.reason.replace(/_/g, " ")
      : "—";

// Dry-run of "Re-run auto-match": exactly which review/unmatched lines would
// change. Nothing is written until the admin confirms; matched, classified
// and ignored lines are never part of the plan.
function RerunPreview({ changes, busy, onCancel, onApply }) {
  return (
    <div className="info-box recon-rerun">
      <p>
        <strong>Re-run auto-match</strong> — only lines that are currently Needs review or Unmatched are
        considered. Already matched, classified or ignored lines are never changed.
      </p>
      {changes.length === 0 ? (
        <p>No line would change.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Line #</th><th>Date</th><th>Amount</th><th>Was</th><th>Becomes</th><th>Record</th></tr>
          </thead>
          <tbody>
            {changes.map((c) => (
              <tr key={c.line.id}>
                <td>{c.line.seq}</td>
                <td>{c.line.txn_date}</td>
                <td>{formatMoney(Number(c.line.deposit) > 0 ? c.line.deposit : c.line.withdrawal)}</td>
                <td>{c.old_status}</td>
                <td>{c.new_status}</td>
                <td>{rerunLabel(c)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="header-actions">
        {changes.length > 0 && (
          <button className="button primary small" disabled={busy} onClick={onApply}>
            Apply {changes.length} change{changes.length === 1 ? "" : "s"}
          </button>
        )}
        <button className="button ghost small" onClick={onCancel}>
          {changes.length > 0 ? "Cancel" : "Close"}
        </button>
      </div>
    </div>
  );
}

// Lines no single record explains, where a sum of records does (e.g. one
// 3,600 deposit = two 1,800 fees). Suggestions only: nothing is matched
// automatically -- confirm and settle each line by hand with Resolve/Classify.
function SplitSuggestions({ lines, allLines, account, data }) {
  const groups = useMemo(
    () => suggestSplitGroups(lines, allLines, account, data),
    [lines, allLines, account, data]
  );
  if (!groups.length) return null;
  const describeEntry = (e) => `${matchKindLabel(e.kind)} #${e.id} ${e.label || ""} ${formatMoney(Math.abs(e.delta))}`.replace(/\s+/g, " ");
  return (
    <div className="info-box recon-splits">
      <p>
        <strong>Suggested split groups — need your confirmation.</strong> Nothing here is matched
        automatically; use Resolve / Classify on each line to settle it.
      </p>
      <ul>
        {groups.map((g) => (
          <li key={g.lines.map((l) => l.id).join("-")}>
            Line{g.lines.length > 1 ? "s" : ""} {g.lines.map((l) => `#${l.seq}`).join(", ")} ({formatMoney(g.total)}
            ) could be {g.options.map((o) => o.map(describeEntry).join(" + ")).join("  or  ")}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Row actions for one stored line: Match + Ignore (open lines), Un-ignore
// (ignored), Unmatch (linked). Admin only.
function LineActions({ ln, isAdmin, onMatch, onIgnoreLine, onUnmatchLine }) {
  if (!isAdmin) return null;
  return (
    <>
      {(ln.status === "unmatched" || ln.status === "review") && (
        <>
          <button className="button secondary small" onClick={() => onMatch(ln)}>
            Match
          </button>
          <button className="button ghost small" onClick={() => onIgnoreLine(ln, true)}>
            Ignore
          </button>
        </>
      )}
      {ln.status === "ignored" && (
        <button className="button ghost small" onClick={() => onIgnoreLine(ln, false)}>
          Un-ignore
        </button>
      )}
      {(ln.status === "matched" || ln.status === "classified") && (
        <button
          className="button ghost small danger"
          onClick={() => {
            const created = ln.status === "classified" && ln.match_id;
            const msg = created
              ? `Unmatch this line and DELETE the ${ln.match_kind} it created?`
              : "Unmatch this line? (the existing record is kept)";
            if (window.confirm(msg)) onUnmatchLine(ln, { deleteRecord: !!created });
          }}
        >
          Unmatch
        </button>
      )}
    </>
  );
}

/* ----------------------- Excel-style review table ----------------------- */

const money2 = (n) => Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// One row per bank line; a group shows all its book entries in that row.
// Single-tenant: one academy's books, no tenant scoping.
function ReconGrid({ lines, allLines, account, statement, data, isAdmin, onMatch, onIgnoreLine, onUnmatchLine }) {
  const [filter, setFilter] = useState("all");
  const ledger = useMemo(
    () => ledgerByKeyOf(data),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.collections, data.expenses, data.transfers]
  );
  const hints = useMemo(
    () => reviewHints(lines, allLines, account, data),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, allLines, account, data.collections, data.expenses, data.transfers]
  );
  const rows = useMemo(() => buildReconRows(lines, ledger, hints), [lines, ledger, hints]);
  const counts = useMemo(() => reconFilterCounts(rows), [rows]);
  const bookOnly = useMemo(
    () => bookOnlyEntries(statement, allLines, data),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [statement, allLines, data.collections, data.expenses, data.transfers]
  );
  // The Ignored chip is hidden at zero, so don't stay filtered on it.
  const activeFilter = filter === "ignored" && counts.ignored === 0 ? "all" : filter;
  const shown = activeFilter === "book_only" ? [] : rows.filter((r) => reconRowMatchesFilter(r, activeFilter));

  return (
    <>
      <div className="recon-chips" role="group" aria-label="Filter lines">
        {RECON_FILTERS.filter((f) => f.key !== "ignored" || counts.ignored > 0).map((f) => (
          <button
            key={f.key}
            type="button"
            className={activeFilter === f.key ? "recon-chip active" : "recon-chip"}
            onClick={() => setFilter(f.key)}
          >
            {f.label} <b>{counts[f.key]}</b>
          </button>
        ))}
        <button
          type="button"
          className={activeFilter === "book_only" ? "recon-chip active" : "recon-chip"}
          onClick={() => setFilter("book_only")}
        >
          Book only <b>{bookOnly.length}</b>
        </button>
      </div>
      {activeFilter === "book_only" ? (
        <BookOnlyTable entries={bookOnly} />
      ) : (
      <div className="table-scroll">
        <table className="recon-grid">
          <thead>
            <tr>
              <th>Result</th><th>Bank date</th><th>Description</th><th>Bank amount</th>
              <th>Book ID(s)</th><th>Book date</th><th>Book amount</th>
              <th>Date diff</th><th>Amount diff</th><th>Action</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={10} className="recon-empty">No lines in this view.</td></tr>
            )}
            {shown.map((r) => (
              <ReconRow
                key={r.lineId}
                r={r}
                isAdmin={isAdmin}
                onMatch={onMatch}
                onIgnoreLine={onIgnoreLine}
                onUnmatchLine={onUnmatchLine}
              />
            ))}
          </tbody>
        </table>
      </div>
      )}
    </>
  );
}

// Read-only: entries in the books for the statement's account and period
// that no bank line links to.
function BookOnlyTable({ entries }) {
  return (
    <>
      <div className="info-box recon-bookonly-note">
        <span>In the books but not in this statement — check amount/date or missing bank entry.</span>
      </div>
      <div className="table-scroll">
        <table className="recon-grid">
          <thead>
            <tr>
              <th>Book ID</th><th>Kind</th><th>Date</th><th>Name / category</th><th>Amount</th><th>Bank reference</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr><td colSpan={6} className="recon-empty">Every book entry in this period is linked to a bank line.</td></tr>
            )}
            {entries.map((e) => (
              <tr key={e.key}>
                <td className="recon-num">{e.label}</td>
                <td><span className="mini-tag recon-kind">{BOOK_KIND_TAG[e.kind]}</span></td>
                <td>{e.date}</td>
                <td>{e.who || "—"}</td>
                <td className={e.direction === "CR" ? "amount-positive recon-num" : "amount-negative recon-num"}>
                  {money2(e.amount)}
                </td>
                <td className="desc-cell recon-desc" title={e.bankReference}>{e.bankReference || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ReconRow({ r, isAdmin, onMatch, onIgnoreLine, onUnmatchLine }) {
  const linked = r.links.length > 0;
  const sources = new Set(r.links.map((k) => k.source));
  const sug = !linked ? r.suggestion : null;
  const reasonText = r.reason ? REASON_LABEL[r.reason] || r.reason : r.result === "REVIEW" ? "Needs review" : "";
  return (
    <tr className={r.result === "REVIEW" || r.result === "UNMATCHED" ? "recon-attn" : ""}>
      <td>
        <span className={`rbadge ${r.result.toLowerCase()}`}>{RESULT_LABEL[r.result]}</span>
        {sources.has("auto_name") && <span className="mini-tag ok recon-src">Name-confirmed</span>}
        {sources.has("auto_utr") && <span className="mini-tag ok recon-src">UTR</span>}
        {isOrderAssumed(r.line) && <span className="mini-tag warn recon-src">Assumed by order</span>}
        {r.result === "REVIEW" && reasonText && <div className="recon-reason">{reasonText}</div>}
      </td>
      <td>{r.bankDate}</td>
      <td className="desc-cell recon-desc" title={r.description}>{r.description}</td>
      <td className={r.direction === "CR" ? "amount-positive recon-num" : "amount-negative recon-num"}>
        {money2(r.bankAmount)}
      </td>
      <td>
        {linked
          ? r.links.map((k, i) => (
              <span className="recon-book" key={`${k.kind}:${k.bookId}`}>
                {i > 0 && ", "}
                {k.label} <span className="mini-tag recon-kind">{BOOK_KIND_TAG[k.kind]}</span>
              </span>
            ))
          : sug
            ? <span className="recon-suggest" title="Suggested only — not linked">{sug.label} <span className="mini-tag recon-kind">{BOOK_KIND_TAG[sug.kind]}</span> (suggested)</span>
            : "—"}
      </td>
      <td>{linked ? r.bookDates.join(", ") : sug ? <span className="recon-suggest">{sug.date}</span> : "—"}</td>
      <td className="recon-num">
        {linked ? r.bookAmounts.join(", ") : sug ? <span className="recon-suggest">{money2(sug.amount)}</span> : "—"}
      </td>
      <td className={linked && r.dateDiff !== 0 ? "recon-diff warn-date" : "recon-num"}>
        {linked ? r.dateDiff : sug ? <span className="recon-suggest">{sug.dateDiff}</span> : "—"}
      </td>
      <td className={linked && r.amountDiff !== 0 ? "recon-diff warn-amount" : "recon-num"}>
        {linked ? money2(r.amountDiff) : "—"}
      </td>
      <td className="row-actions">
        <LineActions
          ln={r.line}
          isAdmin={isAdmin}
          onMatch={onMatch}
          onIgnoreLine={onIgnoreLine}
          onUnmatchLine={onUnmatchLine}
        />
      </td>
    </tr>
  );
}

// Re-verification report: fee collections whose bank_reference (the UPI/
// bank description copied over on match) doesn't textually match their own
// student_name -- lets staff spot a wrong historical match, or a case where
// this feature is disabled/incomplete, without opening each reconciliation
// screen line by line. See the "Fix Bank Reconciliation Matching Logic"
// brief, acceptance criterion on re-verifying existing matches.
function MismatchReport({ data }) {
  const [open, setOpen] = useState(false);
  const mismatches = useMemo(
    () => bankReferenceMismatches(data.collections || []),
    [data.collections]
  );
  if (!mismatches.length) return null;

  return (
    <div className="table-card recon-mismatch">
      <div className="card-heading between">
        <div>
          <h3>
            <span className="mini-tag warn">{mismatches.length}</span> possible reference mismatches
          </h3>
          <p>Fee collections whose bank reference doesn't look like the student's name.</p>
        </div>
        <button className="button secondary small" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide" : "Show"}
        </button>
      </div>
      {open && (
        <table>
          <thead>
            <tr><th>Date</th><th>Student</th><th>Amount</th><th>Bank reference</th></tr>
          </thead>
          <tbody>
            {mismatches.map((m) => (
              <tr key={m.id}>
                <td>{m.date}</td>
                <td>{m.student_name}</td>
                <td>{formatMoney(m.amount)}</td>
                <td className="desc-cell">{m.bank_reference}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
