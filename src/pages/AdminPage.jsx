import React, { useMemo, useState } from "react";
import { ErrorBanner, Input, Modal } from "../components/ui.jsx";
import { formatMoney } from "../lib/format.js";
import StaffAccess from "../components/StaffAccess.jsx";
import {
  ALL_AREAS,
  CONFIGURABLE_ROLES,
  ASSIGNABLE_ROLES,
  ROLE_LABEL,
  resolveRoleAreas,
} from "../lib/access.js";
import { friendlyError, normalizeCourseCode } from "../lib/validation.js";

const emptyBatch = {
  name: "",
  course_name: "",
  course_fee: "",
  start_date: "",
  end_date: "",
  duration: "",
  notes: "",
};

const emptyCourse = { code: "", name: "" };

const TAB_LABEL = { batches: "Batches", courses: "Courses", categories: "Categories", users: "Users", access: "Access" };

export default function AdminPage({
  batches,
  courses = [],
  categories,
  expenses,
  busy,
  actions,
  canManageUsers = false,
  canManageAccess = false,
  canDelete = false,
  roleAreas,
}) {
  const tabs = ["batches", "courses", "categories"];
  if (canManageUsers) tabs.push("users");
  if (canManageAccess) tabs.push("access");
  const [view, setView] = useState("batches");

  return (
    <section className="page">
      <div className="page-actions">
        <div className="subtab-switch">
          {tabs.map((v) => (
            <button
              key={v}
              className={view === v ? "subtab active" : "subtab"}
              onClick={() => setView(v)}
            >
              {TAB_LABEL[v]}
            </button>
          ))}
        </div>
      </div>

      {view === "batches" && <Batches batches={batches} busy={busy} actions={actions} canDelete={canDelete} />}
      {view === "courses" && <Courses courses={courses} busy={busy} actions={actions} canDelete={canDelete} />}
      {view === "categories" && (
        <Categories categories={categories} expenses={expenses} busy={busy} actions={actions} canDelete={canDelete} />
      )}
      {view === "users" && canManageUsers && <Users busy={busy} actions={actions} />}
      {view === "access" && canManageAccess && (
        <AccessConfig roleAreas={roleAreas} busy={busy} onSave={actions.saveAccess} />
      )}
    </section>
  );
}

/* -------------------------------- Access -------------------------------- */

function AccessConfig({ roleAreas, busy, onSave }) {
  const base = resolveRoleAreas(roleAreas);
  const [sets, setSets] = useState(() =>
    Object.fromEntries(CONFIGURABLE_ROLES.map((r) => [r, new Set(base[r] || [])]))
  );
  const [msg, setMsg] = useState("");

  const toggle = (role, area) => {
    setSets((prev) => {
      const next = new Set(prev[role]);
      if (next.has(area)) next.delete(area);
      else next.add(area);
      return { ...prev, [role]: next };
    });
  };

  return (
    <div className="table-card access-card">
      <div className="card-heading">
        <div>
          <h3>Access Areas</h3>
          <p>Which sections each role can open. The Owner always sees everything.</p>
        </div>
      </div>
      <div className="access-body">
        {CONFIGURABLE_ROLES.map((role) => (
          <div className="access-row" key={role}>
            <div className="access-role">{ROLE_LABEL[role]}</div>
            <div className="access-areas">
              {ALL_AREAS.map((a) => (
                <label key={a} className={`access-chip ${sets[role].has(a) ? "on" : ""}`}>
                  <input
                    type="checkbox"
                    checked={sets[role].has(a)}
                    onChange={() => toggle(role, a)}
                  />
                  {a}
                </label>
              ))}
            </div>
          </div>
        ))}
        {msg && <div className="auth-message notice">{msg}</div>}
        <button
          className="button primary"
          disabled={busy}
          onClick={async () => {
            const payload = {
              _v: 2,
              ...Object.fromEntries(
                CONFIGURABLE_ROLES.map((r) => [r, [...sets[r]]])
              ),
            };
            await onSave(payload);
            setMsg("Saved. Users see the change on their next page load.");
          }}
        >
          {busy ? "Saving..." : "Save access"}
        </button>
      </div>
    </div>
  );
}

