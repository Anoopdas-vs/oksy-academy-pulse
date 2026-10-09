// Phase 1 corporate finance reports: Profit & Loss, Monthly Income vs
// Expense, Cash & Bank Position. Pure functions over already-loaded rows
// (single-tenant: one academy's books). Shapes: see reportKit.js.
import { inRange } from "./period.js";
import { bookBalanceAsOf } from "./reconcile.js";
import { previousRange, monthsInRange, monthLabel, monthEnd, pctChange, share, dayBefore, formatReportMoney } from "./reportKit.js";

const amt = (v) => Number(v || 0);
const sum = (rows, f = (r) => r.amount) => rows.reduce((s, r) => s + amt(f(r)), 0);
const within = (rows, range) => (range ? rows.filter((r) => inRange(r.date, range)) : rows);
const ym = (d) => String(d || "").slice(0, 7);
const isoToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const BASIS_CASH = "Cash basis — fees when received, expenses when paid. Transfers between accounts are neither.";
export const FUND_ACCOUNTS = ["Cash", "HDFC", "ICICI"];

const FEE_TYPE_ORDER = ["Registration Fee", "Course Fee", "Exam Fee", "Other Fee"];
const byFeeType = (rows) => {
  const m = new Map();
  rows.forEach((c) => {
    const k = c.type || "Other Fee";
    m.set(k, (m.get(k) || 0) + amt(c.amount));
  });
  return m;
};
const byCategory = (rows) => {
  const m = new Map();
  rows.forEach((e) => {
    const k = e.category || "Uncategorised";
    m.set(k, (m.get(k) || 0) + amt(e.amount));
  });
  return m;
};

// ---------------------------------------------------------------- P&L
export const pnlReport = {
  id: "pnl",
  name: "Profit & Loss Statement",
  description: "Income by fee type, expenses by category and net profit — compared with the previous period.",
  downloadable: true,
  filters: [],
  build({ collections = [], expenses = [] }, _f, range) {
    const prevRange = previousRange(range);
    const cur = { c: within(collections, range), e: within(expenses, range) };
    const prev = prevRange ? { c: within(collections, prevRange), e: within(expenses, prevRange) } : null;

    const incCur = byFeeType(cur.c);
    const incPrev = prev ? byFeeType(prev.c) : new Map();
    const expCur = byCategory(cur.e);
    const expPrev = prev ? byCategory(prev.e) : new Map();
    const totalInc = sum(cur.c);
    const totalExp = sum(cur.e);
    const net = totalInc - totalExp;
    const pInc = prev ? sum(prev.c) : null;
    const pExp = prev ? sum(prev.e) : null;
    const pNet = prev ? pInc - pExp : null;

    const line = (label, c, p, extra = {}) => ({
      line: label,
      cur: c,
      ...(prev ? { prev: p, chg: c - (p || 0), chgPct: pctChange(c, p) } : {}),
      share: share(c, totalInc),
      ...extra,
    });

    const feeTypes = [
      ...FEE_TYPE_ORDER.filter((t) => incCur.has(t) || incPrev.has(t)),
      ...[...new Set([...incCur.keys(), ...incPrev.keys()])].filter((t) => !FEE_TYPE_ORDER.includes(t)).sort(),
    ];
    const cats = [...new Set([...expCur.keys(), ...expPrev.keys()])].sort(
      (a, b) => (expCur.get(b) || 0) - (expCur.get(a) || 0) || a.localeCompare(b)
    );

    const rows = [
      { _kind: "group", line: "A. INCOME" },
      ...feeTypes.map((t) => line(t, incCur.get(t) || 0, incPrev.get(t) || 0)),
      line("Total Income (A)", totalInc, pInc, { _kind: "subtotal" }),
      { _kind: "group", line: "B. EXPENSES" },
      ...cats.map((c) => line(c, expCur.get(c) || 0, expPrev.get(c) || 0, { _invert: true })),
      line("Total Expenses (B)", totalExp, pExp, { _kind: "subtotal", _invert: true }),
      line("NET PROFIT / (LOSS)  (A − B)", net, pNet, { _kind: "total" }),
    ];

    const columns = [
      { key: "line", label: "Particulars" },
      { key: "cur", label: "This period", money: true },
      ...(prev
        ? [
            { key: "prev", label: "Previous period", money: true },
            { key: "chg", label: "Change ₹", money: true, change: true },
            { key: "chgPct", label: "Change %", pct: true, change: true },
          ]
        : []),
      { key: "share", label: "% of Income", pct: true },
    ];

    const exceptions = [];
    if (net < 0) exceptions.push(`Net loss of ${formatReportMoney(-net)} for this period.`);
    if (prev) {
      cats.forEach((c) => {
        const a = expCur.get(c) || 0;
        const b = expPrev.get(c) || 0;
        if (b > 0 && a - b >= 10000 && a >= b * 1.5) {
          exceptions.push(`${c}: ${formatReportMoney(a)} vs ${formatReportMoney(b)} last period (+${Math.round(((a - b) / b) * 100)}%).`);
        } else if (b === 0 && a >= 25000) {
          exceptions.push(`${c}: ${formatReportMoney(a)} this period, nothing last period.`);
        }
      });
    }

    return {
      basis: BASIS_CASH,
      kpis: [
        { label: "Total Income", value: totalInc, kind: "money" },
        { label: "Total Expenses", value: totalExp, kind: "money" },
        { label: "Net Profit / (Loss)", value: net, kind: "money", tone: net < 0 ? "neg" : "pos" },
        { label: "Net Margin", value: share(net, totalInc), kind: "pct", tone: net < 0 ? "neg" : "pos" },
      ],
      tables: [{ columns, rows }],
      exceptions,
      notes: [
        prevRange
          ? `Previous period: ${prevRange.start} to ${prevRange.end}.`
          : "Choose a period (e.g. This FY) in the top bar to compare with the previous period.",
      ],
      summary: `Income ${formatReportMoney(totalInc)} · Expenses ${formatReportMoney(totalExp)} · Net ${formatReportMoney(net)}`,
    };
  },
};

