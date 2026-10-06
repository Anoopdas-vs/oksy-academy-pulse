import React from "react";
import { formatMoney, amountInWords, tidyName } from "../lib/format.js";

// Fee receipt shown after a collection is recorded. It confirms ONE payment.
// The fee-account summary below it is informational only.
// "Print" uses the browser print dialog (also offers Save as PDF).
export default function Receipt({ receipt, onClose }) {
  const r = receipt;
  return (
    <div className="receipt-overlay" onClick={onClose}>
      <div className="receipt-modal" onClick={(e) => e.stopPropagation()}>
        <div className="receipt-actions no-print">
          <button className="button secondary" onClick={onClose}>Close</button>
          <button className="button primary" onClick={() => window.print()}>Print / Save PDF</button>
        </div>

        <div className="print-area" id="receipt-sheet">
            <div className="rcpt">
            <header className="rcpt-head">
              <img src="/oksy-logo.jpeg" alt="" className="rcpt-logo" />
              <div className="rcpt-org">
                <h2>OKSY ACADEMY LLP</h2>
                <p>33/380 C5, 2nd Floor, Indian Mall, Karuvambram,<br />Manjeri, Malappuram, Kerala 676121</p>
              </div>
              <div className="rcpt-id">
                <div className="rcpt-title">FEE RECEIPT</div>
                <div><span>No.</span> <strong>{r.receiptNo}</strong></div>
                <div><span>Date</span> <strong>{r.date}</strong></div>
              </div>
            </header>

            <section className="rcpt-party">
              <div className="rcpt-kv"><span>Received from</span><strong>{tidyName(r.student.name)}</strong></div>
              <div className="rcpt-kv"><span>Student ID</span><strong>{r.student.id}</strong></div>
              <div className="rcpt-kv"><span>Course</span><strong>{r.student.course || "—"}</strong></div>
              <div className="rcpt-kv"><span>Batch</span><strong>{r.student.batch || "—"}</strong></div>
            </section>

            <section className="rcpt-payment">
              <table>
                <thead>
                  <tr><th>Particulars</th><th>Paid to</th><th>Reference No.</th><th className="ra">Amount</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{r.type}</td>
                    <td>{r.account}</td>
                    <td>{r.reference || "—"}</td>
                    <td className="ra">{formatMoney(r.amount)}</td>
                  </tr>
                </tbody>
              </table>
              <div className="rcpt-received">
                <span>Amount Received</span>
                <strong>{formatMoney(r.amount)}</strong>
              </div>
              <div className="rcpt-words">{amountInWords(r.amount)}</div>
            </section>

            <section className="rcpt-summary">
              <div className="rcpt-summary-title">Fee account summary — for information only</div>
              <div className="rcpt-summary-grid">
                <div><span>Total fee</span><strong>{formatMoney(r.totalFee)}</strong></div>
                {r.waiver > 0 && <div><span>Waiver / write-off</span><strong>{formatMoney(r.waiver)}</strong></div>}
                <div><span>Total paid till date</span><strong>{formatMoney(r.totalPaid)}</strong></div>
                <div className="rcpt-summary-bal"><span>Balance fee</span><strong>{formatMoney(r.balance)}</strong></div>
              </div>
            </section>

            <footer className="rcpt-foot">
              <div>Received by: {tidyName(r.cashierName)}</div>
              <div className="rcpt-sign">Authorised signatory</div>
            </footer>
            <p className="rcpt-note">This is a computer-generated receipt.</p>
            </div>
        </div>
      </div>
    </div>
  );
}
