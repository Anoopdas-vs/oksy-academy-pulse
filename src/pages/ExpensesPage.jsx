import React, { useState } from "react";
import { ErrorBanner, Input, Modal } from "../components/ui.jsx";
import { formatMoney, expenseCode } from "../lib/format.js";
import { SearchBox, Pager } from "../components/SearchPager.jsx";
import { usePagedList } from "../lib/usePagedList.js";
import { downloadTemplate } from "../lib/templates.js";

const FALLBACK_CATEGORIES = [
  "Rent", "Salary", "Commission", "Electricity", "Internet",
  "Marketing", "Office Expense", "Travel", "Bank Charge", "Other",
];
const ACCOUNTS = ["HDFC", "ICICI", "Cash", "Healthcare"];

export default function ExpensesPage({
  expenses,
  categories = [],
  periodLabel = "All time",
  form,
  setForm,
  onSubmit,
  onEdit,
  onDelete,
  onFileSelected,
  canEdit = true,
  canDelete = false,
  saving,
  formError,
  loading = false,
}) {
  const showActions = canEdit || canDelete;
  const set = (patch) => setForm({ ...form, ...patch });
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const catNames = categories.length ? categories.map((c) => c.name) : FALLBACK_CATEGORIES;
  const paged = usePagedList(expenses, {
    searchFields: ["category", "account", "description", "reference"],
    pageSize: 20,
  });

  return (
    <section className="page">
      <div className="page-actions">
        <button className="button secondary" onClick={() => downloadTemplate(
          "expense_template.xlsx",
          ["Expense ID", "Date", "Category", "Payment A/C", "Amount", "Reference", "Description"],
          ["", "2026-06-01", "Rent", "HDFC", 25000, "RENT-002", "Monthly rent"]
        )}>
          Download Template
        </button>
        <label className="button secondary">
          Import Expenses
          <input type="file" accept=".xlsx,.xls,.csv" onChange={onFileSelected} hidden />
        </label>
      </div>

      <div className="two-column">
        <div className="form-card">
            <h3>New Expense</h3>
            <form onSubmit={onSubmit}>
              <ErrorBanner error={formError} />
              <Input label="Date" type="date" value={form.date} onChange={(v) => set({ date: v })} required />
              <div className="field">
                <label>Category</label>
                <select value={form.category} onChange={(e) => set({ category: e.target.value })}>
                  {catNames.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Payment A/C</label>
                  <select value={form.account} onChange={(e) => set({ account: e.target.value })}>
                    {ACCOUNTS.map((a) => <option key={a}>{a}</option>)}
                  </select>
                </div>
                <Input label="Amount" type="number" min="0.01" step="0.01" value={form.amount} onChange={(v) => set({ amount: v })} required />
              </div>
              <Input label="Reference No." value={form.reference} onChange={(v) => set({ reference: v })} />
              <Input label="Description" value={form.description} onChange={(v) => set({ description: v })} />
              <div className="info-box">
                {form.account === "Healthcare" ? (
                  <>
                    <strong>Inter-company expense</strong>
                    <span>Academy Expense + Payable to Healthcare (no Academy bank movement)</span>
                  </>
                ) : (
                  <>
                    <strong>Direct Academy expense</strong>
                    <span>Academy Expense + {form.account} balance reduction</span>
                  </>
                )}
              </div>
              <button className="button primary full" type="submit" disabled={saving}>
                {saving ? "Saving..." : "Record Expense"}
              </button>
            </form>
        </div>

        <div className="table-card">
          <div className="card-heading">
            <div><h3>Payments</h3><p>Expense transactions · showing {periodLabel}</p></div>
          </div>
          <div className="toolbar">
            <SearchBox
              value={paged.query}
              onChange={paged.setQuery}
              placeholder="Search category, account, description..."
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
                <th>ID</th><th>Date</th><th>Category</th><th>A/C</th>
                <th>Amount</th><th>Description</th>{showActions && <th></th>}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={showActions ? 7 : 6} className="table-empty">Loading expenses...</td></tr>
              )}
              {!loading && paged.pageRows.length === 0 && (
                <tr>
                  <td colSpan={showActions ? 7 : 6} className="table-empty">
                    {paged.query ? "No expenses matching your search." : "No expenses in this period."}
                  </td>
                </tr>
              )}
              {!loading && paged.pageRows.map((e) => (
                <tr key={e.id}>
                  <td><span className="student-id">{expenseCode(e.id)}</span></td>
                  <td>{e.date}</td>
                  <td><strong>{e.category}</strong></td>
                  <td>
                    {e.account === "Healthcare"
                      ? <span className="mini-tag purple">Healthcare</span>
                      : e.account}
                  </td>
                  <td className="amount-negative">{formatMoney(e.amount)}</td>
                  <td>{e.description}</td>
                  {showActions && (
                    <td className="row-actions">
                      {canEdit && (
                        <button className="button secondary small" onClick={() => setEditing(e)}>Edit</button>
                      )}
                      {canDelete && (
                        <button
                          className="button ghost small danger"
                          onClick={() => {
                            if (window.confirm(`Delete ${expenseCode(e.id)} (${formatMoney(e.amount)})? If this was really a transfer, add it under Banking → Transfers.`)) {
                              onDelete(e.id);
                            }
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <Modal title={`Edit ${expenseCode(editing.id)}`} onClose={() => setEditing(null)}>
          <EditExpenseForm
            row={editing}
            catNames={catNames}
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

function EditExpenseForm({ row, catNames, busy, onCancel, onSave }) {
  const [f, setF] = useState({
    date: row.date,
    category: row.category,
    account: row.account,
    amount: row.amount,
    reference: row.reference || "",
    description: row.description || "",
  });
  const set = (p) => setF({ ...f, ...p });

  return (
    <form className="form-grid" onSubmit={(e) => { e.preventDefault(); onSave(f); }}>
      <Input label="Date" type="date" value={f.date} onChange={(v) => set({ date: v })} required />
      <div className="field">
        <label>Category</label>
        <select value={f.category} onChange={(e) => set({ category: e.target.value })}>
          {[...new Set([f.category, ...catNames])].map((c) => <option key={c}>{c}</option>)}
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
      <Input label="Description" value={f.description} onChange={(v) => set({ description: v })} />
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="button primary" disabled={busy}>{busy ? "Saving..." : "Save changes"}</button>
      </div>
    </form>
  );
}