// ---------------------------------------------------- Monthly Income vs Expense
export const monthlyReport = {
  id: "monthly",
  name: "Monthly Income vs Expense",
  description: "Month-by-month income, expenses, net and running total, with new admissions.",
  downloadable: true,
  filters: [],
  build({ collections = [], expenses = [], students = [] }, _f, range) {
    const c = within(collections, range);
    const e = within(expenses, range);
    const months = monthsInRange(range, [...c.map((r) => r.date), ...e.map((r) => r.date)]);
    const inc = new Map();
    const exp = new Map();
    const adm = new Map();
    c.forEach((r) => inc.set(ym(r.date), (inc.get(ym(r.date)) || 0) + amt(r.amount)));
    e.forEach((r) => exp.set(ym(r.date), (exp.get(ym(r.date)) || 0) + amt(r.amount)));
    students
      .filter((s) => s.enrollment_date && inRange(s.enrollment_date, range))
      .forEach((s) => adm.set(ym(s.enrollment_date), (adm.get(ym(s.enrollment_date)) || 0) + 1));

    const thisMonth = isoToday().slice(0, 7);
    let running = 0;
    const rows = months.map((m) => {
      const i = inc.get(m) || 0;
      const x = exp.get(m) || 0;
      running += i - x;
      const future = m > thisMonth;
      return {
        month: monthLabel(m),
        income: i,
        expense: x,
        net: i - x,
        margin: share(i - x, i),
        cumulative: future ? null : running,
        admissions: adm.get(m) || 0,
        _tone: i - x < 0 ? "neg" : undefined,
        _ym: m,
      };
    });
    const ti = sum(rows, (r) => r.income);
    const tx = sum(rows, (r) => r.expense);
    const active = rows.filter((r) => r.income || r.expense);
    const best = active.length ? active.reduce((a, b) => (b.net > a.net ? b : a)) : null;
    const worst = active.length ? active.reduce((a, b) => (b.net < a.net ? b : a)) : null;
    const lossMonths = active.filter((r) => r.net < 0);

    rows.push({
      _kind: "total",
      month: "TOTAL",
      income: ti,
      expense: tx,
      net: ti - tx,
      margin: share(ti - tx, ti),
      cumulative: null,
      admissions: sum(rows, (r) => r.admissions),
    });

    return {
      basis: BASIS_CASH,
      kpis: [
        { label: "Best month", value: best ? `${best.month} · ${formatReportMoney(best.net)}` : "–", kind: "text", tone: "pos" },
        { label: "Weakest month", value: worst ? `${worst.month} · ${formatReportMoney(worst.net)}` : "–", kind: "text", tone: worst && worst.net < 0 ? "neg" : undefined },
        { label: "Average monthly net", value: active.length ? (ti - tx) / active.length : 0, kind: "money" },
        { label: "Months in loss", value: `${lossMonths.length} of ${active.length}`, kind: "text", tone: lossMonths.length ? "neg" : "pos" },
      ],
      chart: {
        type: "income-expense",
        points: rows.filter((r) => !r._kind).map((r) => ({ label: r.month.slice(0, 3), sub: r.month.slice(-2), income: r.income, expense: r.expense })),
      },
      tables: [
        {
          columns: [
            { key: "month", label: "Month" },
            { key: "income", label: "Income", money: true },
            { key: "expense", label: "Expenses", money: true },
            { key: "net", label: "Net", money: true },
            { key: "margin", label: "Margin %", pct: true },
            { key: "cumulative", label: "Cumulative Net", money: true },
            { key: "admissions", label: "New admissions", num: true },
          ],
          rows,
        },
      ],
      exceptions: lossMonths.map((r) => `${r.month}: loss of ${formatReportMoney(-r.net)} (income ${formatReportMoney(r.income)}, expenses ${formatReportMoney(r.expense)}).`),
      notes: ["New admissions = students whose enrolment date falls in the month."],
      summary: `Income ${formatReportMoney(ti)} · Expenses ${formatReportMoney(tx)} · Net ${formatReportMoney(ti - tx)}`,
    };
  },
};

