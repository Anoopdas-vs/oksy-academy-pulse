import React, { useEffect, useMemo, useState } from "react";
import { addDaysISO, daysBetweenISO, monthKeyOfISO, monthShortOfKey } from "../lib/dates.js";
import { istToday } from "../lib/batchStatus.js";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { formatMoney } from "../lib/format.js";
import { effectiveFeeDue, outstanding } from "../lib/fees.js";
import { fetchAcademySnapshot } from "../lib/academy.js";

/* ------------------------------- helpers ------------------------------- */

const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const inMonth = (dateStr, d) => String(dateStr || "").slice(0, 7) === monthKey(d);
const sumAmt = (rows) => rows.reduce((s, r) => s + Number(r.amount || 0), 0);
const inRange = (dateStr, r) => {
  if (!r) return true;
  const d = String(dateStr || "").slice(0, 10);
  return (!r.start || d >= r.start) && (!r.end || d <= r.end);
};

function pctChange(now, prev) {
  if (!prev) return now ? { text: "new activity", dir: "up" } : null;
  const p = ((now - prev) / Math.abs(prev)) * 100;
  const dir = p > 0.5 ? "up" : p < -0.5 ? "down" : "flat";
  return { text: `${p >= 0 ? "+" : ""}${p.toFixed(1)}% vs previous period`, dir };
}

// The window of equal length immediately before the selected one; or last
// calendar month when no period is selected.
function prevWindow(range) {
  const now = new Date();
  if (!range || !range.start || !range.end) {
    const m = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return { start: `${monthKey(m)}-01`, end: `${monthKey(m)}-31` };
  }
  // Calendar-day arithmetic on the ISO strings — no Date/UTC conversion.
  const len = daysBetweenISO(range.start, range.end);
  const pe = addDaysISO(range.start, -1);
  const ps = addDaysISO(pe, -len);
  return { start: ps, end: pe };
}

const mv = (n) => (n > 0 ? { text: `+${n} this month`, dir: "up" } : { text: "no change", dir: "flat" });
const flipExpenseTone = (d) =>
  d ? { ...d, tone: d.dir === "up" ? "down" : d.dir === "down" ? "up" : "flat" } : d;

