// Phase 3 corporate reports: Expense Register, Fund Transfers, Healthcare
// Account Statement, Student Register. Pure functions over already-loaded
// rows (single-tenant). Shapes: see reportKit.js.
import { inRange } from "./period.js";
import { expenseCode } from "./format.js";
import { effectiveFeeDue } from "./fees.js";
import { bookBalanceAsOf, transferCode } from "./reconcile.js";
import { STUDENT_BULK_COLUMNS } from "./studentBulk.js";
import { previousRange, pctChange, share, formatReportMoney, dayBefore, dmy } from "./reportKit.js";

const amt = (v) => Number(v || 0);
const sum = (rows, f = (r) => r.amount) => rows.reduce((s, r) => s + amt(f(r)), 0);
const within = (rows, range) => (range ? rows.filter((r) => inRange(r.date, range)) : rows);
const day = (d) => String(d || "").slice(0, 10);
const BANK_ACCOUNTS = ["HDFC", "ICICI"];
const ACCOUNTS = ["Cash", "HDFC", "ICICI", "Healthcare"];
const uniqueSorted = (values) => [...new Set(values.filter((v) => v && String(v).trim()))].sort((a, b) => String(a).localeCompare(String(b)));
const more = (list, n) => (list.length > n ? ` and ${list.length - n} more` : "");

// Book ids of one kind that are linked to any bank line.
function linkedIds(bankLines, kind) {
  const set = new Set();
  (bankLines || []).forEach((l) => (l.links || []).forEach((k) => k.bookKind === kind && set.add(String(k.bookId))));
  return set;
}
const coveredBy = (statements, acct, date) =>
  (statements || []).some((s) => s.account === acct && s.period_start <= date && s.period_end >= date);

function matchStatus(matched, statements, acct, id, date) {
  if (!matched) return "";
  if (!BANK_ACCOUNTS.includes(acct)) return "n/a";
  if (matched.has(String(id))) return "Matched";
  return coveredBy(statements, acct, date) ? "Not matched" : "No statement";
}

