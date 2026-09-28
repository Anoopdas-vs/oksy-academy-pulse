import React from "react";
import { ErrorBanner, StatusBadge, Input, Modal } from "../components/ui.jsx";
import { formatMoney } from "../lib/format.js";
import { SearchBox, Pager } from "../components/SearchPager.jsx";
import { usePagedList } from "../lib/usePagedList.js";
import { downloadTemplate } from "../lib/templates.js";
import { GUARDIAN_RELATIONS } from "../lib/validation.js";
import { enrollmentPatchForBatch } from "../lib/batches.js";

export default function EnrollmentPage({
  students,
  batches = [],
  onFileSelected,
  onNew,
  onEdit,
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
  const paged = usePagedList(students, {
    searchFields: ["id", "name", "course", "batch", "student_phone", "parent_name", "place"],
    pageSize: 20,
  });

  return (
    <section className="page">
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
          <button className="button secondary" onClick={() => downloadTemplate(
            "student_enrollment_template.xlsx",
            ["Student ID", "Batch", "Name", "Course", "Registration Fee", "Course Fee", "Exam Fee", "Other Fee", "Waiver", "Status", "Enrollment Date"],
            ["DBHM002", "2026-B", "Jane Doe", "Hospital Administration", 5000, 45000, 2000, 0, 0, "Registered", "2026-06-01"]
          )}>
            Download Template
          </button>
          <label className="button secondary">
            Import Excel
            <input type="file" accept=".xlsx,.xls,.csv" onChange={onFileSelected} hidden />
          </label>
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
                <td><button className="edit-button" onClick={() => onEdit(s)}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <Modal title={editingStudent ? "Edit Student" : "New Student"} onClose={onCancel} draggable>
          <form className="form-grid" onSubmit={onSave}>
            <ErrorBanner error={formError} />
            <Input label="Student ID" value={form.id} onChange={(v) => set({ id: v })} required />
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
              <select value={form.status} onChange={(e) => set({ status: e.target.value })}>
                <option>Registered</option>
                <option>Active</option>
                <option>Completed</option>
                <option>Dropped</option>
              </select>
            </div>
            <Input label="Enrollment Date" type="date" value={form.enrollment_date} onChange={(v) => set({ enrollment_date: v })} />
            <div className="form-actions">
              <button type="button" className="button secondary" onClick={onCancel} disabled={saving}>Cancel</button>
              <button type="submit" className="button primary" disabled={saving}>
                {saving ? "Saving..." : "Save Student"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
