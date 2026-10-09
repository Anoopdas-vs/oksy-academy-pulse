import { inRange } from "./period.js";
import { expenseCode } from "./format.js";
import { STUDENT_BULK_COLUMNS } from "./studentBulk.js";
import { pnlReport, monthlyReport, cashBankReport, accountWiseReport } from "./financeReports.js";
import { batchSummaryReport, feeRegisterReport, studentDuesReport, categoryMonthReport } from "./feeReports.js";

const sum = (rows, f = (r) => r.amount) => rows.reduce((s, r) => s + Number(f(r) || 0), 0);
const within = (rows, range) => (range ? rows.filter((r) => inRange(r.date, range)) : rows);

// Each report: { id, name, description, downloadable, build(ctx, filters) -> { columns, rows, summary } }
// columns: [{ key, label, money? }]
export const REPORTS = [
  accountWiseReport,
  pnlReport,
  monthlyReport,
  cashBankReport,
  batchSummaryReport,
  feeRegisterReport,
  studentDuesReport,
  categoryMonthReport,

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
    // Admin-only (not in STAFF_REPORT_IDS): bulk contact details. Its column
    // labels are the upload template (studentBulk.js) — edit, then Upload
    // Excel on the Enrollment page. Not period-filtered: it is a roster.
    id: "students",
    name: "Students",
    description: "Full student roster with contact details and fees. Same columns as the Enrollment upload template.",
    downloadable: true,
    sortable: true,
    filters: [
      { key: "course", label: "Course", optionsFrom: ({ students }) => ["All", ...uniqueSorted(students.map((s) => s.course))] },
      { key: "batch", label: "Batch", optionsFrom: ({ students }) => ["All", ...uniqueSorted(students.map((s) => s.batch))] },
      { key: "status", label: "Status", options: ["All", "Registered", "Active", "Completed", "Dropped"] },
    ],
    build({ students }, f) {
      let list = students;
      if (f.course && f.course !== "All") list = list.filter((s) => s.course === f.course);
      if (f.batch && f.batch !== "All") list = list.filter((s) => s.batch === f.batch);
      if (f.status && f.status !== "All") list = list.filter((s) => s.status === f.status);
      const rows = list
        .map((s) => Object.fromEntries(STUDENT_BULK_COLUMNS.map((c) => [c.key, s[c.key] ?? (c.money ? 0 : "")])))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return { columns: STUDENT_BULK_COLUMNS, rows, summary: `${rows.length} student(s)` };
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

function uniqueSorted(values) {
  return [...new Set(values.filter((v) => v && String(v).trim()))].sort((a, b) => String(a).localeCompare(String(b)));
}

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