// ---------------------------------------------------------- Expense Register
export const expenseRegisterReport = {
  id: "expense-analysis",
  name: "Expense Register",
  description: "Where the money went: by category with comparison, or every expense line with bank-match status.",
  downloadable: true,
  filters: [
    { key: "account", label: "Paid from", options: ["All", ...ACCOUNTS] },
    {
      key: "category",
      label: "Category",
      options: ["All"],
      optionsFrom: (data) => ["All", ...uniqueSorted((data.expenses || []).map((e) => e.category))],
    },
    { key: "view", label: "View", options: ["By category", "Line items"] },
  ],
  build({ expenses = [], bankLines = null, bankStatements = [] }, f, range) {
    const pick = (list) => {
      let out = list;
      if (f.account && f.account !== "All") out = out.filter((r) => r.account === f.account);
      if (f.category && f.category !== "All") out = out.filter((r) => r.category === f.category);
      return out;
    };
    const list = pick(within(expenses, range));
    const prevRange = previousRange(range);
    const prev = prevRange ? pick(within(expenses, prevRange)) : null;
    const total = sum(list);
    const cash = sum(list.filter((e) => e.account === "Cash"));
    const bank = sum(list.filter((e) => BANK_ACCOUNTS.includes(e.account)));
    const byCat = new Map();
    list.forEach((e) => {
      const k = e.category || "Uncategorised";
      const v = byCat.get(k) || { n: 0, amount: 0 };
      byCat.set(k, { n: v.n + 1, amount: v.amount + amt(e.amount) });
    });
    const top = [...byCat.entries()].sort((a, b) => b[1].amount - a[1].amount)[0];

    const matched = bankLines ? linkedIds(bankLines, "expense") : null;
    const lines = list
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.id || 0) - (a.id || 0)))
      .map((e) => {
        const match = matchStatus(matched, bankStatements, e.account, e.id, day(e.date));
        return {
          expenseId: expenseCode(e.id),
          date: day(e.date),
          category: e.category,
          description: e.description || "",
          account: e.account,
          amount: amt(e.amount),
          match,
          reference: e.reference || "",
          bankReference: e.bank_reference || "",
          _tone: match === "Not matched" ? "warn" : undefined,
        };
      });

    const exceptions = [];
    const noDesc = lines.filter((r) => !r.description.trim());
    if (noDesc.length) exceptions.push(`${noDesc.length} expense(s) have no description: ${noDesc.slice(0, 6).map((r) => r.expenseId).join(", ")}${more(noDesc, 6)}.`);
    const unmatched = lines.filter((r) => r.match === "Not matched");
    if (unmatched.length)
      exceptions.push(`${unmatched.length} bank expense(s) worth ${formatReportMoney(sum(unmatched))} are inside an uploaded statement period but not matched: ${unmatched.slice(0, 6).map((r) => r.expenseId).join(", ")}${more(unmatched, 6)}.`);
    const biggest = lines.slice().sort((a, b) => b.amount - a.amount).slice(0, 3);
    if (biggest.length && f.view === "Line items")
      exceptions.push(`Largest single expenses: ${biggest.map((r) => `${r.expenseId} ${r.category} ${formatReportMoney(r.amount)}`).join("; ")}.`);

    const kpis = [
      { label: "Total expenses", value: total, kind: "money" },
      { label: "Entries", value: lines.length, kind: "num" },
      { label: "Top category", value: top ? `${top[0]} · ${formatReportMoney(top[1].amount)}` : "–", kind: "text" },
      { label: "Cash / Bank paid", value: `${formatReportMoney(cash)} / ${formatReportMoney(bank)}`, kind: "text" },
    ];
    const lineColumns = [
      { key: "date", label: "Date", date: true },
      { key: "expenseId", label: "Expense ID" },
      { key: "category", label: "Category" },
      { key: "description", label: "Description" },
      { key: "account", label: "Payment A/C" },
      { key: "amount", label: "Amount", money: true },
      ...(matched ? [{ key: "match", label: "Bank match" }] : []),
      { key: "reference", label: "Reference" },
      { key: "bankReference", label: "Bank Reference" },
    ];
    // Excel of the line items keeps the upload-template headers (Expense ID
    // etc.), so it can be edited and re-uploaded on the Expenses page.
    const exportTable = { columns: lineColumns, rows: lines };
    const basis = "Cash basis — expenses by the date they were paid.";

    if ((f.view || "By category") === "Line items") {
      return {
        basis,
        kpis,
        tables: [{ columns: lineColumns, rows: [...lines, { _kind: "total", date: `TOTAL · ${lines.length} entr${lines.length === 1 ? "y" : "ies"}`, amount: total }] }],
        exportTable,
        exceptions,
        notes: ["Download Excel gives the plain expense list (upload-template columns), ready to edit and re-upload."],
        summary: `${lines.length} expense(s) · ${formatReportMoney(total)}`,
      };
    }

    const prevByCat = new Map();
    (prev || []).forEach((e) => {
      const k = e.category || "Uncategorised";
      prevByCat.set(k, (prevByCat.get(k) || 0) + amt(e.amount));
    });
    const cats = [...new Set([...byCat.keys(), ...prevByCat.keys()])].sort(
      (a, b) => (byCat.get(b)?.amount || 0) - (byCat.get(a)?.amount || 0) || a.localeCompare(b)
    );
    const rows = cats.map((c) => {
      const cur = byCat.get(c)?.amount || 0;
      const p = prevByCat.get(c) || 0;
      return {
        category: c,
        n: byCat.get(c)?.n || 0,
        amount: cur,
        share: share(cur, total),
        ...(prev ? { prev: p, chg: pctChange(cur, p) } : {}),
        _invert: true,
      };
    });
    const pTotal = prev ? sum(prev) : null;
    rows.push({ _kind: "total", category: "TOTAL", n: lines.length, amount: total, share: total ? 100 : null, ...(prev ? { prev: pTotal, chg: pctChange(total, pTotal) } : {}), _invert: true });

    return {
      basis,
      kpis,
      tables: [
        {
          columns: [
            { key: "category", label: "Category" },
            { key: "n", label: "Entries", num: true },
            { key: "amount", label: "Amount", money: true },
            { key: "share", label: "% of total", pct: true },
            ...(prev
              ? [
                  { key: "prev", label: "Previous period", money: true },
                  { key: "chg", label: "Change %", pct: true, change: true },
                ]
              : []),
          ],
          rows,
        },
      ],
      exceptions,
      notes: [prevRange ? `Previous period: ${dmy(prevRange.start)} to ${dmy(prevRange.end)}.` : "Choose a period to compare with the previous one."],
      summary: `${byCat.size} categor(ies) · ${formatReportMoney(total)}`,
    };
  },
};