/* -------------------------------- Batches -------------------------------- */

function Batches({ batches, busy, actions, canDelete }) {
  const [form, setForm] = useState(emptyBatch);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  const set = (patch) => setForm({ ...form, ...patch });

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.name.trim()) return setError("Batch name is required.");
    const payload = {
      name: form.name.trim(),
      course_name: form.course_name.trim(),
      course_fee: Number(form.course_fee || 0),
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      duration: form.duration.trim(),
      notes: form.notes.trim(),
    };
    try {
      if (editing) await actions.editBatch(editing, payload);
      else await actions.addBatch(payload);
      setForm(emptyBatch);
      setEditing(null);
    } catch (err) {
      setError(err.message || "Could not save the batch.");
    }
  };

  const startEdit = (b) => {
    setEditing(b.id);
    setForm({
      name: b.name || "",
      course_name: b.course_name || "",
      course_fee: b.course_fee ?? "",
      start_date: b.start_date || "",
      end_date: b.end_date || "",
      duration: b.duration || "",
      notes: b.notes || "",
    });
  };

  return (
    <div className="two-column">
      <div className="form-card">
        <h3>{editing ? "Edit Batch" : "New Batch"}</h3>
        <form onSubmit={submit}>
          <ErrorBanner error={error} />
          <Input label="Batch name" value={form.name} onChange={(v) => set({ name: v })} required />
          <Input label="Course name" value={form.course_name} onChange={(v) => set({ course_name: v })} />
          <div className="field-row">
            <Input label="Course fee" type="number" min="0" value={form.course_fee} onChange={(v) => set({ course_fee: v })} />
            <Input label="Duration" placeholder="e.g. 6 months" value={form.duration} onChange={(v) => set({ duration: v })} />
          </div>
          <div className="field-row">
            <Input label="Start date" type="date" value={form.start_date} onChange={(v) => set({ start_date: v })} />
            <Input label="End date" type="date" value={form.end_date} onChange={(v) => set({ end_date: v })} />
          </div>
          <Input label="Notes" value={form.notes} onChange={(v) => set({ notes: v })} />
          <div className="form-actions">
            {editing && (
              <button type="button" className="button secondary" onClick={() => { setEditing(null); setForm(emptyBatch); }}>
                Cancel
              </button>
            )}
            <button className="button primary" type="submit" disabled={busy}>
              {busy ? "Saving..." : editing ? "Update Batch" : "Add Batch"}
            </button>
          </div>
        </form>
      </div>

      <div className="table-card">
        <div className="card-heading"><div><h3>Batches</h3><p>Used to pre-fill course &amp; fee at enrolment</p></div></div>
        <table>
          <thead>
            <tr><th>Name</th><th>Course</th><th>Fee</th><th>Start</th><th>End</th><th>Duration</th><th></th></tr>
          </thead>
          <tbody>
            {batches.length === 0 && <tr><td colSpan={7} className="table-empty">No batches yet.</td></tr>}
            {batches.map((b) => (
              <tr key={b.id}>
                <td><strong>{b.name}</strong></td>
                <td>{b.course_name}</td>
                <td>{formatMoney(b.course_fee)}</td>
                <td>{b.start_date || "—"}</td>
                <td>{b.end_date || "—"}</td>
                <td>{b.duration}</td>
                <td className="row-actions">
                  {canDelete && (
                    <button className="button secondary small" onClick={() => startEdit(b)}>Edit</button>
                  )}
                  {canDelete && (
                    <button
                      className="button ghost small danger"
                      onClick={() => {
                        if (window.confirm(`Delete batch "${b.name}"? Students already enrolled keep their batch label.`)) {
                          actions.removeBatch(b.id);
                        }
                      }}
                    >
                      Delete
                    </button>
                  )}
                  {!canDelete && <span className="muted-hint">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* -------------------------------- Courses -------------------------------- */

function Courses({ courses, busy, actions, canDelete }) {
  const [form, setForm] = useState(emptyCourse);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  const set = (patch) => setForm({ ...form, ...patch });

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    const code = normalizeCourseCode(form.code);
    // Code is nullable in the database (migration 23) for courses that
    // predate it, but every course created from here must have one.
    if (!code && !editing) return setError("Course code is required.");
    if (!form.name.trim()) return setError("Course name is required.");
    const payload = { code: code || null, name: form.name.trim() };
    try {
      if (editing) await actions.editCourse(editing, payload);
      else await actions.addCourse(payload);
      setForm(emptyCourse);
      setEditing(null);
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  const startEdit = (c) => {
    setEditing(c.id);
    setForm({ code: c.code || "", name: c.name || "" });
  };

  return (
    <div className="two-column">
      <div className="form-card">
        <h3>{editing ? "Edit Course" : "New Course"}</h3>
        <form onSubmit={submit}>
          <ErrorBanner error={error} />
          <Input
            label="Course Code"
            placeholder="e.g. DBHM"
            value={form.code}
            onChange={(v) => set({ code: v.toUpperCase() })}
            required={!editing}
          />
          <Input label="Course name" value={form.name} onChange={(v) => set({ name: v })} required />
          <div className="form-actions">
            {editing && (
              <button type="button" className="button secondary" onClick={() => { setEditing(null); setForm(emptyCourse); }}>
                Cancel
              </button>
            )}
            <button className="button primary" type="submit" disabled={busy}>
              {busy ? "Saving..." : editing ? "Update Course" : "Add Course"}
            </button>
          </div>
        </form>
      </div>

      <div className="table-card">
        <div className="card-heading"><div><h3>Courses</h3><p>Short course codes used across the academy</p></div></div>
        <table>
          <thead>
            <tr><th>Code</th><th>Name</th><th></th></tr>
          </thead>
          <tbody>
            {courses.length === 0 && <tr><td colSpan={3} className="table-empty">No courses yet.</td></tr>}
            {courses.map((c) => (
              <tr key={c.id}>
                <td><strong>{c.code || "—"}</strong></td>
                <td>{c.name}</td>
                <td className="row-actions">
                  {canDelete && (
                    <button className="button secondary small" onClick={() => startEdit(c)}>Edit</button>
                  )}
                  {canDelete && (
                    <button
                      className="button ghost small danger"
                      onClick={() => {
                        if (window.confirm(`Delete course "${c.code || c.name}"?`)) {
                          actions.removeCourse(c.id);
                        }
                      }}
                    >
                      Delete
                    </button>
                  )}
                  {!canDelete && <span className="muted-hint">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------ Categories ------------------------------ */

function Categories({ categories, expenses, busy, actions, canDelete }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [merge, setMerge] = useState(null); // category being merged FROM

  const usage = useMemo(() => {
    const m = {};
    expenses.forEach((e) => { m[e.category] = (m[e.category] || 0) + 1; });
    return m;
  }, [expenses]);

  const add = async (e) => {
    e.preventDefault();
    setError("");
    if (!name.trim()) return;
    if (categories.some((c) => c.name.toLowerCase() === name.trim().toLowerCase()))
      return setError("That category already exists.");
    try {
      await actions.addCategory(name.trim());
      setName("");
    } catch (err) {
      setError(err.message || "Could not add.");
    }
  };

  return (
    <div className="two-column">
      <div className="form-card">
        <h3>Add Category</h3>
        <form onSubmit={add}>
          <ErrorBanner error={error} />
          <Input label="Category name" value={name} onChange={setName} required />
          <button className="button primary full" type="submit" disabled={busy}>
            {busy ? "Saving..." : "Add Category"}
          </button>
        </form>
        <div className="info-box">
          <strong>Merge</strong>
          <span>Merging moves every expense from one category to another, then removes the empty one.</span>
        </div>
      </div>

      <div className="table-card">
        <div className="card-heading"><div><h3>Expense Categories</h3><p>Shown in the Expenses form</p></div></div>
        <table>
          <thead><tr><th>Name</th><th>Used by</th><th></th></tr></thead>
          <tbody>
            {categories.length === 0 && <tr><td colSpan={3} className="table-empty">No categories.</td></tr>}
            {categories.map((c) => (
              <tr key={c.id}>
                <td><strong>{c.name}</strong></td>
                <td>{usage[c.name] || 0} expense(s)</td>
                <td className="row-actions">
                  {canDelete && (
                    <button className="button secondary small" onClick={() => setMerge(c)}>Merge</button>
                  )}
                  {canDelete && (
                    <button
                      className="button ghost small danger"
                      onClick={() => {
                        if ((usage[c.name] || 0) > 0) {
                          alert("This category is in use. Merge it into another instead of deleting.");
                          return;
                        }
                        if (window.confirm(`Delete category "${c.name}"?`)) actions.removeCategory(c.id);
                      }}
                    >
                      Delete
                    </button>
                  )}
                  {!canDelete && <span className="muted-hint">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {merge && (
        <Modal title={`Merge "${merge.name}" into…`} onClose={() => setMerge(null)}>
          <div className="form-grid">
            <p>Every expense currently in <strong>{merge.name}</strong> ({usage[merge.name] || 0}) will move to the category you pick, and <strong>{merge.name}</strong> will be removed.</p>
            <div className="merge-options">
              {categories.filter((c) => c.id !== merge.id).map((c) => (
                <button
                  key={c.id}
                  className="button secondary"
                  disabled={busy}
                  onClick={async () => {
                    await actions.mergeCategory(merge.id, merge.name, c.name);
                    setMerge(null);
                  }}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* -------------------------------- Users -------------------------------- */

const emptyUser = { full_name: "", email: "", password: "", role: "staff", can_view_financials: false };

function Users({ busy, actions }) {
  const [form, setForm] = useState(emptyUser);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const set = (patch) => setForm({ ...form, ...patch });

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setMsg("");
    if (!form.email.trim() || form.password.length < 8) {
      return setError("Email and a password of at least 8 characters are required.");
    }
    try {
      await actions.createUser({
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        password: form.password,
        role: form.role,
        can_view_financials: form.role === "admin" ? true : form.can_view_financials,
        is_approved: true,
      });
      setMsg(`Created ${form.email}. Share the password with them; they can change it after signing in.`);
      setForm(emptyUser);
    } catch (err) {
      setError(err.message || "Could not create user account. Please check the email and password.");
    }
  };

  return (
    <div className="admin-users">
      <div className="form-card">
        <h3>Create Login</h3>
        <form onSubmit={submit}>
          <ErrorBanner error={error} />
          {msg && <div className="auth-message notice">{msg}</div>}
          <Input label="Full name" value={form.full_name} onChange={(v) => set({ full_name: v })} />
          <Input label="Email" type="email" value={form.email} onChange={(v) => set({ email: v })} required />
          <Input label="Temporary password" value={form.password} onChange={(v) => set({ password: v })} required />
          <div className="field-row">
            <div className="field">
              <label>Role</label>
              <select value={form.role} onChange={(e) => set({ role: e.target.value })}>
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                ))}
              </select>
            </div>
            <label className="permission-toggle">
              <input
                type="checkbox"
                disabled={form.role === "admin"}
                checked={form.role === "admin" ? true : form.can_view_financials}
                onChange={(e) => set({ can_view_financials: e.target.checked })}
              />
              <span>Can view financials</span>
            </label>
          </div>
          <button className="button primary full" type="submit" disabled={busy}>
            {busy ? "Creating..." : "Create Login"}
          </button>
        </form>
      </div>

      <StaffAccess />
    </div>
  );
}
