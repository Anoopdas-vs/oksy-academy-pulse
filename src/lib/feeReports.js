// Phase 2 corporate reports: Batch-wise Fee Summary, Fee Collection
// Register, Student Dues, Expense Category × Month. Pure functions over
// already-loaded rows (single-tenant). Shapes: see reportKit.js.
import { inRange } from "./period.js";
import { receiptNo } from "./format.js";
import { grossFee, effectiveFeeDue, outstanding, creditBalance } from "./fees.js";
import { monthsInRange, monthLabel, share, formatReportMoney, dmy } from "./reportKit.js";

const amt = (v) => Number(v || 0);
const sum = (rows, f = (r) => r.amount) => rows.reduce((s, r) => s + amt(f(r)), 0);
const within = (rows, range) => (range ? rows.filter((r) => inRange(r.date, range)) : rows);
const pad = (n) => String(n).padStart(2, "0");
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayIso = () => isoOf(new Date());
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000);
const BANK_ACCOUNTS = ["HDFC", "ICICI"];
const ACCOUNTS = ["All", "Cash", "HDFC", "ICICI", "Healthcare"];

// "As on" date for position reports: the period end, never in the future.
function asOnDate(range) {
  const t = todayIso();
  return range?.end && range.end < t ? range.end : t;
}

const paidByStudent = (collections, cutoff) =>
  collections.reduce((m, c) => {
    if (cutoff && String(c.date).slice(0, 10) > cutoff) return m;
    m[c.student_id] = (m[c.student_id] || 0) + amt(c.amount);
    return m;
  }, {});

// --------------------------------------------------- Batch-wise Fee Summary
function batchStatus(b, today) {
  if (b.start_date && b.start_date > today) return "Upcoming";
  if (b.end_date && b.end_date < today) return "Completed";
  return b.start_date ? "Running" : "—";
}

