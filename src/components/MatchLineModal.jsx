import React, { useState } from "react";
import { Modal } from "./ui.jsx";
import LinkExistingTab from "./LinkExistingTab.jsx";
import CreateNewTab from "./CreateNewTab.jsx";
import { formatDayMonthYear } from "../lib/dates.js";

const money2 = (n) => Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The one popup behind a row's [Match] button: link the bank line to entries
// that already exist, or create a new record from it. Admin only (the page
// does not render it for anyone else; the database enforces it too).
export default function MatchLineModal({ line, account, data, students, busy, usedKeys, onClose, onLink, onCreate }) {
  const [tab, setTab] = useState("link");
  const isDeposit = Number(line.deposit) > 0;
  const amount = isDeposit ? Number(line.deposit) : Number(line.withdrawal);

  return (
    <Modal title="Match bank line" onClose={onClose} className="modal-lg">
      <div className="match-head">
        <strong>
          {formatDayMonthYear(line.txn_date)} - {isDeposit ? "CR" : "DR"} - {money2(amount)}
        </strong>
        <span className="match-desc" title={line.description}>{line.description}</span>
        <div className="subtab-switch" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "link"} className={tab === "link" ? "subtab active" : "subtab"} onClick={() => setTab("link")}>
            Link existing
          </button>
          <button type="button" role="tab" aria-selected={tab === "create"} className={tab === "create" ? "subtab active" : "subtab"} onClick={() => setTab("create")}>
            Create new
          </button>
        </div>
      </div>
      {tab === "link" ? (
        <LinkExistingTab line={line} account={account} data={data} usedKeys={usedKeys} onClose={onClose} onConfirm={onLink} />
      ) : (
        <CreateNewTab line={line} students={students} data={data} busy={busy} onClose={onClose} onSubmit={onCreate} />
      )}
    </Modal>
  );
}
