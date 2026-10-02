import React, { useState } from "react";
import { Input } from "./ui.jsx";
import StudentPicker from "./StudentPicker.jsx";
import { formatMoney } from "../lib/format.js";
import { outstanding } from "../lib/fees.js";

const ACCOUNTS = ["HDFC", "ICICI", "Cash", "Healthcare"];

// "Create new" tab of the Match popup: turns one unmatched bank line into a
// new fee collection / expense / transfer and links it (the page's
// classifyBankLine handler; behaviour unchanged).
export default function CreateNewTab({ line, students, data, busy, onClose, onSubmit }) {
  const isDeposit = Number(line.deposit) > 0;
  const amount = isDeposit ? Number(line.deposit) : Number(line.withdrawal);
  const [kind, setKind] = useState(isDeposit ? "collection" : "expense");
  const [studentId, setStudentId] = useState("");
  const [type, setType] = useState("Course Fee");
  const [category, setCategory] = useState("Bank Charge");
  const [description, setDescription] = useState(line.description || "");
  const [otherAccount, setOtherAccount] = useState(line.account === "ICICI" ? "HDFC" : "ICICI");
  const [purpose, setPurpose] = useState(line.description || (isDeposit ? "Cash deposit" : "Transfer"));

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

  const submit = (e) => {
    e.preventDefault();
    if (kind === "collection") onSubmit({ kind, studentId, type });
    else if (kind === "expense") onSubmit({ kind, category, description });
    else onSubmit({ kind, otherAccount, purpose });
  };

  return (
    <form className="match-form" onSubmit={submit}>
      <div className="modal-body">
        <div className="field">
          <label>Record as</label>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="collection">New fee collection</option>
            <option value="expense">New expense</option>
            <option value="transfer">New transfer</option>
          </select>
        </div>

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
          </>
        )}
      </div>

      <div className="modal-footer">
        <button type="button" className="button secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? "Saving..." : "Create & match"}
        </button>
      </div>
    </form>
  );
}