// ------------------------------------------------------------ Fund Transfers
export const transfersReport = {
  id: "transfers",
  name: "Fund Transfers",
  description: "Money moved between Cash, HDFC, ICICI and Healthcare — a From × To summary and every transfer.",
  downloadable: true,
  filters: [{ key: "account", label: "Involving", options: ["All", ...ACCOUNTS] }],
  build({ transfers = [], bankLines = null, bankStatements = [] }, f, range) {
    let list = within(transfers, range);
    if (f.account && f.account !== "All") list = list.filter((r) => r.from_account === f.account || r.to_account === f.account);
    const matched = bankLines ? linkedIds(bankLines, "transfer") : null;

    const rows = list
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.id || 0) - (a.id || 0)))
      .map((t) => {
        const d = day(t.date);
        // A transfer touching a bank account should appear on that statement.
        const bankSide = BANK_ACCOUNTS.includes(t.from_account) ? t.from_account : BANK_ACCOUNTS.includes(t.to_account) ? t.to_account : null;
        const match = matchStatus(matched, bankStatements, bankSide, t.id, d);
        return {
          date: d,
          transferId: t.id ? transferCode(t.id) : "",
          from: t.from_account,
          to: t.to_account,
          purpose: t.purpose || "",
          amount: amt(t.amount),
          match,
          reference: t.reference || "",
          bankReference: t.bank_reference || "",
          _tone: match === "Not matched" ? "warn" : undefined,
        };
      });
    const total = sum(rows);
    const deposited = sum(rows.filter((r) => r.from === "Cash" && BANK_ACCOUNTS.includes(r.to)));
    const withdrawn = sum(rows.filter((r) => BANK_ACCOUNTS.includes(r.from) && r.to === "Cash"));

    const matrix = ACCOUNTS.map((from) => {
      const r = { from: `From ${from}` };
      let t = 0;
      ACCOUNTS.forEach((to) => {
        const v = from === to ? null : sum(rows.filter((x) => x.from === from && x.to === to));
        r[to] = v;
        t += v || 0;
      });
      r.total = t;
      return r;
    });
    const colTotal = { _kind: "total", from: "Total in" };
    ACCOUNTS.forEach((to) => (colTotal[to] = sum(rows.filter((x) => x.to === to))));
    colTotal.total = total;
    matrix.push(colTotal);

    const listColumns = [
      { key: "date", label: "Date", date: true },
      { key: "transferId", label: "Transfer ID" },
      { key: "from", label: "From" },
      { key: "to", label: "To" },
      { key: "purpose", label: "Purpose" },
      { key: "amount", label: "Amount", money: true },
      ...(matched ? [{ key: "match", label: "Bank match" }] : []),
      { key: "reference", label: "Reference" },
      { key: "bankReference", label: "Bank Reference" },
    ];
    const unmatched = rows.filter((r) => r.match === "Not matched");
    const noPurpose = rows.filter((r) => !r.purpose.trim());

    return {
      basis: "Transfers move money between the Academy's own accounts; they are never income or expense.",
      kpis: [
        { label: "Transfers", value: rows.length, kind: "num" },
        { label: "Total moved", value: total, kind: "money" },
        { label: "Cash deposited to bank", value: deposited, kind: "money" },
        { label: "Bank to cash", value: withdrawn, kind: "money" },
      ],
      tables: [
        {
          title: "A. From × To summary",
          columns: [
            { key: "from", label: "" },
            ...ACCOUNTS.map((a) => ({ key: a, label: `To ${a}`, money: true })),
            { key: "total", label: "Total out", money: true },
          ],
          rows: matrix,
        },
        { title: "B. All transfers", columns: listColumns, rows: [...rows, { _kind: "total", date: `TOTAL · ${rows.length}`, amount: total }] },
      ],
      exportTable: { columns: listColumns, rows },
      exceptions: [
        ...(unmatched.length
          ? [`${unmatched.length} transfer(s) touching a bank account are inside an uploaded statement period but not matched: ${unmatched.slice(0, 6).map((r) => r.transferId).join(", ")}${more(unmatched, 6)}.`]
          : []),
        ...(noPurpose.length ? [`${noPurpose.length} transfer(s) have no purpose written.`] : []),
      ],
      notes: ["Download Excel gives the plain transfer list."],
      summary: `${rows.length} transfer(s) · ${formatReportMoney(total)}`,
    };
  },
};

