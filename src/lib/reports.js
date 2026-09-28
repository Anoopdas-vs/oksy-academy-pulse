import { inRange } from "./period.js";
import { grossFee, effectiveFeeDue, outstanding, creditBalance } from "./fees.js";
import { receiptNo, expenseCode } from "./format.js";

const sum = (rows, f = (r) => r.amount) => rows.reduce((s, r) => s + Number(f(r) || 0), 0);
const within = (rows, range) => (range ? rows.filter((r) => inRange(r.date, range)) : rows);

// Each report: { id, name, description, downloadable, build(ctx, filters) -> { columns, rows, summary } }
// columns: [{ key, label, money? }]
export const REPORTS = [
  {
    id: "pnl",
    name: "Profit & Loss",
    description: "Revenue, expenses by category, and net profit for the period.",
    downloadable: true,
    filters: [],
    build({ collections, expenses }, _f, range) {
      const rev = sum(within(collections, range));
      const exps = within(expenses, range);
      const byCat = new Map();
      exps.forEach((e) => byCat.set(e.category, (byCat.get(e.category) || 0) + Number(e.amount || 0)));
      const rows = [
        { line: "Fee collection revenue", amount: rev },
        { line: "— Less: Expenses —", amount: null },
        ...[...byCat.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([cat, amt]) => ({ line: `  ${cat}`, amount: -amt })),
        { line: "Total expenses", amount: -sum(exps) },
        { line: "Net Profit / (Loss)", amount: rev - sum(exps) },
      ];
      return {
        columns: [
          { key: "line", label: "Particulars" },
          { key: "amount", label: "Amount", money: true },
        ],
        rows,
        summary: `Revenue ${fmt(rev)} · Expense ${fmt(sum(exps))} · Net ${fmt(rev - sum(exps))}`,
      };
    },
  },

  {
    id: "fee-collection",
    name: "Fee Collection",
    description: "Every student payment in the period.",
    downloadable: true,
    filters: [
      { key: "account", label: "Account", options: ["All", "HDFC", "ICICI", "Cash", "Healthcare"] },
      { key: "type", label: "Type", options: ["All", "Registration Fee", "Course Fee", "Exam Fee", "Other Fee"] },
    ],
    build({ collections }, f, range) {
      let rows = within(collections, range);
      if (f.account && f.account !== "All") rows = rows.filter((r) => r.account === f.account);
      if (f.type && f.type !== "All") rows = rows.filter((r) => r.type === f.type);
      rows = rows
        .slice()
        .sort((a, b) => (a.date < b.date ? 1 : -1))
        .map((c) => ({
          receiptNo: c.id ? receiptNo(c.id) : "",
          studentId: c.student_id,
          studentName: c.student_name || "",
          date: c.date,
          type: c.type,
          account: c.account,
          amount: Number(c.amount || 0),
          reference: c.reference || "",
          bankReference: c.bank_reference || "",
        }));
      return {
        columns: [
          { key: "receiptNo", label: "Receipt No" },
          { key: "studentId", label: "Student ID" },
          { key: "studentName", label: "Student Name" },
          { key: "date", label: "Date" },
          { key: "type", label: "Type" },
          { key: "account", label: "Payment A/C" },
          { key: "amount", label: "Amount", money: true },
          { key: "reference", label: "Reference" },
          { key: "bankReference", label: "Bank Reference" },
        ],
        rows,
        summary: `${rows.length} payment(s) · ${fmt(sum(rows))}`,
      };
    },
  },

  {
    id: "expense-analysis",
    name: "Expense Analysis",
    description: "Expenses in the period, by category and as a list.",
    downloadable: true,
    filters: [
      { key: "account", label: "Account", options: ["All", "HDFC", "ICICI", "Cash", "Healthcare"] },
      {
        key: "category",
        label: "Category",
        options: ["All"],
        optionsFrom: (data) => ["All", ...Array.from(new Set((data.expenses || []).map((e) => e.category))).sort()],
      },
      { key: "view", label: "View", options: ["By category", "Line items"] },
    ],
    build({ expenses }, f, range) {
      let rows = within(expenses, range);
      if (f.account && f.account !== "All") rows = rows.filter((r) => r.account === f.account);
      if (f.category && f.category !== "All") rows = rows.filter((r) => r.category === f.category);

      if ((f.view || "By category") === "By category") {
        const byCat = new Map();
        rows.forEach((e) => byCat.set(e.category, (byCat.get(e.category) || 0) + Number(e.amount || 0)));
        const out = [...byCat.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([category, amount]) => ({ category, amount }));
        return {
          columns: [
            { key: "category", label: "Category" },
            { key: "amount", label: "Amount", money: true },
          ],
          rows: out,
          summary: `${out.length} categor(ies) · ${fmt(sum(out))}`,
        };
      }

      const out = rows
        .slice()
        .sort((a, b) => (a.date < b.date ? 1 : -1))
        .map((e) => ({
          expenseId: expenseCode(e.id),
          date: e.date,
          category: e.category,
          account: e.account,
          amount: Number(e.amount || 0),
          reference: e.reference || "",
          description: e.description || "",
          bankReference: e.bank_reference || "",
        }));
      return {
        columns: [
          { key: "expenseId", label: "Expense ID" },
          { key: "date", label: "Date" },
          { key: "category", label: "Category" },
          { key: "account", label: "Payment A/C" },
          { key: "amount", label: "Amount", money: true },
          { key: "reference", label: "Reference" },
          { key: "description", label: "Description" },
          { key: "bankReference", label: "Bank Reference" },
        ],
        rows: out,
        summary: `${out.length} expense(s) · ${fmt(sum(out))}`,
      };
    },
  },

  {
    id: "receivables",
    name: "Student Receivables",
    description: "Outstanding fee per student (all-time position).",
    downloadable: true,
    filters: [
      { key: "status", label: "Status", options: ["All", "Registered", "Active", "Completed", "Dropped"] },
      { key: "only", label: "Show", options: ["With balance", "With credit", "Everyone"] },
    ],
    build({ students, collections }, f) {
      const paid = collections.reduce((m, c) => {
        m[c.student_id] = (m[c.student_id] || 0) + Number(c.amount || 0);
        return m;
      }, {});
      let rows = students.map((s) => {
        const collected = paid[s.id] || 0;
        return {
          id: s.id,
          name: s.name,
          batch: s.batch || "",
          status: s.status,
          gross: grossFee(s),
          waiver: Number(s.waiver || 0),
          net: effectiveFeeDue(s, collected),
          collected,
          balance: outstanding(s, collected),
          // Display-only — the flip side of `balance`'s Math.max(0, ...)
          // clamp. Never summed into totals; flags a possible overpayment
          // or duplicate payment for someone to check.
          credit: creditBalance(s, collected),
        };
      });
      if (f.status && f.status !== "All") rows = rows.filter((r) => r.status === f.status);
      // Credit total reflects everyone matching the Status filter, regardless
      // of the Show filter below — so "outstanding" and "credit" in the
      // summary always describe the same population, not just whichever
      // subset happens to be listed in the table.
      const creditTotal = sum(rows, (r) => r.credit);
      if ((f.only || "With balance") === "With balance") rows = rows.filter((r) => r.balance > 0);
      if (f.only === "With credit") rows = rows.filter((r) => r.credit > 0);
      rows.sort((a, b) => b.balance - a.balance || b.credit - a.credit);
      return {
        columns: [
          { key: "id", label: "ID" },
          { key: "name", label: "Name" },
          { key: "batch", label: "Batch" },
          { key: "status", label: "Status" },
          { key: "net", label: "Net Fee", money: true },
          { key: "collected", label: "Collected", money: true },
          { key: "balance", label: "Balance", money: true },
          { key: "credit", label: "Credit", money: true },
        ],
        rows,
        summary:
          `${rows.length} student(s) · outstanding ${fmt(sum(rows, (r) => r.balance))}` +
          (creditTotal > 0 ? ` · credit ${fmt(creditTotal)} (review for duplicate payments)` : ""),
      };
    },
  },

  {
    id: "transfers",
    name: "Transfers",
    description: "Account-to-account movements in the period.",
    downloadable: true,
    filters: [
      { key: "account", label: "Involving", options: ["All", "HDFC", "ICICI", "Cash", "Healthcare"] },
    ],
    build({ transfers }, f, range) {
      let rows = within(transfers, range);
      if (f.account && f.account !== "All")
        rows = rows.filter((r) => r.from_account === f.account || r.to_account === f.account);
      rows = rows
        .slice()
        .sort((a, b) => (a.date < b.date ? 1 : -1))
        .map((t) => ({
          date: t.date,
          from: t.from_account,
          to: t.to_account,
          purpose: t.purpose || "",
          reference: t.reference || "",
          bankReference: t.bank_reference || "",
          amount: Number(t.amount || 0),
        }));
      return {
        columns: [
          { key: "date", label: "Date" },
          { key: "from", label: "From" },
          { key: "to", label: "To" },
          { key: "purpose", label: "Purpose" },
          { key: "reference", label: "Reference" },
          { key: "bankReference", label: "Bank Reference" },
          { key: "amount", label: "Amount", money: true },
        ],
        rows,
        summary: `${rows.length} transfer(s) · ${fmt(sum(rows))}`,
      };
    },
  },

  {
    id: "intercompany",
    name: "Inter-company (Healthcare)",
    description: "Everything routed through the Healthcare clearing account.",
    downloadable: true,
    filters: [],
    build({ collections, expenses, transfers }, _f, range) {
      const c = within(collections, range).filter((r) => r.account === "Healthcare");
      const e = within(expenses, range).filter((r) => r.account === "Healthcare");
      const t = within(transfers, range).filter(
        (r) => r.from_account === "Healthcare" || r.to_account === "Healthcare"
      );
      const rows = [
        ...c.map((r) => ({ date: r.date, kind: "Fee via Healthcare", detail: r.student_name, amount: Number(r.amount) })),
        ...e.map((r) => ({ date: r.date, kind: "Expense paid by Healthcare", detail: r.category, amount: -Number(r.amount) })),
        ...t.map((r) => ({
          date: r.date,
          kind: r.to_account === "Healthcare" ? "Repayment to Healthcare" : "Healthcare funded account",
          detail: `${r.from_account} → ${r.to_account}`,
          amount: r.to_account === "Healthcare" ? Number(r.amount) : -Number(r.amount),
        })),
      ].sort((a, b) => (a.date < b.date ? 1 : -1));
      const net = sum(rows);
      return {
        columns: [
          { key: "date", label: "Date" },
          { key: "kind", label: "Movement" },
          { key: "detail", label: "Detail" },
          { key: "amount", label: "Effect on Healthcare", money: true },
        ],
        rows,
        summary:
          net >= 0
            ? `Healthcare owes Academy ${fmt(net)}`
            : `Academy owes Healthcare ${fmt(-net)}`,
      };
    },
  },
];

function fmt(n) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);
}

// `xlsx` (~140 kB gzipped) is loaded on demand — only when the user clicks
// "Download Excel" — so it stays out of the initial app bundle.
export async function exportReportToXlsx(fileName, columns, rows) {
  try {
    const XLSX = await import("xlsx");
    const header = columns.map((c) => c.label);
    const body = rows.map((r) => columns.map((c) => (r[c.key] === null || r[c.key] === undefined ? "" : r[c.key])));
    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Report");
    XLSX.writeFile(wb, fileName);
  } catch (err) {
    alert(`Could not build the Excel file: ${err?.message || err}`);
  }
}