export const batchSummaryReport = {
  id: "batch-summary",
  name: "Batch-wise Fee Summary",
  description: "Students, fee billed, collected and pending for every batch, grouped by course.",
  downloadable: true,
  filters: [{ key: "show", label: "Batches", options: ["All", "Running", "Completed", "Upcoming"] }],
  build({ students = [], collections = [], batches = [] }, f, range) {
    const today = todayIso();
    const asOn = asOnDate(range);
    const paid = paidByStudent(collections, asOn);
    const byName = new Map(batches.map((b) => [b.name, b]));
    // Batches that overlap the period (all batches for all time).
    const overlaps = (b) =>
      !range || ((!range.end || !b.start_date || b.start_date <= range.end) && (!range.start || !b.end_date || b.end_date >= range.start));

    const groups = new Map(); // batch name -> students
    students.forEach((s) => {
      const k = s.batch || "(No batch)";
      groups.set(k, [...(groups.get(k) || []), s]);
    });
    batches.forEach((b) => {
      if (!groups.has(b.name) && !b.archived) groups.set(b.name, []);
    });

    const rows = [...groups.entries()]
      .map(([name, list]) => {
        const b = byName.get(name) || {};
        const p = (s) => paid[s.id] || 0;
        const net = sum(list, (s) => effectiveFeeDue(s, p(s)));
        const coll = sum(list, p);
        return {
          batch: name,
          course: b.course_name || list[0]?.course || "—",
          dates: b.start_date ? `${dmy(b.start_date)} – ${b.end_date ? dmy(b.end_date) : "…"}` : "—",
          status: b.name ? batchStatus(b, today) : "—",
          active: list.filter((s) => s.status === "Active" || s.status === "Registered").length,
          completed: list.filter((s) => s.status === "Completed").length,
          dropped: list.filter((s) => s.status === "Dropped").length,
          students: list.length,
          gross: sum(list, grossFee),
          mix: "",
          waiver: sum(list, (s) => s.waiver),
          net,
          collected: coll,
          pending: sum(list, (s) => outstanding(s, p(s))),
          pct: share(coll, net),
          avg: list.length ? net / list.length : null,
          _start: b.start_date || "",
          _batch: b,
        };
      })
      .filter((r) => !r._batch.name || overlaps(r._batch))
      .filter((r) => !f.show || f.show === "All" || r.status === f.show)
      .map((r) => ({ ...r, mix: `${r.active} · ${r.completed} · ${r.dropped}` }));

    const NUMS = ["active", "completed", "dropped", "students", "gross", "waiver", "net", "collected", "pending"];
    const totalOf = (list, line, kind) => {
      const t = { batch: line, _kind: kind };
      NUMS.forEach((k) => (t[k] = sum(list, (r) => r[k])));
      t.pct = share(t.collected, t.net);
      t.avg = t.students ? t.net / t.students : null;
      t.mix = `${t.active} · ${t.completed} · ${t.dropped}`;
      return t;
    };

    const courses = [...new Set(rows.map((r) => r.course))].sort();
    const out = [];
    courses.forEach((c) => {
      const list = rows.filter((r) => r.course === c).sort((a, b) => (a._start < b._start ? 1 : -1));
      out.push({ _kind: "group", batch: c });
      list.forEach((r) => out.push({ ...r, _tone: r.pct !== null && r.pct < 80 && r.status !== "Upcoming" && r.net > 0 ? "neg" : undefined }));
      if (courses.length > 1) out.push(totalOf(list, `Total ${c}`, "subtotal"));
    });
    const grand = totalOf(rows, "GRAND TOTAL", "total");
    out.push(grand);

    const exceptions = rows
      .filter((r) => r.net > 0 && r.status !== "Upcoming" && r.pct !== null && r.pct < 80)
      .sort((a, b) => a.pct - b.pct)
      .map((r) => `${r.batch}: only ${Math.round(r.pct)}% collected — ${formatReportMoney(r.pending)} pending from ${r.students - r.dropped} student(s).`);
    const empty = rows.filter((r) => r.students === 0 && r.status !== "Upcoming");
    if (empty.length) exceptions.push(`No students yet: ${empty.map((r) => r.batch).join(", ")}.`);

    return {
      basis: `Fee position as on ${dmy(asOn)}. Net billed = fee after waiver (a dropped student owes only what was paid).`,
      kpis: [
        { label: "Net billed", value: grand.net, kind: "money" },
        { label: "Collected", value: grand.collected, kind: "money", tone: "pos" },
        { label: "Pending", value: grand.pending, kind: "money", tone: grand.pending ? "neg" : "pos" },
        { label: "Collection %", value: grand.pct, kind: "pct", tone: grand.pct !== null && grand.pct < 80 ? "neg" : "pos" },
      ],
      tables: [
        {
          columns: [
            { key: "batch", label: "Batch" },
            { key: "dates", label: "Start – End" },
            { key: "status", label: "Batch status" },
            { key: "students", label: "Students", num: true },
            { key: "mix", label: "Active · Done · Dropped" },
            { key: "gross", label: "Gross fee", money: true },
            { key: "waiver", label: "Waiver", money: true },
            { key: "net", label: "Net billed", money: true },
            { key: "collected", label: "Collected", money: true },
            { key: "pending", label: "Pending", money: true },
            { key: "pct", label: "Collection %", pct: true },
            { key: "avg", label: "Avg fee / student", money: true },
          ],
          rows: out,
        },
      ],
      exceptions,
      notes: [
        range ? "Batches shown: those running at any time in the selected period." : "All batches.",
        "Active includes students still in Registered status. Rows tinted red are below 80% collection.",
      ],
      summary: `Collected ${formatReportMoney(grand.collected)} of ${formatReportMoney(grand.net)}`,
    };
  },
};

// ------------------------------------------------- Fee Collection Register
const GROUPS = ["None", "Day", "Month", "Fee type", "Account", "Batch"];

// Collection ids linked to a bank line (bank_match_links via attachLinks).
function matchedCollectionIds(bankLines = []) {
  const set = new Set();
  bankLines.forEach((l) =>
    (l.links || []).forEach((k) => {
      if (k.bookKind === "collection") set.add(String(k.bookId));
    })
  );
  return set;
}