// ------------------------------------------------ Healthcare Account Statement
// Passbook view of the "Healthcare" clearing account. Book balance sign: a
// positive balance means Healthcare holds Academy money (Healthcare owes the
// Academy); negative means the Academy owes Healthcare.
const position = (b) => (Math.round(b) === 0 ? "Settled" : b > 0 ? "Healthcare owes" : "Academy owes");

export const healthcareStatementReport = {
  id: "intercompany",
  name: "Healthcare Account Statement",
  description: "Passbook of everything routed through Oksy Healthcare, with a running balance of who owes whom.",
  downloadable: true,
  filters: [],
  build({ collections = [], expenses = [], transfers = [] }, _f, range) {
    const data = { collections, expenses, transfers };
    const HC = "Healthcare";
    const openingCut = range?.start ? dayBefore(range.start) : null;
    const opening = openingCut ? bookBalanceAsOf(HC, openingCut, data) : 0;
    const entries = [
      ...within(collections, range)
        .filter((c) => c.account === HC)
        .map((c) => ({ date: day(c.date), particulars: `Fee received: ${c.student_name || c.student_id}`, type: "Fee via Healthcare", delta: amt(c.amount), reference: c.reference || "" })),
      ...within(expenses, range)
        .filter((e) => e.account === HC)
        .map((e) => ({ date: day(e.date), particulars: `${e.category}${e.description ? ` — ${e.description}` : ""}`, type: "Expense paid by Healthcare", delta: -amt(e.amount), reference: e.reference || "" })),
      ...within(transfers, range)
        .filter((t) => t.from_account === HC || t.to_account === HC)
        .map((t) => ({
          date: day(t.date),
          particulars: `${t.from_account} → ${t.to_account}${t.purpose ? ` (${t.purpose})` : ""}`,
          type: t.to_account === HC ? "Paid to Healthcare" : "Received from Healthcare",
          delta: t.to_account === HC ? amt(t.amount) : -amt(t.amount),
          reference: t.reference || "",
        })),
    ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    let bal = opening;
    const body = entries.map((e) => {
      bal += e.delta;
      return {
        date: e.date,
        particulars: e.particulars,
        type: e.type,
        debit: e.delta < 0 ? -e.delta : null,
        credit: e.delta > 0 ? e.delta : null,
        balance: bal,
        position: position(bal),
        reference: e.reference,
      };
    });
    const closing = bal;
    const fees = sum(entries.filter((e) => e.type === "Fee via Healthcare"), (e) => e.delta);
    const paid = -sum(entries.filter((e) => e.type === "Expense paid by Healthcare"), (e) => e.delta);
    const totDebit = sum(body, (r) => r.debit);
    const totCredit = sum(body, (r) => r.credit);

    const rows = [
      { _kind: "subtotal", date: openingCut || "", particulars: "Opening balance", balance: opening, position: position(opening) },
      ...body,
      { _kind: "total", date: range?.end || "", particulars: "Closing balance", debit: totDebit, credit: totCredit, balance: closing, position: position(closing) },
    ];

    return {
      basis: "Positive balance = Healthcare holds money for the Academy (Healthcare owes). Negative = the Academy owes Healthcare.",
      kpis: [
        { label: "Opening", value: `${formatReportMoney(Math.abs(opening))} · ${position(opening)}`, kind: "text" },
        { label: "Fees received via Healthcare", value: fees, kind: "money" },
        { label: "Expenses paid by Healthcare", value: paid, kind: "money" },
        {
          label: closing >= 0 ? "Closing · Healthcare owes Academy" : "Closing · Academy owes Healthcare",
          value: Math.abs(closing),
          kind: "money",
          tone: closing < 0 ? "neg" : "pos",
        },
      ],
      tables: [
        {
          columns: [
            { key: "date", label: "Date", date: true },
            { key: "particulars", label: "Particulars" },
            { key: "type", label: "Type" },
            { key: "debit", label: "Debit (Academy owes ↑)", money: true },
            { key: "credit", label: "Credit (Healthcare owes ↑)", money: true },
            { key: "balance", label: "Balance", money: true },
            { key: "position", label: "Position" },
            { key: "reference", label: "Reference" },
          ],
          rows,
        },
      ],
      exceptions:
        Math.abs(closing) >= 1
          ? [`To settle: ${closing > 0 ? `Healthcare should pay the Academy ${formatReportMoney(closing)}` : `the Academy should pay Healthcare ${formatReportMoney(-closing)}`} as on ${dmy(range?.end && range.end < new Date().toISOString().slice(0, 10) ? range.end : new Date().toISOString().slice(0, 10))}.`]
          : [],
      notes: [range?.start ? `Opening = Healthcare balance as on ${dmy(openingCut)}.` : "All time: opening is zero."],
      summary: closing >= 0 ? `Healthcare owes Academy ${formatReportMoney(closing)}` : `Academy owes Healthcare ${formatReportMoney(-closing)}`,
    };
  },
};

// ------------------------------------------------------------ Student Register
// Admin-only (not in STAFF_REPORT_IDS): bulk contact details. Excel export
// keeps the Enrollment upload-template columns so it round-trips.
export const studentRegisterReport = {
  id: "students",
  name: "Student Register",
  description: "Course × status summary, new admissions and the full roster. Excel = the Enrollment upload template.",
  downloadable: true,
  filters: [
    { key: "course", label: "Course", optionsFrom: ({ students }) => ["All", ...uniqueSorted(students.map((s) => s.course))] },
    { key: "batch", label: "Batch", optionsFrom: ({ students }) => ["All", ...uniqueSorted(students.map((s) => s.batch))] },
    { key: "status", label: "Status", options: ["All", "Registered", "Active", "Completed", "Dropped"] },
  ],
  build({ students = [], collections = [] }, f, range) {
    let list = students;
    if (f.course && f.course !== "All") list = list.filter((s) => s.course === f.course);
    if (f.batch && f.batch !== "All") list = list.filter((s) => s.batch === f.batch);
    if (f.status && f.status !== "All") list = list.filter((s) => s.status === f.status);
    const paid = collections.reduce((m, c) => ((m[c.student_id] = (m[c.student_id] || 0) + amt(c.amount)), m), {});
    const STATUSES = ["Registered", "Active", "Completed", "Dropped"];
    const count = (st, l = list) => l.filter((s) => s.status === st).length;
    const newIn = range ? list.filter((s) => s.enrollment_date && inRange(s.enrollment_date, range)) : [];

    const courses = uniqueSorted(list.map((s) => s.course || "—"));
    const summary = courses.map((c) => {
      const l = list.filter((s) => (s.course || "—") === c);
      return { course: c, ...Object.fromEntries(STATUSES.map((st) => [st, count(st, l)])), total: l.length, dropRate: share(count("Dropped", l), l.length) };
    });
    summary.push({
      _kind: "total",
      course: "TOTAL",
      ...Object.fromEntries(STATUSES.map((st) => [st, count(st)])),
      total: list.length,
      dropRate: share(count("Dropped"), list.length),
    });

    const roster = list
      .slice()
      .sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }))
      .map((s) => ({
        id: s.id,
        name: s.name,
        course: s.course || "",
        batch: s.batch || "",
        enrolled: s.enrollment_date || "",
        status: s.status,
        phone: s.student_phone || "",
        parent: [s.parent_name, s.parent_phone].filter(Boolean).join(" · "),
        place: s.place || "",
        lead: s.lead_source || "",
        net: effectiveFeeDue(s, paid[s.id] || 0),
      }));

    const filled = (k) => share(list.filter((s) => s[k] && String(s[k]).trim()).length, list.length);
    const gaps = [
      ["Lead source", filled("lead_source")],
      ["Place", filled("place")],
      ["Date of birth", filled("date_of_birth")],
      ["Parent phone", filled("parent_phone")],
    ].filter(([, p]) => p !== null && p < 90);

    return {
      basis: "Current roster (not limited by period). New admissions use the enrolment date within the period.",
      kpis: [
        { label: "Students", value: list.length, kind: "num" },
        { label: "Active", value: count("Active") + count("Registered"), kind: "num", tone: "pos" },
        { label: "Completed", value: count("Completed"), kind: "num" },
        { label: "Dropped", value: `${count("Dropped")} (${list.length ? Math.round((count("Dropped") / list.length) * 100) : 0}%)`, kind: "text", tone: count("Dropped") ? "neg" : undefined },
        ...(range ? [{ label: "New this period", value: newIn.length, kind: "num" }] : []),
      ],
      tables: [
        {
          title: "A. Course × status",
          columns: [
            { key: "course", label: "Course" },
            ...STATUSES.map((st) => ({ key: st, label: st, num: true })),
            { key: "total", label: "Total", num: true },
            { key: "dropRate", label: "Drop rate", pct: true },
          ],
          rows: summary,
        },
        {
          title: "B. Roster",
          columns: [
            { key: "id", label: "Student ID" },
            { key: "name", label: "Name" },
            { key: "course", label: "Course" },
            { key: "batch", label: "Batch" },
            { key: "enrolled", label: "Enrolled on", date: true },
            { key: "status", label: "Status" },
            { key: "phone", label: "Phone" },
            { key: "parent", label: "Parent" },
            { key: "place", label: "Place" },
            { key: "lead", label: "Lead source" },
            { key: "net", label: "Net fee", money: true },
          ],
          rows: roster,
        },
      ],
      exportTable: {
        columns: STUDENT_BULK_COLUMNS,
        rows: list
          .map((s) => Object.fromEntries(STUDENT_BULK_COLUMNS.map((c) => [c.key, s[c.key] ?? (c.money ? 0 : "")])))
          .sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true })),
      },
      exceptions: gaps.map(([k, p]) => `${k} is filled for only ${Math.round(p)}% of these students — update it via Enrollment → Excel bulk update to unlock marketing and profile reports.`),
      notes: ["Download Excel gives the Enrollment upload template (edit, then Upload Excel on the Enrollment page)."],
      summary: `${list.length} student(s)`,
    };
  },
};
