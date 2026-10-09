import React, { useEffect, useMemo, useState } from "react";
import { ErrorBanner, StatusBadge, Input, Modal } from "../components/ui.jsx";
import { formatMoney } from "../lib/format.js";
import { SearchBox, Pager } from "../components/SearchPager.jsx";
import { usePagedList } from "../lib/usePagedList.js";
import { downloadTemplate } from "../lib/templates.js";
import StudentBulkUpload from "../components/StudentBulkUpload.jsx";
import { STUDENT_BULK_HEADERS, STUDENT_BULK_SAMPLE_ROW } from "../lib/studentBulk.js";
import { GUARDIAN_RELATIONS } from "../lib/validation.js";
import { enrollmentPatchForBatch } from "../lib/batches.js";
import { studentDeleteState } from "../lib/studentId.js";
import { previewStudentId } from "../lib/data.js";

export default function EnrollmentPage({
  students,
  batches = [],
  collections = [],
  notice = "",
  canBulkUpload = false,
  onBulkApplied,
  onNew,
  onEdit,
  canDelete = false,
  onDelete,
  showForm,
  editingStudent,
  form,
  setForm,
  onCancel,
  onSave,
  saving,
  formError,
  loading = false,
}) {
  const set = (patch) => setForm({ ...form, ...patch });

  // Picking a batch pre-fills the course name and, for a new enrollment,
  // the course/registration/exam fees from the batch master. All stay
  // editable (discounts) and are saved on the student row.
  const pickBatch = (name) => {
    const b = batches.find((x) => x.name === name);
    set({ batch: name, ...enrollmentPatchForBatch(b, form, { isNew: !editingStudent }) });
  };

  // Read-only preview of the ID a new enrolment will get (the database
  // allocates the real one at save). { id } | { error } | null.
  const isNew = showForm && !editingStudent;
  // Keyed by batch so a result for a previously picked batch is ignored.
  const [fetchedPreview, setFetchedPreview] = useState(null);
  useEffect(() => {
    if (!isNew || !form.batch) return undefined;
    let stale = false;
    const batch = form.batch;
    previewStudentId(batch)
      .then((id) => !stale && setFetchedPreview({ batch, id }))
      .catch((err) => !stale && setFetchedPreview({ batch, error: err?.message || "Couldn't work out the Student ID." }));
    return () => {
      stale = true;
    };
  }, [isNew, form.batch]);
  const idPreview = !isNew || !form.batch
    ? null
    : fetchedPreview?.batch === form.batch
      ? fetchedPreview
      : { loading: true };

  const idFieldValue = editingStudent
    ? editingStudent.id
    : idPreview?.id || (idPreview?.loading ? "Working out…" : form.batch ? "—" : "Choose a batch first");

  const studentsWithReceipts = useMemo(
    () => new Set(collections.map((c) => c.student_id)),
    [collections]
  );

  const paged = usePagedList(students, {
    searchFields: ["id", "name", "course", "batch", "student_phone", "parent_name", "place"],
    pageSize: 20,
  });

  return (
    <section className="page">
      {notice && <div className="auth-message notice page-error">{notice}</div>}
      <div className="toolbar">
        <SearchBox
          value={paged.query}
          onChange={paged.setQuery}
          placeholder="Search Student ID, name, batch, course, phone or place..."
        />
        <Pager
          page={paged.page}
          totalPages={paged.totalPages}
          onPageChange={paged.setPage}
          filteredCount={paged.filteredCount}
          totalCount={paged.totalCount}
        />
        <div className="toolbar-actions">
          {canBulkUpload && (
            <>
              {/* Same headers as Reports > Students, so download -> edit -> upload round-trips. */}
              <button className="button secondary" onClick={() => downloadTemplate(
                "student_upload_template.xlsx", STUDENT_BULK_HEADERS, STUDENT_BULK_SAMPLE_ROW
              )}>
                Download Template
              </button>
              <StudentBulkUpload onApplied={onBulkApplied} />
            </>
          )}
          <button className="button primary" onClick={onNew}>+ Add Student</button>
        </div>
      </div>

      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Student ID</th><th>Batch</th><th>Name</th><th>Course</th>
              <th>Phone</th><th>Parent</th><th>Place</th>
              <th>Registration</th><th>Course Fee</th><th>Exam</th><th>Other</th>
              <th>Waiver</th><th>Status</th><th>Enrollment Date</th><th></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={15} className="table-empty">Loading students...</td>
              </tr>
            )}
            {!loading && paged.pageRows.length === 0 && (
              <tr>
                <td colSpan={15} className="table-empty">
                  {paged.query ? "No students matching your search." : "No students enrolled."}
                </td>
              </tr>
            )}
            {!loading && paged.pageRows.map((s) => (
              <tr key={s.id}>
                <td><strong className="student-id">{s.id}</strong></td>
                <td>{s.batch}</td>
                <td><strong>{s.name}</strong></td>
                <td>{s.course}</td>
                <td>{s.student_phone || "—"}</td>
                <td>{s.parent_name ? `${s.parent_name}${s.parent_phone ? ` · ${s.parent_phone}` : ""}` : "—"}</td>
                <td>{s.place || "—"}</td>
                <td>{formatMoney(s.registration_fee)}</td>
                <td>{formatMoney(s.course_fee)}</td>
                <td>{formatMoney(s.exam_fee)}</td>
                <td>{formatMoney(s.other_fee)}</td>
                <td>{formatMoney(s.waiver)}</td>
                <td><StatusBadge status={s.status} /></td>
                <td>{s.enrollment_date}</td>
                <td className="row-actions">
                  <button className="edit-button" onClick={() => onEdit(s)}>Edit</button>
                  {(() => {
                    const del = studentDeleteState(s, { isAdmin: canDelete, hasReceipts: studentsWithReceipts.has(s.id) });
                    if (!del.show) return null;
                    if (!del.allowed) {
                      // Wrapped so the reason tooltip shows (disabled buttons get no hover in some browsers).
                      return (
                        <span title={del.reason}>
                          <button className="button ghost small danger" disabled aria-label={`Delete ${s.id} — ${del.reason}`}>
                            Delete
                          </button>
                        </span>
                      );
                    }
                    return (
                      <button
                        className="button ghost small danger"
                        title="Delete this enrolment (only for a student enrolled by mistake)"
                        onClick={() => {
                          if (window.confirm(`Delete ${s.id} (${s.name})? Only for an enrolment made by mistake — this cannot be undone. For a student who left, set the status to Dropped instead.`)) {
                            onDelete(s);
                          }
                        }}
                      >
                        Delete
                      </button>
                    );
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <Modal title={editingStudent ? "Edit Student" : "New Student"} onClose={onCancel} draggable>
          <form className="form-grid" onSubmit={onSave}>
            <ErrorBanner error={formError} />
            <div className="field">
              <label>Batch</label>
              {batches.length > 0 ? (
                <select value={form.batch || ""} onChange={(e) => pickBatch(e.target.value)}>
                  <option value="">— none —</option>
                  {batches.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
                  {form.batch && !batches.some((b) => b.name === form.batch) && (
                    <option value={form.batch}>{form.batch}</option>
                  )}
                </select>
              ) : (
                <input value={form.batch} onChange={(e) => set({ batch: e.target.value })} />
              )}
            </div>
            {/* Never typed: new IDs come from the database (course code +
                next number) and existing IDs never change. */}
            <Input
              label={editingStudent ? "Student ID" : "Student ID (assigned on save)"}
              value={idFieldValue}
              onChange={() => {}}
              readOnly
              aria-readonly="true"
              title={editingStudent ? "Student IDs never change." : "Preview only — the final ID is assigned when you save."}
            />
            {isNew && idPreview?.error && <ErrorBanner error={idPreview.error} />}
            <Input label="Student Name" value={form.name} onChange={(v) => set({ name: v })} required />
            <Input label="Course" value={form.course} onChange={(v) => set({ course: v })} />
            {/* New enrollments must fill the four starred fields; students
                enrolled before they existed can be edited without them. */}
            <Input label="Student Phone" type="tel" inputMode="numeric" placeholder="10 digits" value={form.student_phone} onChange={(v) => set({ student_phone: v })} required={!editingStudent} />
            <Input label="Student Email" type="email" value={form.student_email} onChange={(v) => set({ student_email: v })} />
            <Input label="Parent Name" value={form.parent_name} onChange={(v) => set({ parent_name: v })} required={!editingStudent} />
            <Input label="Parent Phone" type="tel" inputMode="numeric" placeholder="10 digits" value={form.parent_phone} onChange={(v) => set({ parent_phone: v })} required={!editingStudent} />
            <div className="field">
              <label>Guardian Relation</label>
              <select value={form.guardian_relation || ""} onChange={(e) => set({ guardian_relation: e.target.value })}>
                <option value="">— select —</option>
                {GUARDIAN_RELATIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <Input label="Place" value={form.place} onChange={(v) => set({ place: v })} required={!editingStudent} />
            <Input label="Address" value={form.address} onChange={(v) => set({ address: v })} />
            <Input label="Date of Birth" type="date" value={form.date_of_birth} onChange={(v) => set({ date_of_birth: v })} />
            <Input label="Lead Source" placeholder="e.g. Instagram, Referral" value={form.lead_source} onChange={(v) => set({ lead_source: v })} />
            <Input label="Registration Fee" type="number" min="0" value={form.registration_fee} onChange={(v) => set({ registration_fee: v })} />
            <Input label="Course Fee" type="number" min="0" value={form.course_fee} onChange={(v) => set({ course_fee: v })} />
            <Input label="Exam Fee" type="number" min="0" value={form.exam_fee} onChange={(v) => set({ exam_fee: v })} />
            <Input label="Other Fee" type="number" min="0" value={form.other_fee} onChange={(v) => set({ other_fee: v })} />
            <Input label="Waiver" type="number" min="0" value={form.waiver} onChange={(v) => set({ waiver: v })} />
            <div className="field">
              <label>Status</label>
              {/* Status follows the batch dates (database trigger, migration 28b); the only
                  status a person can set is Dropped. Any other choice is re-derived on save. */}
              <select
                value={form.status === "Dropped" ? "Dropped" : "auto"}
                onChange={(e) => set({ status: e.target.value === "Dropped" ? "Dropped" : (form.status === "Dropped" ? "Registered" : form.status) })}
              >
                <option value="auto">Follow batch dates{form.status !== "Dropped" && form.status ? ` (now ${form.status})` : ""}</option>
                <option value="Dropped">Dropped</option>
              </select>
            </div>
            <Input label="Enrollment Date" type="date" value={form.enrollment_date} onChange={(v) => set({ enrollment_date: v })} />
            <div className="form-actions">
              <button type="button" className="button secondary" onClick={onCancel} disabled={saving}>Cancel</button>
              <button type="submit" className="button primary" disabled={saving || (isNew && !!idPreview?.error)}>
                {saving ? "Saving..." : "Save Student"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
