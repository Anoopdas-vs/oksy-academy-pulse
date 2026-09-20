import React, { useState } from "react";
import { ErrorBanner, Input, LockedValue, Modal } from "../components/ui.jsx";
import { formatMoney, receiptNo } from "../lib/format.js";
import { SearchBox, Pager } from "../components/SearchPager.jsx";
import { usePagedList } from "../lib/usePagedList.js";
import { downloadTemplate } from "../lib/templates.js";
import { outstanding as outstandingFor, creditBalance as creditFor } from "../lib/fees.js";
import StudentPicker from "../components/StudentPicker.jsx";

const ACCOUNTS = ["HDFC", "ICICI", "Cash", "Healthcare"];
const TYPES = ["Registration Fee", "Course Fee", "Exam Fee", "Other Fee"];

export default function FeeCollectionPage({
  students,
  collections,
  allCollections = collections,
  periodLabel = "All time",
  form,
  setForm,
  onSubmit,
  onEdit,
  onDelete,
  onFileSelected,
  canEdit = false,
  canDelete = false,
  saving,
  formError,
  loading = false,
}) {
  const set = (patch) => setForm({ ...form, ...patch });
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const showActions = canEdit || canDelete;
  const paged = usePagedList(collections, {
    searchFields: ["student_id", "student_name", "type", "reference"],
    pageSize: 20,
  });

  // Outstanding balances are always all-time, even when the list is filtered
  // to a period by the top-bar date filter.
  const paidByStudent = (studentId) =>
    allCollections
      .filter((c) => c.student_id === studentId)
      .reduce((sum, c) => sum + Number(c.amount || 0), 0);

  const matchedStudent = students.find(
    (s) =>
      s.id === form.studentId ||
      s.name.toLowerCase() === form.studentId.toLowerCase()
  );
  const outstandingForMatched = matchedStudent
    ? outstandingFor(matchedStudent, paidByStudent(matchedStudent.id))
    : null;
  const creditForMatched = matchedStudent
    ? creditFor(matchedStudent, paidByStudent(matchedStudent.id))
    : 0;

  return (
    <section className="page">
      <div className="page-actions">
        <button className="button secondary" onClick={() => downloadTemplate(
          "fee_collection_template.xlsx",
          ["Receipt No", "Student ID", "Date", "Type", "Payment A/C", "Amount", "Reference"],
          ["", "DBHM001", "2026-06-01", "Course Fee", "HDFC", 20000, "HDFC-002"]
        )}>
          Download Template
        </button>
        <label className="button secondary">
          Import Excel
          <input type="file" accept=".xlsx,.xls,.csv" onChange={onFileSelected} hidden />
        </label>
      </div>

      <div className="two-column">
        <div className="form-card">
          <h3>New Fee Collection</h3>
          <form onSubmit={onSubmit}>
            <ErrorBanner error={formError} />
            <div className="field">
              <label>Student</label>
              <StudentPicker
                students={students}
                value={form.studentId}
                onChange={(v) => set({ studentId: v })}
                required
              />
            </div>
            {form.studentId && (
              <div className="info-box">
                {matchedStudent ? (
                  <>
                    <strong>{matchedStudent.name}</strong>
                    <span>Outstanding balance: {formatMoney(outstandingForMatched)}</span>
                    {creditForMatched > 0 && (
                      <span className="amount-positive">
                        Credit balance: {formatMoney(creditForMatched)} (paid more than the fee due — check for a duplicate payment)
                      </span>
                    )}
                  </>
                ) : (
                  <span>No matching student found for "{form.studentId}"</span>
                )}
              </div>
            )}
            <div className="field-row">
              <Input label="Date" type="date" value={form.date} onChange={(v) => set({ date: v })} required />
              <div className="field">
                <label>Type</label>
                <select value={form.type} onChange={(e) => set({ type: e.target.value })}>
                  <option>Registration Fee</option>
                  <option>Course Fee</option>
                  <option>Exam Fee</option>
                  <option>Other Fee</option>
                </select>
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Payment A/C</label>
                <select value={form.account} onChange={(e) => set({ account: e.target.value })}>
                  <option>HDFC</option>
                  <option>ICICI</option>
                  <option>Cash</option>
                  <option>Healthcare</option>
                </select>
              </div>
              <Input label="Amount" type="number" min="0.01" step="0.01" value={form.amount} onChange={(v) => set({ amount: v })} required />
            </div>
            <Input label="Reference No." value={form.reference} onChange={(v) => set({ reference: v })} />
            <div className="info-box">
              {form.account === "Healthcare" ? (
                <>
                  <strong>Inter-company collection</strong>
                  <span>Academy Revenue + Receivable from Healthcare (no Academy bank movement)</span>
                </>
              ) : (
                <>
                  <strong>Direct Academy collection</strong>
                  <span>Academy Revenue + {form.account} balance increase</span>
                </>
              )}
            </div>
            <button className="button primary full" type="submit" disabled={saving}>
              {saving ? "Saving..." : "Record Collection"}
            </button>
          </form>
        </div>

        <div className="table-card">
          <div className="card-heading">
            <div><h3>Payment History</h3><p>Student-wise payments · showing {periodLabel}</p></div>
          </div>
          <div className="toolbar">
            <SearchBox
              value={paged.query}
              onChange={paged.setQuery}
              placeholder="Search student ID, name, type..."
            />
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
                <th>Receipt</th><th>Date</th><th>Student</th><th>Type</th>
                <th>A/C</th>
                <th>Amount</th><th>Outstanding</th><th>Credit</th>{showActions && <th></th>}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={showActions ? 9 : 8} className="table-empty">Loading collections...</td>
                </tr>
              )}
              {!loading && paged.pageRows.length === 0 && (
                <tr>
                  <td colSpan={showActions ? 9 : 8} className="table-empty">
                    {paged.query ? "No fee collections matching your search." : "No collections in this period."}
                  </td>
                </tr>
              )}
              {!loading && paged.pageRows.map((item) => {
                const student = students.find((s) => s.id === item.student_id);
                const paidForItemStudent = paidByStudent(item.student_id);
                const outstanding = student
                  ? outstandingFor(student, paidForItemStudent)
                  : 0;
                const credit = student
                  ? creditFor(student, paidForItemStudent)
                  : 0;

                return (
                  <tr key={item.id}>
                    <td><span className="student-id">{item.id ? receiptNo(item.id) : "—"}</span></td>
                    <td>{item.date}</td>
                    <td><strong>{item.student_name}</strong><small className="table-sub">{item.student_id}</small></td>
                    <td>{item.type}</td>
                    <td>
                      {item.account ? (
                        item.account === "Healthcare" ? (
                          <span className="mini-tag purple">Healthcare</span>
                        ) : (
                          item.account
                        )
                      ) : (
                        <LockedValue />
                      )}
                    </td>
                    <td className="amount-positive">{formatMoney(item.amount)}</td>
                    <td>{formatMoney(outstanding)}</td>
                    <td>
                      {credit > 0 ? (
                        <span className="amount-positive">{formatMoney(credit)}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    {showActions && (
                      <td className="row-actions">
                        {canEdit && (
                          <button className="button secondary small" onClick={() => setEditing(item)}>Edit</button>
                        )}
                        {canDelete && (
                          <button
                            className="button ghost small danger"
                            onClick={() => {
                              if (window.confirm(`Delete ${receiptNo(item.id)} (${formatMoney(item.amount)})? This changes the student's balance.`)) {
                                onDelete(item.id);
                              }
                            }}
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <Modal title={`Edit ${receiptNo(editing.id)}`} onClose={() => setEditing(null)}>
          <EditCollectionForm
            row={editing}
            busy={busy}
            onCancel={() => setEditing(null)}
            onSave={async (patch) => {
              setBusy(true);
              try {
                await onEdit(editing.id, patch);
                setEditing(null);
              } finally {
                setBusy(false);
              }
            }}
          />
        </Modal>
      )}
    </section>
  );
}

function EditCollectionForm({ row, busy, onCancel, onSave }) {
  const [f, setF] = useState({
    date: row.date,
    type: row.type,
    account: row.account || "HDFC",
    amount: row.amount,
    reference: row.reference || "",
  });
  const set = (p) => setF({ ...f, ...p });
  return (
    <form className="form-grid" onSubmit={(e) => { e.preventDefault(); onSave(f); }}>
      <Input label="Date" type="date" value={f.date} onChange={(v) => set({ date: v })} required />
      <div className="field">
        <label>Type</label>
        <select value={f.type} onChange={(e) => set({ type: e.target.value })}>
          {[...new Set([f.type, ...TYPES])].map((t) => <option key={t}>{t}</option>)}
        </select>
      </div>
      <div className="field">
        <label>Payment A/C</label>
        <select value={f.account} onChange={(e) => set({ account: e.target.value })}>
          {ACCOUNTS.map((a) => <option key={a}>{a}</option>)}
        </select>
      </div>
      <Input label="Amount" type="number" min="0.01" step="0.01" value={f.amount} onChange={(v) => set({ amount: v })} required />
      <Input label="Reference No." value={f.reference} onChange={(v) => set({ reference: v })} />
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="button primary" disabled={busy}>{busy ? "Saving..." : "Save changes"}</button>
      </div>
    </form>
  );
}