// ------------------------------------------------------- Cash & Bank Position
// Latest uploaded statement for `account` ending on/before `cutoff`.
function latestStatement(statements, account, cutoff) {
  return statements
    .filter((s) => s.account === account && (!cutoff || s.period_end <= cutoff))
    .sort((a, b) => (a.period_end < b.period_end ? 1 : a.period_end > b.period_end ? -1 : 0))[0];
}

export const cashBankReport = {
  id: "cash-bank",
  name: "Cash & Bank Position",
  description: "Opening, money in, money out and closing for Cash, HDFC and ICICI — checked against bank statements.",
  downloadable: true,
  filters: [],
  build({ collections = [], expenses = [], transfers = [], bankStatements = [] }, _f, range) {
    const data = { collections, expenses, transfers };
    const end = range?.end || null;
    const openingCut = range?.start ? dayBefore(range.start) : null;
    const inP = (r) => inRange(r.date, range);

    const rows = FUND_ACCOUNTS.map((acct) => {
      const opening = openingCut ? bookBalanceAsOf(acct, openingCut, data) : 0;
      const fees = sum(collections.filter((c) => c.account === acct && inP(c)));
      const tin = sum(transfers.filter((t) => t.to_account === acct && inP(t)));
      const paid = sum(expenses.filter((x) => x.account === acct && inP(x)));
      const tout = sum(transfers.filter((t) => t.from_account === acct && inP(t)));
      const closing = opening + fees + tin - paid - tout;
      const st = acct === "Cash" ? null : latestStatement(bankStatements, acct, end);
      const stBal = st ? amt(st.closing_balance) : null;
      const bookAtSt = st ? bookBalanceAsOf(acct, st.period_end, data) : null;
      return {
        account: acct,
        opening,
        fees,
        tin,
        paid,
        tout,
        closing,
        stDate: st ? st.period_end : acct === "Cash" ? "n/a" : "No statement",
        stBal,
        diff: st ? stBal - bookAtSt : null,
      };
    });
    const total = (k) => sum(rows.filter((r) => !r._kind), (r) => r[k]);
    const totalFunds = total("closing");
    rows.push({
      _kind: "total",
      account: "TOTAL",
      opening: total("opening"),
      fees: total("fees"),
      tin: total("tin"),
      paid: total("paid"),
      tout: total("tout"),
      closing: total("closing"),
      stDate: "",
      stBal: null,
      diff: null,
    });

    // Month-end balances.
    // Month-ends up to today only (a future month-end has no balance yet).
    const thisMonth = isoToday().slice(0, 7);
    const months = monthsInRange(
      range,
      [...collections, ...expenses, ...transfers].map((r) => r.date)
    ).filter((m) => m <= thisMonth);
    const monthRows = months.map((m) => {
      const cut = end && monthEnd(m) > end ? end : monthEnd(m);
      const vals = Object.fromEntries(FUND_ACCOUNTS.map((a) => [a, bookBalanceAsOf(a, cut, data)]));
      return { month: monthLabel(m), ...vals, total: FUND_ACCOUNTS.reduce((s, a) => s + vals[a], 0) };
    });

    // Days the cash book went below zero (in the period).
    const negCash = [];
    const cashDays = [
      ...new Set(
        [...collections.filter((c) => c.account === "Cash"), ...expenses.filter((x) => x.account === "Cash"), ...transfers.filter((t) => t.from_account === "Cash" || t.to_account === "Cash")]
          .filter(inP)
          .map((r) => String(r.date).slice(0, 10))
      ),
    ].sort();
    cashDays.forEach((d) => {
      const b = bookBalanceAsOf("Cash", d, data);
      if (b < 0) negCash.push(`${d} (${formatReportMoney(b)})`);
    });

    const exceptions = [];
    rows
      .filter((r) => !r._kind && r.diff !== null && Math.round(r.diff) !== 0)
      .forEach((r) =>
        exceptions.push(
          `${r.account}: bank statement (${r.stDate}) shows ${formatReportMoney(r.stBal)}, books show ${formatReportMoney(r.stBal - r.diff)} — difference ${formatReportMoney(r.diff)}. Check Banking → Reconciliation.`
        )
      );
    rows
      .filter((r) => r.stDate === "No statement")
      .forEach((r) => exceptions.push(`${r.account}: no bank statement uploaded yet — balance not verified.`));
    if (negCash.length) exceptions.push(`Cash book went below zero on ${negCash.slice(0, 5).join(", ")}${negCash.length > 5 ? ` and ${negCash.length - 5} more day(s)` : ""} — a receipt or deposit may be missing or dated late.`);

    const bankTotal = rows.filter((r) => r.account !== "Cash" && !r._kind).reduce((s, r) => s + r.closing, 0);
    const unrec = rows.filter((r) => !r._kind && r.diff).reduce((s, r) => s + Math.abs(r.diff), 0);

    return {
      basis: "Book balances from Pulse records; bank balance from the latest uploaded statement on or before the period end.",
      kpis: [
        { label: "Total funds", value: totalFunds, kind: "money", tone: totalFunds < 0 ? "neg" : "pos" },
        { label: "Cash in hand", value: rows[0].closing, kind: "money", tone: rows[0].closing < 0 ? "neg" : undefined },
        { label: "Bank total", value: bankTotal, kind: "money" },
        { label: "Unreconciled difference", value: unrec, kind: "money", tone: unrec ? "neg" : "pos" },
      ],
      tables: [
        {
          title: "A. Account summary",
          columns: [
            { key: "account", label: "Account" },
            { key: "opening", label: "Opening", money: true },
            { key: "fees", label: "Fees received", money: true },
            { key: "tin", label: "Transfers in", money: true },
            { key: "paid", label: "Expenses paid", money: true },
            { key: "tout", label: "Transfers out", money: true },
            { key: "closing", label: "Closing (books)", money: true },
            { key: "stDate", label: "Statement up to" },
            { key: "stBal", label: "Statement balance", money: true },
            { key: "diff", label: "Difference", money: true },
          ],
          rows,
          note: "Difference = statement balance − book balance on the statement date (not the period end).",
        },
        {
          title: "B. Month-end balances (books)",
          columns: [
            { key: "month", label: "Month" },
            ...FUND_ACCOUNTS.map((a) => ({ key: a, label: a, money: true })),
            { key: "total", label: "Total", money: true },
          ],
          rows: monthRows,
        },
      ],
      exceptions,
      notes: [
        range?.start ? `Opening = book balance at the end of ${openingCut}.` : "All time: opening is zero.",
        "The Healthcare account is an inter-company clearing account and is not counted as funds (see the Inter-company report).",
      ],
      summary: `Total funds ${formatReportMoney(totalFunds)}`,
    };
  },
};