export const feeRegisterReport = {
  id: "fee-collection",
  name: "Fee Collection Register",
  description: "Every fee receipt in the period with batch and bank-match status, grouped the way you choose.",
  downloadable: true,
  filters: [
    { key: "account", label: "Account", options: ACCOUNTS },
    { key: "type", label: "Fee type", options: ["All", "Registration Fee", "Course Fee", "Exam Fee", "Other Fee"] },
    { key: "group", label: "Group by", options: GROUPS },
  ],
  build({ collections = [], students = [], bankLines = null, bankStatements = [] }, f, range) {
    const batchOf = new Map(students.map((s) => [s.id, s.batch || ""]));
    const matched = bankLines ? matchedCollectionIds(bankLines) : null;
    const covered = (acct, date) =>
      bankStatements.some((s) => s.account === acct && s.period_start <= date && s.period_end >= date);

    let list = within(collections, range);
    if (f.account && f.account !== "All") list = list.filter((r) => r.account === f.account);
    if (f.type && f.type !== "All") list = list.filter((r) => r.type === f.type);

    const lines = list
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.id || 0) - (a.id || 0)))
      .map((c) => {
        const date = String(c.date || "").slice(0, 10);
        let match = "";
        if (matched) {
          if (!BANK_ACCOUNTS.includes(c.account)) match = "n/a";
          else if (matched.has(String(c.id))) match = "Matched";
          else match = covered(c.account, date) ? "Not matched" : "No statement";
        }
        return {
          date,
          receiptNo: c.id ? receiptNo(c.id) : "",
          studentId: c.student_id,
          studentName: c.student_name || "",
          batch: batchOf.get(c.student_id) || "",
          type: c.type,
          account: c.account,
          amount: amt(c.amount),
          reference: c.reference || "",
          bankReference: c.bank_reference || "",
          match,
          _tone: match === "Not matched" ? "warn" : undefined,
        };
      });

    const keyOf = {
      Day: (r) => r.date,
      Month: (r) => monthLabel(r.date.slice(0, 7)),
      "Fee type": (r) => r.type || "—",
      Account: (r) => r.account || "—",
      Batch: (r) => r.batch || "(No batch)",
    }[f.group || "None"];

    let rows = lines;
    if (keyOf) {
      const order = [];
      const by = new Map();
      lines.forEach((r) => {
        const k = keyOf(r);
        if (!by.has(k)) {
          by.set(k, []);
          order.push(k);
        }
        by.get(k).push(r);
      });
      if (f.group !== "Day" && f.group !== "Month") order.sort();
      rows = order.flatMap((k) => [
        { _kind: "group", date: `${k} · ${by.get(k).length} receipt(s)` },
        ...by.get(k),
        { _kind: "subtotal", date: `Total ${k}`, amount: sum(by.get(k)) },
      ]);
    }
    const total = sum(lines);
    rows = [...rows, { _kind: "total", date: `TOTAL · ${lines.length} receipt(s)`, amount: total }];

    const cash = sum(lines.filter((r) => r.account === "Cash"));
    const bank = sum(lines.filter((r) => BANK_ACCOUNTS.includes(r.account)));
    const unmatched = lines.filter((r) => r.match === "Not matched");

    const columns = [
      { key: "date", label: "Date", date: true },
      { key: "receiptNo", label: "Receipt No" },
      { key: "studentId", label: "Student ID" },
      { key: "studentName", label: "Student Name" },
      { key: "batch", label: "Batch" },
      { key: "type", label: "Type" },
      { key: "account", label: "Payment A/C" },
      { key: "amount", label: "Amount", money: true },
      ...(matched ? [{ key: "match", label: "Bank match" }] : []),
      { key: "reference", label: "Reference" },
      { key: "bankReference", label: "Bank Reference" },
    ];

    return {
      basis: "Receipts dated in the period. Bank match comes from Banking → Reconciliation.",
      kpis: [
        { label: "Receipts", value: lines.length, kind: "num" },
        { label: "Total collected", value: total, kind: "money", tone: "pos" },
        { label: "Cash / Bank", value: `${formatReportMoney(cash)} / ${formatReportMoney(bank)}`, kind: "text" },
        { label: "Average receipt", value: lines.length ? total / lines.length : 0, kind: "money" },
      ],
      tables: [{ columns, rows }],
      // Excel = plain receipt rows with these exact headers, so a downloaded
      // file can be edited and re-uploaded in Fee Collection.
      exportTable: { columns, rows: lines },
      exceptions: unmatched.length
        ? [
            `${unmatched.length} bank receipt(s) worth ${formatReportMoney(sum(unmatched))} are inside an uploaded statement period but not matched to a bank line: ${unmatched
              .slice(0, 6)
              .map((r) => r.receiptNo)
              .join(", ")}${unmatched.length > 6 ? ` and ${unmatched.length - 6} more` : ""}.`,
          ]
        : [],
      notes: [
        matched ? "Bank match: Matched · Not matched (statement uploaded, no link) · No statement (period not uploaded yet) · n/a (Cash / Healthcare)." : "",
        "Download Excel gives the plain receipt list (same columns as the upload template), ready to edit and re-upload.",
      ].filter(Boolean),
      summary: `${lines.length} receipt(s) · ${formatReportMoney(total)}`,
    };
  },
};

