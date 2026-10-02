import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ErrorBanner, Input, Modal, MetricCard } from "../components/ui.jsx";
import { formatMoney } from "../lib/format.js";
import StudentPicker from "../components/StudentPicker.jsx";
import { SearchBox, Pager } from "../components/SearchPager.jsx";
import { usePagedList } from "../lib/usePagedList.js";
import { downloadTemplate } from "../lib/templates.js";
import LinkEntryModal from "../components/LinkEntryModal.jsx";
import {
  reconciliationSummary,
  matchKindLabel,
  matchedRecordDetail,
  reviewCandidatesDetail,
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
import { outstanding } from "../lib/fees.js";

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
    searchFields: ["from_account", "to_account", "purpose", "reference", "note"],
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
                    ["Date", "From Account", "To Account", "Amount", "Purpose", "Reference", "Note"],
                    ["2026-06-01", "Cash", "ICICI", 50000, "Cash deposit", "DEP-01", ""]
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
          <SearchBox value={paged.query} onChange={paged.setQuery} placeholder="Search account, purpose, reference..." />
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
              <th>Purpose</th><th>Reference</th>{isAdmin && <th></th>}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={isAdmin ? 7 : 6} className="table-empty">Loading transfers...</td></tr>
            )}
            {!loading && paged.pageRows.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 7 : 6} className="table-empty">
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
  });
  const set = (p) => setF({ ...f, ...p });
  return (
    <form className="form-grid" onSubmit={(e) => { e.preventDefault(); onSave(f); }}>
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
  onDeleteStatement,
}) {
  const [account, setAccount] = useState("ICICI");
  const [openId, setOpenId] = useState(null);
  const [classifying, setClassifying] = useState(null); // a line row
  const [linking, setLinking] = useState(null); // { line, account } for the Link entry popup
  const [rerun, setRerun] = useState(null); // { statementId, changes } dry-run awaiting confirmation
  const [tableView, setTableView] = useState("new"); // "new" review table | "classic" table

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
                {isOpen && (
                  <div className="subtab-switch recon-view-switch" role="group" aria-label="Table view">
                    <button className={tableView === "new" ? "subtab active" : "subtab"} onClick={() => setTableView("new")}>
                      New view
                    </button>
                    <button className={tableView === "classic" ? "subtab active" : "subtab"} onClick={() => setTableView("classic")}>
                      Classic view
                    </button>
                  </div>
                )}
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

            {isOpen && tableView === "new" && (
              <ReconGrid
                lines={lines}
                allLines={bankLines}
                account={st.account}
                statement={st}
                data={data}
                isAdmin={isAdmin}
                onClassify={setClassifying}
                onLink={(ln) => setLinking({ line: ln, account: st.account })}
                onIgnoreLine={onIgnoreLine}
                onUnmatchLine={onUnmatchLine}
              />
            )}
            {isOpen && tableView === "classic" && (
              <table>
                <thead>
                  <tr>
                    <th>#</th><th>Date</th><th>Description</th>
                    <th>Withdrawal</th><th>Deposit</th><th>Status</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((ln) => (
                    <tr key={ln.id} className={ln.status === "unmatched" || ln.status === "review" ? "row-open" : ""}>
                      <td>{ln.seq}</td>
                      <td>{ln.txn_date}</td>
                      <td className="desc-cell">{ln.description}</td>
                      <td className="amount-negative">{ln.withdrawal ? formatMoney(ln.withdrawal) : ""}</td>
                      <td className="amount-positive">{ln.deposit ? formatMoney(ln.deposit) : ""}</td>
                      <td><StatusTag line={ln} data={data} students={students} /></td>
                      <td className="row-actions">
                        <LineActions
                          ln={ln}
                          isAdmin={isAdmin}
                          onClassify={setClassifying}
                          onIgnoreLine={onIgnoreLine}
                          onUnmatchLine={onUnmatchLine}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}

      {linking && (
        <LinkEntryModal
          line={linking.line}
          account={linking.account}
          data={data}
          usedKeys={linkedKeys(bankLines)}
          onClose={() => setLinking(null)}
          onConfirm={(entries) => onLinkLine(linking.line, entries)}
        />
      )}

      {classifying && (
        <ClassifyModal
          line={classifying}
          students={students}
          data={data}
          busy={busy}
          onClose={() => setClassifying(null)}
          onSubmit={async (input) => {
            try {
              await onClassifyLine(classifying, input);
              setClassifying(null);
            } catch {
              /* error is surfaced by the page-level banner */
            }
          }}
        />
      )}
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

// Classify / Resolve / Ignore / Un-ignore / Unmatch for one stored line.
// Shared by the classic table and the review table so both behave the same.
function LineActions({ ln, isAdmin, onClassify, onLink, onIgnoreLine, onUnmatchLine }) {
  if (!isAdmin) return null;
  return (
    <>
      {(ln.status === "unmatched" || ln.status === "review") && (
        <>
          <button className="button secondary small" onClick={() => onClassify(ln)}>
            {ln.status === "review" ? "Resolve" : "Classify"}
          </button>
          {onLink && (
            <button className="button secondary small" onClick={() => onLink(ln)}>
              Link entry
            </button>
          )}
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
function ReconGrid({ lines, allLines, account, statement, data, isAdmin, onClassify, onLink, onIgnoreLine, onUnmatchLine }) {
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
  const shown = filter === "book_only" ? [] : rows.filter((r) => reconRowMatchesFilter(r, filter));

  return (
    <>
      <div className="recon-chips" role="group" aria-label="Filter lines">
        {RECON_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={filter === f.key ? "recon-chip active" : "recon-chip"}
            onClick={() => setFilter(f.key)}
          >
            {f.label} <b>{counts[f.key]}</b>
          </button>
        ))}
        <button
          type="button"
          className={filter === "book_only" ? "recon-chip active" : "recon-chip"}
          onClick={() => setFilter("book_only")}
        >
          Book only <b>{bookOnly.length}</b>
        </button>
      </div>
      {filter === "book_only" ? (
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
                onClassify={onClassify}
                onLink={onLink}
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

function ReconRow({ r, isAdmin, onClassify, onLink, onIgnoreLine, onUnmatchLine }) {
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
          onClassify={onClassify}
          onLink={onLink}
          onIgnoreLine={onIgnoreLine}
          onUnmatchLine={onUnmatchLine}
        />
      </td>
    </tr>
  );
}

function StatusTag({ line, data, students }) {
  const { status } = line;
  const [tip, setTip] = useState(null); // { x, y, flip } | null

  if (status === "ignored") return <span className="mini-tag">Ignored</span>;
  if (status === "review") return <ReviewTag line={line} data={data} students={students} />;
  if (status !== "matched" && status !== "classified") {
    return <span className="mini-tag warn">Unmatched</span>;
  }

  const verb = status === "matched" ? "Matched" : "Added";
  const kindLabel = matchKindLabel(line.match_kind);
  const detail = matchedRecordDetail(line, data, students);
  const assumed = isOrderAssumed(line);

  const show = (e) => {
    if (!detail) return;
    const r = e.currentTarget.getBoundingClientRect();
    const flip = r.bottom > window.innerHeight - 200;
    // Keep the ~320px card inside the viewport when the tag sits near an edge.
    const x = Math.max(8, Math.min(r.left, window.innerWidth - 332));
    setTip({ x, y: flip ? r.top : r.bottom, flip });
  };
  const hide = () => setTip(null);

  return (
    <span
      className={`mini-tag ${assumed ? "warn" : "ok"}${detail ? " match-tag" : ""}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      tabIndex={detail ? 0 : undefined}
    >
      {verb} - {kindLabel}{assumed ? " (assumed by order)" : ""}
      {detail && tip &&
        createPortal(
          <span
            className="match-tip"
            style={{
              left: tip.x,
              top: tip.flip ? undefined : tip.y + 6,
              bottom: tip.flip ? window.innerHeight - tip.y + 6 : undefined,
            }}
          >
            <span className="match-tip-title">{detail.title}</span>
            {detail.rows.map((row) => (
              <span className="match-tip-row" key={row.k}>
                <span className="match-tip-k">{row.k}</span>
                <span className="match-tip-v">{row.v}</span>
              </span>
            ))}
          </span>,
          document.body
        )}
    </span>
  );
}

// Tag for a bank line the auto-matcher deliberately refused to guess on --
// two or more app records share the amount and land on the same date, and
// the payer-identity signal wasn't decisive enough to pick between them.
// Hovering shows the tied candidates; "Resolve" (in the row actions) opens
// the same Classify modal used for unmatched lines to confirm one by hand.
function ReviewTag({ line, data, students }) {
  const [tip, setTip] = useState(null);
  const detail = reviewCandidatesDetail(line, data, students);

  const show = (e) => {
    if (!detail) return;
    const r = e.currentTarget.getBoundingClientRect();
    const flip = r.bottom > window.innerHeight - 200;
    const x = Math.max(8, Math.min(r.left, window.innerWidth - 332));
    setTip({ x, y: flip ? r.top : r.bottom, flip });
  };
  const hide = () => setTip(null);

  return (
    <span
      className={`mini-tag warn${detail ? " match-tag" : ""}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      tabIndex={detail ? 0 : undefined}
    >
      Needs review
      {detail && tip &&
        createPortal(
          <span
            className="match-tip"
            style={{
              left: tip.x,
              top: tip.flip ? undefined : tip.y + 6,
              bottom: tip.flip ? window.innerHeight - tip.y + 6 : undefined,
            }}
          >
            <span className="match-tip-title">{detail.title}</span>
            {detail.rows.map((row, i) => (
              <span className="match-tip-row" key={`${row.k}-${i}`}>
                <span className="match-tip-k">{row.k}</span>
                <span className="match-tip-v">{row.v}</span>
              </span>
            ))}
          </span>,
          document.body
        )}
    </span>
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

function ClassifyModal({ line, students, data, busy, onClose, onSubmit }) {
  const isDeposit = Number(line.deposit) > 0;
  const amount = isDeposit ? Number(line.deposit) : Number(line.withdrawal);
  const [kind, setKind] = useState(isDeposit ? "collection" : "expense");
  const [studentId, setStudentId] = useState("");
  const [type, setType] = useState("Course Fee");
  const [category, setCategory] = useState("Bank Charge");
  const [description, setDescription] = useState(line.description || "");
  const [otherAccount, setOtherAccount] = useState(line.account === "ICICI" ? "HDFC" : "ICICI");
  const [purpose, setPurpose] = useState(line.description || (isDeposit ? "Cash deposit" : "Transfer"));
  const [linkId, setLinkId] = useState("");

  const matchedStudent = students.find(
    (s) => s.id === studentId || s.name.toLowerCase() === String(studentId).toLowerCase()
  );
  const studentBalance = matchedStudent
    ? outstanding(
        matchedStudent,
        (data.collections || [])
          .filter((c) => c.student_id === matchedStudent.id)
          .reduce((s, c) => s + Number(c.amount || 0), 0)
      )
    : null;

  // Candidate existing records to link this line to (same account, right
  // direction, unmatched), closest amount first.
  const candidates = (isDeposit
    ? (data.collections || []).filter((c) => c.account === line.account)
    : (data.expenses || []).filter((e) => e.account === line.account)
  )
    .map((r) => ({
      id: r.id,
      linkKind: isDeposit ? "collection" : "expense",
      label: isDeposit
        ? `${r.date} · ${r.student_name} · ${formatMoney(r.amount)}`
        : `${r.date} · ${r.category} · ${formatMoney(r.amount)}`,
      diff: Math.abs(Number(r.amount) - amount),
    }))
    .sort((a, b) => a.diff - b.diff)
    .slice(0, 25);

  const submit = (e) => {
    e.preventDefault();
    if (kind === "link") {
      const c = candidates.find((x) => String(x.id) === String(linkId));
      if (c) onSubmit({ kind: "link", linkKind: c.linkKind, linkId: c.id });
    } else if (kind === "collection") onSubmit({ kind, studentId, type });
    else if (kind === "expense") onSubmit({ kind, category, description });
    else onSubmit({ kind, otherAccount, purpose });
  };

  return (
    <Modal title="Classify statement line" onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <div className="classify-summary">
          <span>{line.txn_date}</span>
          <strong>{formatMoney(amount)} {isDeposit ? "in" : "out"}</strong>
          <span className="desc-cell">{line.description}</span>
        </div>

        <div className="field">
          <label>Record as</label>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="collection">New fee collection</option>
            <option value="expense">New expense</option>
            <option value="transfer">New transfer</option>
            <option value="link">Link to an existing record</option>
          </select>
        </div>

        {kind === "link" && (
          <div className="field">
            <label>Existing {isDeposit ? "fee collection" : "expense"} ({line.account})</label>
            <select value={linkId} onChange={(e) => setLinkId(e.target.value)} required>
              <option value="">— choose —</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}{c.diff === 0 ? "  ✓ exact" : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        {kind === "collection" && (
          <>
            <div className="field">
              <label>Student</label>
              <StudentPicker students={students} value={studentId} onChange={setStudentId} required />
            </div>
            <div className="field">
              <label>Type</label>
              <select value={type} onChange={(e) => setType(e.target.value)}>
                <option>Registration Fee</option>
                <option>Course Fee</option>
                <option>Exam Fee</option>
                <option>Other Fee</option>
              </select>
            </div>
            {studentId && !matchedStudent && <div className="field-error">No matching student</div>}
            {matchedStudent && (
              <div className="info-box">
                <strong>{matchedStudent.name}</strong>
                <span>
                  Outstanding now {formatMoney(studentBalance)} → after this payment{" "}
                  {formatMoney(Math.max(0, studentBalance - amount))}
                </span>
              </div>
            )}
          </>
        )}

        {kind === "expense" && (
          <>
            <Input label="Category" value={category} onChange={setCategory} required />
            <Input label="Description" value={description} onChange={setDescription} />
            <div className="info-box"><span>Account will be set to {line.account}.</span></div>
          </>
        )}

        {kind === "transfer" && (
          <>
            <div className="field">
              <label>{isDeposit ? "Money came from" : "Money went to"}</label>
              <select value={otherAccount} onChange={(e) => setOtherAccount(e.target.value)}>
                {ACCOUNTS.filter((a) => a !== line.account).map((a) => <option key={a}>{a}</option>)}
              </select>
            </div>
            <Input label="Purpose" value={purpose} onChange={setPurpose} />
            <div className="info-box">
              <span>
                {isDeposit
                  ? `Transfer ${otherAccount} → ${line.account}`
                  : `Transfer ${line.account} → ${otherAccount}`}
              </span>
            </div>
          </>
        )}

        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="button primary" disabled={busy}>
            {busy ? "Saving..." : kind === "link" ? "Match" : "Create & match"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