const shortK = (n) => {
  const a = Math.abs(n);
  if (a >= 1e7) return `${(n / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `${(n / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `${Math.round(n / 1e3)}K`;
  return `${n}`;
};

const STUDENT_TILES = [
  { key: "totalStudents", label: "Total Students", icon: "👥", accent: "blue" },
  { key: "registered", label: "Registered", icon: "📝", accent: "violet" },
  { key: "active", label: "Active", icon: "🎓", accent: "green" },
  { key: "completed", label: "Completed", icon: "🏆", accent: "amber" },
  { key: "dropped", label: "Dropped", icon: "🚪", accent: "red" },
];

/* -------------------------------- view -------------------------------- */

export default function Dashboard(props) {
  const currentRole = props.role || props.profile?.role || "staff";

  if (currentRole === "faculty") {
    return <FacultyDashboard profile={props.profile} onNavigate={props.onNavigate} />;
  }

  if (currentRole === "student") {
    return <StudentDashboard profile={props.profile} onNavigate={props.onNavigate} />;
  }

  if (currentRole === "professional") {
    return <ProfessionalDashboard profile={props.profile} onNavigate={props.onNavigate} />;
  }

  return <ExecutiveDashboard {...props} />;
}

function ExecutiveDashboard({
  totals,
  allStudents = [],
  allCollections = [],
  allExpenses = [],
  periodCollections = [],
  periodExpenses = [],
  range = null,
  periodLabel = "All time",
  fullDashboard = true,
  onNavigate = () => {},
}) {
  const go = (tab) => () => onNavigate(tab);

  const [academy, setAcademy] = useState(null);
  useEffect(() => {
    let ok = true;
    fetchAcademySnapshot().then((r) => { if (ok) setAcademy(r); });
    return () => { ok = false; };
  }, []);

  const monthly = useMemo(
    () => buildMonthlySeries(periodCollections, periodExpenses),
    [periodCollections, periodExpenses]
  );
  const batchRows = useMemo(
    () => buildBatchSummary(allStudents, allCollections),
    [allStudents, allCollections]
  );
  const batchTotals = useMemo(() => sumBatch(batchRows), [batchRows]);

  const recentCollections = useMemo(
    () => [...periodCollections].sort(byDateDesc).slice(0, 7),
    [periodCollections]
  );
  const recentExpenses = useMemo(
    () => [...periodExpenses].sort(byDateDesc).slice(0, 7),
    [periodExpenses]
  );

  // Student movement this month (from the full roster).
  const studentDeltas = useMemo(() => {
    const now = new Date();
    const lastMonthEnd = `${monthKey(new Date(now.getFullYear(), now.getMonth(), 0))}-31`;
    const totalPrev = allStudents.filter((s) => String(s.enrollment_date || "") <= lastMonthEnd).length;
    const thisMonth = (status) =>
      allStudents.filter((s) => (!status || s.status === status) && inMonth(s.enrollment_date, now)).length;
    return {
      totalStudents: pctChange(allStudents.length, totalPrev),
      registered: mv(thisMonth("Registered")),
      active: mv(thisMonth("Active")),
      completed: mv(thisMonth("Completed")),
      dropped: mv(thisMonth("Dropped")),
    };
  }, [allStudents]);

  // Financial "vs previous period".
  const finDeltas = useMemo(() => {
    const pw = prevWindow(range);
    return {
      revenue: pctChange(totals.totalRevenue, sumAmt(allCollections.filter((c) => inRange(c.date, pw)))),
      expense: pctChange(totals.totalExpense, sumAmt(allExpenses.filter((e) => inRange(e.date, pw)))),
    };
  }, [range, totals.totalRevenue, totals.totalExpense, allCollections, allExpenses]);

  // Fee-collection health — always the all-time position so it reconciles with
  // the Batch Summary total and the Outstanding Student Fees card.
  const expectedFees = totals.expectedFees || 0;
  const collectedFees = totals.collectedFees || 0;
  const outstandingFees = totals.studentReceivable || 0;
  const collectedPct = expectedFees > 0 ? (collectedFees / expectedFees) * 100 : 0;
  const onTrack = collectedPct >= 60;

  return (
    <section className="page dash">
      {/* B. STUDENT OVERVIEW */}
      <SectionCard
        icon="🎓"
        title="Student Overview"
        subtitle="Total student information across all batches"
        pill="All time"
        action={{ label: "View All Students", onClick: go("Enrollment") }}
      >
        <div className="tile-grid five">
          {STUDENT_TILES.map((t) => (
            <StatTile
              key={t.key}
              label={t.label}
              value={totals[t.key]}
              icon={t.icon}
              accent={t.accent}
              delta={studentDeltas[t.key]}
            />
          ))}
        </div>
      </SectionCard>

      {/* B2. ACADEMY OPERATIONS */}
      {academy && !academy.pending && academy.stats && (
        <SectionCard
          icon="📚"
          title="Academy Operations"
          subtitle="Assignments, exams, attendance and faculty feedback"
          action={{ label: "Open Assignments", onClick: go("Assignments") }}
        >
          <div className="tile-grid five">
            <StatTile
              label="Published Assignments"
              value={academy.stats.published}
              icon="📋"
              accent="blue"
              caption={`${academy.stats.submissions} submissions`}
              onClick={go("Assignments")}
            />
            <StatTile
              label="Grading Done"
              value={`${academy.stats.gradingPct}%`}
              icon="✍️"
              accent={academy.stats.gradingPct >= 80 ? "green" : "amber"}
              caption="Of all submissions"
            />
            <StatTile
              label="Exam Pass Rate"
              value={`${academy.stats.passPct}%`}
              icon="📝"
              accent={academy.stats.passPct >= 60 ? "green" : "red"}
              caption={`${academy.stats.examAttempts} attempts`}
              onClick={go("Exams")}
            />
            <StatTile
              label="Attendance"
              value={`${academy.stats.attendancePct}%`}
              icon="🎥"
              accent={academy.stats.attendancePct >= 75 ? "green" : "amber"}
              caption="Live class check-ins"
              onClick={go("Live Class")}
            />
            <StatTile
              label="Faculty Rating"
              value={academy.stats.avgRating ? `${academy.stats.avgRating}/5` : "—"}
              icon="⭐"
              accent="violet"
              caption={`${academy.stats.reviews} reviews`}
              onClick={go("Reviews")}
            />
          </div>
        </SectionCard>
      )}

      {fullDashboard && (
        <>
          {/* C. FINANCIAL OVERVIEW */}
          <SectionCard
            icon="📊"
            title="Financial Overview"
            subtitle="Income, expenses and profitability"
            pill={periodLabel}
          >
            <div className="tile-grid five">
              <StatTile label="Total Revenue" value={formatMoney(totals.totalRevenue)} icon="🪙" accent="green" delta={finDeltas.revenue} />
              <StatTile label="Total Expense" value={formatMoney(totals.totalExpense)} icon="💳" accent="red" delta={flipExpenseTone(finDeltas.expense)} />
              <StatTile
                label="Net P&L"
                value={formatMoney(totals.netProfit)}
                icon="📈"
                accent={totals.netProfit >= 0 ? "green" : "red"}
                valueTone={totals.netProfit >= 0 ? "pos" : "neg"}
                caption="Revenue − Expense − Due to Healthcare"
              />
              <StatTile label="Outstanding Student Fees" value={formatMoney(totals.studentReceivable)} icon="📄" accent="blue" caption="Amount still to be collected" />
              <StatTile
                label="Due to Healthcare"
                value={formatMoney(totals.healthcareLiability)}
                icon="🏛️"
                accent="violet"
                caption="Expenses paid by Healthcare on behalf of Academy"
                onClick={go("Banking")}
              />
            </div>
          </SectionCard>

          <div className="dash-row two-40-60">
            {/* D. CASH & BANK POSITION */}
            <SectionCard icon="🏦" title="Cash & Bank Position" subtitle="Current balance in all accounts" pill="All time">
              <div className="tile-grid two">
                <StatTile
                  label="Cash Balance"
                  value={formatMoney(totals.cashBalance)}
                  icon={totals.cashBalance < 0 ? "⚠️" : "💵"}
                  accent={totals.cashBalance < 0 ? "red" : "green"}
                  valueTone={totals.cashBalance < 0 ? "neg" : "pos"}
                  caption={totals.cashBalance < 0 ? "Requires reconciliation" : "Cash in hand"}
                />
                <StatTile label="HDFC Bank" value={formatMoney(totals.hdfcBalance)} icon="🏦" accent="green" valueTone={totals.hdfcBalance < 0 ? "neg" : "pos"} caption="Book balance" />
                <StatTile label="ICICI Bank" value={formatMoney(totals.iciciBalance)} icon="🏦" accent="green" valueTone={totals.iciciBalance < 0 ? "neg" : "pos"} caption="Book balance" />
                <StatTile label="Total Balance" value={formatMoney(totals.totalBalance)} plain valueTone={totals.totalBalance < 0 ? "neg" : "pos"} caption="Cash + HDFC + ICICI" />
              </div>
            </SectionCard>

            {/* E. FEE COLLECTION HEALTH */}
            <SectionCard icon="🎯" title="Fee Collection Health" subtitle="Expected vs collected student fees" pill="All time">
              <div className="health">
                <div className="health-donut">
                  <ResponsiveContainer width="100%" height={168}>
                    <PieChart>
                      <Pie
                        data={[
                          { name: "Collected", value: Math.max(0, collectedFees) },
                          { name: "Outstanding", value: Math.max(0, outstandingFees) },
                        ]}
                        dataKey="value"
                        innerRadius={54}
                        outerRadius={78}
                        startAngle={90}
                        endAngle={-270}
                        stroke="none"
                        isAnimationActive={false}
                      >
                        <Cell fill="var(--accent-blue)" />
                        <Cell fill="var(--track)" />
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="health-donut-label">
                    <strong>{collectedPct.toFixed(1)}%</strong>
                    <span>Collected</span>
                  </div>
                </div>
                <ul className="health-figs">
                  <li><b className="pos">{formatMoney(collectedFees)}</b><span>Collected so far</span></li>
                  <li><b>{formatMoney(expectedFees)}</b><span>Expected total fees</span></li>
                  <li><b className="neg">{formatMoney(outstandingFees)}</b><span>Outstanding</span></li>
                </ul>
                <div className={`health-status ${onTrack ? "ok" : "warn"}`}>
                  <strong>{onTrack ? "Collection is on track" : "Collections need attention"}</strong>
                  <span>{collectedPct.toFixed(1)}% of expected fees have been collected.</span>
                </div>
              </div>
            </SectionCard>
          </div>

          <div className="dash-row two-45-55">
            {/* F1. MONTHLY INCOME VS EXPENSE */}
            <SectionCard icon="📊" title="Monthly Income vs Expense" subtitle="Monthly trend of income and expenses" pill={periodLabel}>
              <div className="legend-custom">
                <span><i className="dot" style={{ background: "var(--positive)" }} />Income</span>
                <span><i className="dot" style={{ background: "var(--danger)" }} />Expense</span>
              </div>
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={monthly} barGap={4} barCategoryGap="26%">
                  <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={10} interval={0} />
                  <YAxis tickLine={false} axisLine={false} fontSize={10} tickFormatter={shortK} width={44} />
                  <Tooltip
                    formatter={(v, n) => [formatMoney(v), n]}
                    labelFormatter={(l, p) => {
                      const pl = p && p[0] && p[0].payload && p[0].payload.pnl;
                      return pl === undefined ? l : `${l} · Net P&L ${formatMoney(pl)}`;
                    }}
                  />
                  <Bar dataKey="revenue" name="Income" fill="var(--positive)" radius={[3, 3, 0, 0]} maxBarSize={26} />
                  <Bar dataKey="expense" name="Expense" fill="var(--danger)" radius={[3, 3, 0, 0]} maxBarSize={26} />
                </BarChart>
              </ResponsiveContainer>
            </SectionCard>

            {/* F2. BATCH SUMMARY */}
            <SectionCard
              icon="👥"
              title="Batch Summary"
              subtitle="Fee performance of each batch"
              pill="All time"
              action={{ label: "View All Batches", onClick: go("Admin") }}
            >
              <div className="table-scroll">
                <table className="tight">
                  <thead>
                    <tr>
                      <th>Batch</th><th>Students</th><th>Active</th><th>Completed</th><th>Dropped</th>
                      <th className="ra">Expected Fees</th><th className="ra">Collected</th><th className="ra">Outstanding</th><th>% Collected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchRows.length === 0 && <tr><td colSpan={9} className="table-empty">No students enrolled yet.</td></tr>}
                    {batchRows.map((b) => (
                      <tr key={b.batch}>
                        <td><strong>{b.batch}</strong></td>
                        <td>{b.students}</td>
                        <td>{b.active}</td>
                        <td>{b.completed}</td>
                        <td>{b.dropped}</td>
                        <td className="ra">{formatMoney(b.expected)}</td>
                        <td className="ra">{formatMoney(b.collected)}</td>
                        <td className="ra">{formatMoney(b.outstanding)}</td>
                        <td><ProgressPct value={b.collected} total={b.expected} /></td>
                      </tr>
                    ))}
                  </tbody>
                  {batchRows.length > 0 && (
                    <tfoot>
                      <tr>
                        <td><strong>Total</strong></td>
                        <td><strong>{batchTotals.students}</strong></td>
                        <td>{batchTotals.active}</td>
                        <td>{batchTotals.completed}</td>
                        <td>{batchTotals.dropped}</td>
                        <td className="ra"><strong>{formatMoney(batchTotals.expected)}</strong></td>
                        <td className="ra"><strong>{formatMoney(batchTotals.collected)}</strong></td>
                        <td className="ra"><strong>{formatMoney(batchTotals.outstanding)}</strong></td>
                        <td><ProgressPct value={batchTotals.collected} total={batchTotals.expected} /></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </SectionCard>
          </div>
        </>
      )}

      {/* G. RECENT ACTIVITY */}
      <div className="dash-row two-50-50">
        <SectionCard
          icon="₹"
          accent="green"
          title="Recent Fee Collections"
          subtitle="Latest student payments"
          action={{ label: "View All", onClick: go("Fee Collection") }}
        >
          <table className="tight">
            <thead><tr><th>Date</th><th>Student</th><th>Batch</th><th className="ra">Amount</th><th>Mode</th></tr></thead>
            <tbody>
              {recentCollections.length === 0 && <tr><td colSpan={5} className="table-empty">No payments in this period.</td></tr>}
              {recentCollections.map((c) => (
                <tr key={c.id}>
                  <td>{c.date}</td>
                  <td><strong>{c.student_name}</strong></td>
                  <td>{studentBatch(allStudents, c.student_id)}</td>
                  <td className="ra pos">{formatMoney(c.amount)}</td>
                  <td><AccountTag account={c.account} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>

        <SectionCard
          icon="🧾"
          accent="violet"
          title="Recent Expenses"
          subtitle="Latest academy expenses"
          action={{ label: "View All", onClick: go("Expenses") }}
        >
          <table className="tight">
            <thead><tr><th>Date</th><th>Category</th><th>Description</th><th className="ra">Amount</th><th>Paid By</th></tr></thead>
            <tbody>
              {recentExpenses.length === 0 && <tr><td colSpan={5} className="table-empty">No expenses in this period.</td></tr>}
              {recentExpenses.map((e) => (
                <tr key={e.id}>
                  <td>{e.date}</td>
                  <td><strong>{e.category}</strong></td>
                  <td className="desc-cell">{e.description}</td>
                  <td className="ra neg">{formatMoney(e.amount)}</td>
                  <td><AccountTag account={e.account} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
      </div>
    </section>
  );
}

/* --------------------------- small components --------------------------- */

function SectionCard({ icon, accent, title, subtitle, action, pill, children }) {
  return (
    <div className="section-card">
      <div className="section-card-head">
        <div className="sch-title">
          <span className={accent ? `sch-icon ic-${accent}` : "sch-icon"}>{icon}</span>
          <div>
            <h3>{title}</h3>
            {subtitle && <p>{subtitle}</p>}
          </div>
        </div>
        {pill && <span className="sch-pill">{pill}</span>}
        {action && (
          <button className="sch-action" onClick={action.onClick}>
            {action.label} <span aria-hidden>→</span>
          </button>
        )}
      </div>
      <div className="section-card-body">{children}</div>
    </div>
  );
}

function StatTile({ label, value, icon, accent, delta, caption, plain, valueTone, onClick }) {
  const Cmp = onClick ? "button" : "div";
  return (
    <Cmp
      className={`stat-tile ${plain ? "plain" : `accent-${accent}`}${onClick ? " clickable" : ""}`}
      onClick={onClick}
    >
      <div className="stat-tile-top">
        <span className="stat-label">{label}</span>
        {icon && <span className={`stat-icon ${plain ? "" : `ic-${accent}`}`}>{icon}</span>}
      </div>
      <div className={valueTone ? `stat-value ${valueTone}` : "stat-value"}>{value}</div>
      {delta && (
        <div className={`stat-delta ${delta.tone || delta.dir}`}>
          <span className="arr">{delta.dir === "up" ? "↑" : delta.dir === "down" ? "↓" : "—"}</span>
          {delta.text}
        </div>
      )}
      {!delta && caption && <div className="stat-caption">{caption}</div>}
    </Cmp>
  );
}

function ProgressPct({ value, total }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  const p = Math.max(0, Math.min(100, pct));
  const tone = p >= 60 ? "ok" : p >= 25 ? "mid" : "low";
  return (
    <div className="progress-pct">
      <div className={`bar ${tone}`}><i style={{ width: `${p}%` }} /></div>
      <span>{p >= 99.95 ? "100" : p.toFixed(1)}%</span>
    </div>
  );
}

function AccountTag({ account }) {
  if (!account) return <span className="mini-tag">—</span>;
  return <span className={account === "Healthcare" ? "mini-tag purple" : "mini-tag"}>{account}</span>;
}

/* ------------------------------- data ------------------------------- */

const byDateDesc = (a, b) => (String(a.date) < String(b.date) ? 1 : String(a.date) > String(b.date) ? -1 : (b.id || 0) - (a.id || 0));

function studentBatch(students, id) {
  const s = students.find((x) => x.id === id);
  return (s && s.batch) || "—";
}

function buildBatchSummary(students, collections) {
  const collectedByStudent = collections.reduce((m, c) => {
    m[c.student_id] = (m[c.student_id] || 0) + Number(c.amount || 0);
    return m;
  }, {});

  const byBatch = new Map();
  students.forEach((s) => {
    const key = (s.batch && String(s.batch).trim()) || "Unassigned";
    if (!byBatch.has(key)) {
      byBatch.set(key, { batch: key, students: 0, active: 0, completed: 0, dropped: 0, expected: 0, collected: 0, outstanding: 0 });
    }
    const b = byBatch.get(key);
    const paid = collectedByStudent[s.id] || 0;
    b.students += 1;
    if (s.status === "Active") b.active += 1;
    if (s.status === "Completed") b.completed += 1;
    if (s.status === "Dropped") b.dropped += 1;
    b.expected += effectiveFeeDue(s, paid);
    b.collected += paid;
    b.outstanding += outstanding(s, paid);
  });

  return Array.from(byBatch.values()).sort((a, b) => a.batch.localeCompare(b.batch));
}

function sumBatch(rows) {
  return rows.reduce(
    (t, b) => ({
      students: t.students + b.students,
      active: t.active + b.active,
      completed: t.completed + b.completed,
      dropped: t.dropped + b.dropped,
      expected: t.expected + b.expected,
      collected: t.collected + b.collected,
      outstanding: t.outstanding + b.outstanding,
    }),
    { students: 0, active: 0, completed: 0, dropped: 0, expected: 0, collected: 0, outstanding: 0 }
  );
}

function buildMonthlySeries(collections, expenses) {
  const buckets = new Map();
  const add = (dateStr, field, amount) => {
    if (!dateStr) return;
    const key = monthKeyOfISO(dateStr);
    if (!key) return;
    const label = monthShortOfKey(key);
    if (!buckets.has(key)) buckets.set(key, { key, month: label, revenue: 0, expense: 0 });
    buckets.get(key)[field] += Number(amount || 0);
  };
  collections.forEach((c) => add(c.date, "revenue", c.amount));
  expenses.forEach((e) => add(e.date, "expense", e.amount));

  const rows = Array.from(buckets.values()).sort((a, b) => a.key.localeCompare(b.key)).slice(-9);
  const nowKey = istToday().slice(0, 7);
  return rows.map((r) => ({
    ...r,
    month: r.key === nowKey ? `${r.month} (MTD)` : r.month,
    pnl: r.revenue - r.expense,
  }));
}
/* ------------------- Academy Suite dashboards ------------------- */

function useSuiteSnapshot(profile, role) {
  const [state, setState] = React.useState({ loading: true, pending: false, slots: [], assignments: [], subs: [], exams: [], attempts: [] });
  React.useEffect(() => {
    let live = true;
    (async () => {
      const mod = await import("../lib/academy.js");
      const [tt, asg, exs] = await Promise.all([mod.fetchTimetable(), mod.fetchAssignments(), mod.fetchExams()]);
      if (!live) return;
      if (tt.error?.suitePending || asg.error?.suitePending || exs.error?.suitePending) {
        setState((s) => ({ ...s, loading: false, pending: true }));
        return;
      }
      const [{ rows: subs }, { rows: attempts }] = await Promise.all([
        mod.fetchSubmissions(asg.rows.map((a) => a.id)),
        role === "faculty" ? Promise.resolve({ rows: [] }) : mod.fetchMyExamAttempts(profile?.id),
      ]);
      if (!live) return;
      setState({ loading: false, pending: false, slots: tt.rows, assignments: asg.rows, subs, exams: exs.rows, attempts });
    })();
    return () => { live = false; };
  }, [profile?.id, role]);
  return state;
}

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function SuitePendingCard() {
  return (
    <div className="dashboard-content">
      <div className="empty-state">
        <div className="empty-icon">🎓</div>
        <h3>Academy Suite setup pending</h3>
        <p>Run <code>supabase/migration-academy-suite-v2.sql</code> in Supabase, then set your batch on your profile.</p>
      </div>
    </div>
  );
}

function FacultyDashboard({ profile, onNavigate }) {
  const go = (tab) => () => onNavigate(tab);
  const snap = useSuiteSnapshot(profile, "faculty");
  const today = DOW[new Date().getDay()];
  const todayClasses = snap.slots.filter((s) => s.day_of_week === today && s.status !== "cancelled");
  const toGrade = snap.subs.filter((s) => s.status === "submitted");
  const drafts = snap.assignments.filter((a) => a.status === "draft").length;

  if (snap.pending) return <SuitePendingCard />;

  return (
    <div className="dashboard-content">
      <div className="dash-row four">
        <StatTile label="Today's classes" value={todayClasses.length} icon="📅" accent="blue" onClick={go("Timetable")} />
        <StatTile label="Submissions to grade" value={toGrade.length} icon="📝" accent="amber" valueTone={toGrade.length ? "warn" : undefined} onClick={go("Assignments")} />
        <StatTile label="Assignments" value={snap.assignments.length} icon="📋" accent="violet" caption={drafts ? drafts + " draft" : "all published"} onClick={go("Assignments")} />
        <StatTile label="Exams" value={snap.exams.length} icon="🧪" accent="green" onClick={go("Exams")} />
      </div>

      <div className="dash-row two-50-50" style={{ marginTop: "1rem" }}>
        <SectionCard icon="📅" accent="blue" title={"Today · " + today} subtitle="Your classes" action={{ label: "Timetable", onClick: go("Timetable") }}>
          {todayClasses.length === 0 ? <p className="table-sub">No classes today.</p> : (
            <table><tbody>
              {todayClasses.map((s) => (
                <tr key={s.id}><td>{(s.starts_at || "").slice(0, 5)}</td><td><strong>{s.subject}</strong></td><td><span className="mini-tag">{s.batch_name}</span></td></tr>
              ))}
            </tbody></table>
          )}
        </SectionCard>
        <SectionCard icon="📝" accent="amber" title="Awaiting your review" subtitle="Ungraded submissions" action={{ label: "Open", onClick: go("Assignments") }}>
          {toGrade.length === 0 ? <p className="table-sub">Nothing pending.</p> : (
            <table><tbody>
              {toGrade.slice(0, 8).map((s) => {
                const a = snap.assignments.find((x) => x.id === s.assignment_id);
                return <tr key={s.id}><td>{a?.title || "—"}</td><td className="table-sub">{(s.submitted_at || "").slice(0, 10)}</td></tr>;
              })}
            </tbody></table>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

function LearnerDashboard({ profile, onNavigate, role }) {
  const go = (tab) => () => onNavigate(tab);
  const snap = useSuiteSnapshot(profile, role);
  const today = DOW[new Date().getDay()];
  const hasBatch = !!profile?.batch_name;
  const todayClasses = snap.slots.filter((s) => s.day_of_week === today && s.status !== "cancelled");
  const pendingAsg = snap.assignments.filter(
    (a) => a.status === "published" && !snap.subs.some((s) => s.assignment_id === a.id && s.student_id === profile?.id)
  );
  const openExams = snap.exams.filter(
    (e) => e.status === "published" && !snap.attempts.some((t) => t.exam_id === e.id && t.submitted_at)
  );
  const results = snap.attempts.filter((t) => t.submitted_at);

  if (snap.pending) return <SuitePendingCard />;

  return (
    <div className="dashboard-content">
      {!hasBatch && (
        <div className="auth-message error" style={{ marginBottom: "1rem" }}>
          Your account isn't linked to a batch yet — ask an admin to set it so your classes and assignments show up.
        </div>
      )}
      <div className="dash-row four">
        <StatTile label="Today's classes" value={todayClasses.length} icon="📅" accent="blue" onClick={go("Timetable")} />
        <StatTile label="Pending assignments" value={pendingAsg.length} icon="📋" accent="amber" valueTone={pendingAsg.length ? "warn" : undefined} onClick={go("Assignments")} />
        <StatTile label="Open exams" value={openExams.length} icon="📝" accent="violet" onClick={go("Exams")} />
        <StatTile label="Results" value={results.length} icon="🎯" accent="green" onClick={go("Exams")} />
      </div>

      <div className="dash-row two-50-50" style={{ marginTop: "1rem" }}>
        <SectionCard icon="📅" accent="blue" title={"Today · " + today} subtitle="Your classes" action={{ label: "Timetable", onClick: go("Timetable") }}>
          {todayClasses.length === 0 ? <p className="table-sub">No classes today.</p> : (
            <table><tbody>
              {todayClasses.map((s) => (
                <tr key={s.id}>
                  <td>{(s.starts_at || "").slice(0, 5)}</td>
                  <td><strong>{s.subject}</strong></td>
                  <td>{s.mode === "live" && s.join_link ? <button className="button secondary small" onClick={go("Live Class")}>Join</button> : null}</td>
                </tr>
              ))}
            </tbody></table>
          )}
        </SectionCard>
        <SectionCard icon="📋" accent="amber" title="To do" subtitle="Assignments & exams" action={{ label: "Assignments", onClick: go("Assignments") }}>
          {pendingAsg.length === 0 && openExams.length === 0 ? <p className="table-sub">You're all caught up.</p> : (
            <table><tbody>
              {pendingAsg.slice(0, 6).map((a) => (
                <tr key={a.id}><td>📋 {a.title}</td><td className="table-sub">{a.due_date ? "due " + a.due_date : ""}</td></tr>
              ))}
              {openExams.slice(0, 4).map((e) => (
                <tr key={e.id}><td>📝 {e.title}</td><td className="table-sub">{e.duration_minutes} min</td></tr>
              ))}
            </tbody></table>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

function StudentDashboard({ profile, onNavigate }) {
  return <LearnerDashboard profile={profile} onNavigate={onNavigate} role="student" />;
}

function ProfessionalDashboard({ profile, onNavigate }) {
  return <LearnerDashboard profile={profile} onNavigate={onNavigate} role="professional" />;
}