// ----------------------------------------------------------- Student Dues
export const studentDuesReport = {
  id: "receivables",
  name: "Student Dues (Receivables)",
  description: "Who still owes fees, how much, and how long since their last payment — grouped by batch.",
  downloadable: true,
  filters: [
    { key: "status", label: "Status", options: ["All", "Registered", "Active", "Completed", "Dropped"] },
    { key: "only", label: "Show", options: ["With balance", "With credit", "Everyone"] },
  ],
  build({ students = [], collections = [], canSeeContacts = false }, f, range) {
    const asOn = asOnDate(range);
    const upto = collections.filter((c) => String(c.date).slice(0, 10) <= asOn);
    const paid = paidByStudent(upto);
    const last = upto.reduce((m, c) => {
      const d = String(c.date).slice(0, 10);
      if (!m[c.student_id] || d > m[c.student_id]) m[c.student_id] = d;
      return m;
    }, {});

    let list = students.map((s) => {
      const collected = paid[s.id] || 0;
      const net = effectiveFeeDue(s, collected);
      const lp = last[s.id] || "";
      return {
        id: s.id,
        name: s.name,
        batch: s.batch || "(No batch)",
        phone: s.student_phone || s.parent_phone || "",
        status: s.status,
        net,
        collected,
        balance: outstanding(s, collected),
        credit: creditBalance(s, collected),
        pct: share(collected, net),
        lastPaid: lp ? dmy(lp) : "Never",
        days: lp ? daysBetween(lp, asOn) : null,
      };
    });
    if (f.status && f.status !== "All") list = list.filter((r) => r.status === f.status);
    const creditTotal = sum(list, (r) => r.credit);
    const creditCount = list.filter((r) => r.credit > 0).length;
    const show = f.only || "With balance";
    if (show === "With balance") list = list.filter((r) => r.balance > 0);
    if (show === "With credit") list = list.filter((r) => r.credit > 0);
    list.forEach((r) => {
      if (r.balance > 0 && (r.days === null || r.days > 60)) r._tone = "neg";
    });

    const batches = [...new Set(list.map((r) => r.batch))].sort();
    const rows = [];
    const subtotal = (items, line, kind) => ({
      _kind: kind,
      id: line,
      net: sum(items, (r) => r.net),
      collected: sum(items, (r) => r.collected),
      balance: sum(items, (r) => r.balance),
      credit: sum(items, (r) => r.credit),
      pct: share(sum(items, (r) => r.collected), sum(items, (r) => r.net)),
    });
    batches.forEach((b) => {
      const items = list.filter((r) => r.batch === b).sort((x, y) => y.balance - x.balance || y.credit - x.credit);
      rows.push({ _kind: "group", id: `${b} · ${items.length} student(s)` });
      rows.push(...items);
      if (batches.length > 1) rows.push(subtotal(items, `Total ${b}`, "subtotal"));
    });
    const grand = subtotal(list, "GRAND TOTAL", "total");
    rows.push(grand);

    const owing = list.filter((r) => r.balance > 0);
    const stale = owing.filter((r) => r.days !== null && r.days > 60).sort((a, b) => b.days - a.days);
    const never = owing.filter((r) => r.days === null);
    const exceptions = [];
    if (stale.length)
      exceptions.push(
        `${stale.length} student(s) with dues have not paid for over 60 days: ${stale
          .slice(0, 5)
          .map((r) => `${r.name} (${r.days} days, ${formatReportMoney(r.balance)})`)
          .join(", ")}${stale.length > 5 ? ` and ${stale.length - 5} more` : ""}.`
      );
    if (never.length) exceptions.push(`${never.length} student(s) owe fees and have never paid: ${never.slice(0, 5).map((r) => r.name).join(", ")}${never.length > 5 ? ` and ${never.length - 5} more` : ""}.`);
    if (creditCount) exceptions.push(`${creditCount} student(s) have paid ${formatReportMoney(creditTotal)} more than their fee — check for duplicate receipts.`);

    return {
      basis: `Fee position as on ${dmy(asOn)} (payments up to that date). Days since last payment are counted to that date.`,
      kpis: [
        { label: "Total outstanding", value: grand.balance, kind: "money", tone: grand.balance ? "neg" : "pos" },
        { label: "Students with dues", value: owing.length, kind: "num" },
        { label: "Average due", value: owing.length ? grand.balance / owing.length : 0, kind: "money" },
        { label: "Overpaid (credit)", value: creditCount, kind: "num", tone: creditCount ? "neg" : undefined },
      ],
      tables: [
        {
          columns: [
            { key: "id", label: "Student ID" },
            { key: "name", label: "Name" },
            ...(canSeeContacts ? [{ key: "phone", label: "Phone" }] : []),
            { key: "status", label: "Status" },
            { key: "net", label: "Net fee", money: true },
            { key: "collected", label: "Collected", money: true },
            { key: "balance", label: "Balance", money: true },
            { key: "pct", label: "Collected %", pct: true },
            { key: "lastPaid", label: "Last payment" },
            { key: "days", label: "Days since", num: true },
            ...(show === "With balance" ? [] : [{ key: "credit", label: "Credit", money: true }]),
          ],
          rows,
        },
      ],
      exceptions,
      notes: ["Rows tinted red: balance due and no payment for over 60 days (or never paid). Credit is never netted against other students' dues."],
      summary: `${owing.length} student(s) · outstanding ${formatReportMoney(grand.balance)}`,
    };
  },
};

// ------------------------------------------------ Expense: Category × Month
export const categoryMonthReport = {
  id: "expense-category-month",
  name: "Expense: Category × Month",
  description: "Each expense category month by month, with totals, share and unusual spikes highlighted.",
  downloadable: true,
  filters: [{ key: "account", label: "Paid from", options: ACCOUNTS }],
  build({ expenses = [] }, f, range) {
    let list = within(expenses, range);
    if (f.account && f.account !== "All") list = list.filter((e) => e.account === f.account);
    const thisMonth = todayIso().slice(0, 7);
    const months = monthsInRange(range, list.map((e) => e.date)).filter((m) => m <= thisMonth);
    const cell = new Map(); // cat|ym -> amount
    const cats = new Map();
    list.forEach((e) => {
      const c = e.category || "Uncategorised";
      const m = String(e.date).slice(0, 7);
      cell.set(`${c}|${m}`, (cell.get(`${c}|${m}`) || 0) + amt(e.amount));
      cats.set(c, (cats.get(c) || 0) + amt(e.amount));
    });
    const total = sum(list);
    const n = Math.max(1, months.length);
    const hot = [];
    const rows = [...cats.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([c, t]) => {
        const r = { category: c, total: t, share: share(t, total), avg: t / n, _hot: [] };
        months.forEach((m) => {
          const v = cell.get(`${c}|${m}`) || 0;
          r[m] = v;
          if (months.length >= 3 && v >= 5000 && v > 1.5 * r.avg) {
            r._hot.push(m);
            hot.push({ c, m, v, avg: r.avg });
          }
        });
        return r;
      });
    const tot = { _kind: "total", category: "TOTAL", total, share: total ? 100 : null, avg: total / n };
    months.forEach((m) => (tot[m] = sum(rows, (r) => r[m])));
    rows.push(tot);

    const topCat = [...cats.entries()].sort((a, b) => b[1] - a[1])[0];
    const topMonth = months.length ? months.reduce((a, b) => (tot[b] > tot[a] ? b : a)) : null;

    return {
      basis: "Cash basis — expenses by the date they were paid.",
      kpis: [
        { label: "Top category", value: topCat ? `${topCat[0]} · ${formatReportMoney(topCat[1])}` : "–", kind: "text" },
        { label: "Total expenses", value: total, kind: "money" },
        { label: "Average per month", value: total / n, kind: "money" },
        { label: "Highest month", value: topMonth ? `${monthLabel(topMonth)} · ${formatReportMoney(tot[topMonth])}` : "–", kind: "text" },
      ],
      tables: [
        {
          columns: [
            { key: "category", label: "Category" },
            ...months.map((m) => ({ key: m, label: monthLabel(m).replace(" 20", " '"), money: true })),
            { key: "total", label: "Total", money: true },
            { key: "share", label: "% of total", pct: true },
            { key: "avg", label: "Monthly avg", money: true },
          ],
          rows,
          note: "Highlighted cells: more than 1.5× that category's monthly average (and at least ₹5,000).",
        },
      ],
      exceptions: hot
        .sort((a, b) => b.v - b.avg - (a.v - a.avg))
        .slice(0, 6)
        .map((h) => `${h.c} in ${monthLabel(h.m)}: ${formatReportMoney(h.v)} vs monthly average ${formatReportMoney(h.avg)}.`),
      notes: [months.length > 12 ? "Tip: choose a single FY in Period for a cleaner 12-month view." : ""].filter(Boolean),
      summary: `Total ${formatReportMoney(total)}`,
    };
  },
};
