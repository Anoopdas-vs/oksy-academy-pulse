import React, { useMemo, useState } from "react";
import { SearchBox } from "../components/SearchPager.jsx";
import { REPORTS, exportReportToXlsx } from "../lib/reports.js";
import { STAFF_REPORT_IDS } from "../lib/access.js";
import {
  normalizeReport,
  formatCell,
  cellTone,
  formatKpi,
  reportToSheetRows,
  formatReportMoney,
  REPORT_PERIOD_PRESETS,
  resolveReportPeriod,
} from "../lib/reportKit.js";

// Organisation name printed on every report. Single-tenant today; kept in
// one place so a later white-label setting can replace it.
const ORG_NAME = "OKSY ACADEMY LLP";

const NEW_REPORTS = new Set(["account-wise", "monthly", "cash-bank", "batch-summary", "expense-category-month"]);

export default function ReportsPage({ data, range, periodLabel = "All time", allReports = true, preparedBy = "" }) {
  const [openId, setOpenId] = useState(null);
  // The report's own period (kept while moving between reports).
  const [periodChoice, setPeriodChoice] = useState({ preset: "global" });
  const list = allReports ? REPORTS : REPORTS.filter((r) => STAFF_REPORT_IDS.includes(r.id));
  const report = list.find((r) => r.id === openId) || null;

  if (!report) {
    return (
      <section className="page">
        <p className="page-lead">Preview any report, filter it, then download Excel or print / save as PDF · {periodLabel}</p>
        <div className="report-grid">
          {list.map((r) => (
            <button key={r.id} className="report-card as-button" onClick={() => setOpenId(r.id)}>
              <div className="report-icon">▤</div>
              <div>
                <h3>
                  {r.name} {NEW_REPORTS.has(r.id) && <span className="mini-tag ok">New</span>}
                </h3>
                <p>{r.description}</p>
              </div>
              <span className="edit-button">Open</span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  return (
    <ReportView
      report={report}
      data={data}
      range={range}
      periodLabel={periodLabel}
      preparedBy={preparedBy}
      periodChoice={periodChoice}
      onPeriodChoice={setPeriodChoice}
      onBack={() => setOpenId(null)}
    />
  );
}

// Print a report on A4 landscape. The app's default print CSS is set up for
// half-A4 receipts; the `print-report` class on <html> switches it to the
// report layout for the duration of this print only.
function printReport() {
  const root = document.documentElement;
  const page = document.createElement("style");
  page.textContent = "@page { size: A4 landscape; margin: 10mm; }";
  document.head.appendChild(page);
  root.classList.add("print-report");
  const done = () => {
    root.classList.remove("print-report");
    page.remove();
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  window.print();
}

function PeriodPicker({ choice, onChange, globalLabel }) {
  const set = (patch) => onChange({ ...choice, ...patch });
  return (
    <>
      <div className="field">
        <label>Period</label>
        <select value={choice.preset} onChange={(e) => set({ preset: e.target.value })}>
          {REPORT_PERIOD_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.value === "global" ? `${p.label} (${globalLabel})` : p.label}
            </option>
          ))}
        </select>
      </div>
      {choice.preset === "month" && (
        <div className="field">
          <label>Month</label>
          <input type="month" value={choice.month || ""} onChange={(e) => set({ month: e.target.value })} />
        </div>
      )}
      {choice.preset === "custom" && (
        <>
          <div className="field">
            <label>From</label>
            <input type="date" value={choice.start || ""} onChange={(e) => set({ start: e.target.value })} />
          </div>
          <div className="field">
            <label>To</label>
            <input type="date" value={choice.end || ""} onChange={(e) => set({ end: e.target.value })} />
          </div>
        </>
      )}
    </>
  );
}

function ReportView({ report, data, range: globalRange, periodLabel: globalLabel, preparedBy, periodChoice, onPeriodChoice, onBack }) {
  const own = useMemo(() => resolveReportPeriod(periodChoice), [periodChoice]);
  const range = own ? own.range : globalRange;
  const periodLabel = own ? own.label : globalLabel;
  const filterDefs = useMemo(
    () =>
      (report.filters || []).map((f) => ({
        ...f,
        options: f.optionsFrom ? f.optionsFrom(data) : f.options,
      })),
    [report, data]
  );
  const [filters, setFilters] = useState(
    Object.fromEntries(filterDefs.map((f) => [f.key, f.options[0]]))
  );
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState(null); // { key, dir } — only for reports with sortable: true
  // Stamped when the report is opened (ReportView remounts per report).
  const [generated] = useState(() => new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }));

  const raw = useMemo(() => report.build(data, filters, range), [report, data, filters, range]);
  const model = useMemo(() => normalizeReport(raw), [raw]);

  // Search + sort apply only to legacy single-table reports; structured
  // reports have group / subtotal rows whose order is the point.
  const tables = useMemo(() => {
    if (model.structured) return model.tables;
    const t = model.tables[0];
    let out = t.rows;
    if (query.trim()) {
      const q = query.toLowerCase();
      out = out.filter((r) => t.columns.some((c) => String(r[c.key] ?? "").toLowerCase().includes(q)));
    }
    if (sort) {
      const col = t.columns.find((c) => c.key === sort.key);
      const dir = sort.dir === "desc" ? -1 : 1;
      out = [...out].sort((a, b) => {
        const x = a[sort.key] ?? "";
        const y = b[sort.key] ?? "";
        const cmp = col?.money ? Number(x) - Number(y) : String(x).localeCompare(String(y), undefined, { numeric: true });
        return cmp * dir;
      });
    }
    return [{ ...t, rows: out }];
  }, [model, query, sort]);

  const toggleSort = (key) =>
    setSort((cur) => (cur?.key === key ? (cur.dir === "asc" ? { key, dir: "desc" } : null) : { key, dir: "asc" }));

  const fileName = `${report.name.replace(/[^\w]+/g, "_")}_${periodLabel.replace(/[^\w]+/g, "_")}.xlsx`;

  const download = async () => {
    if (!model.structured) {
      await exportReportToXlsx(fileName, tables[0].columns, tables[0].rows);
      return;
    }
    // Some registers export their plain rows (re-uploadable template shape).
    if (model.exportTable) {
      await exportReportToXlsx(fileName, model.exportTable.columns, model.exportTable.rows);
      return;
    }
    try {
      const XLSX = await import("xlsx");
      const aoa = reportToSheetRows({
        orgName: ORG_NAME,
        reportName: report.name,
        periodLabel,
        generated: `${generated}${preparedBy ? ` by ${preparedBy}` : ""}`,
        model: { ...model, tables },
      });
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const widest = Math.max(...tables.map((t) => t.columns.length), 4);
      ws["!cols"] = Array.from({ length: widest }, (_, i) => ({ wch: i === 0 ? 34 : 16 }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Report");
      XLSX.writeFile(wb, fileName);
    } catch (err) {
      alert(`Could not build the Excel file: ${err?.message || err}`);
    }
  };

  return (
    <section className="page">
      <div className="page-actions no-print">
        <button className="button ghost small" onClick={onBack}>← All reports</button>
        <strong className="report-title">{report.name}</strong>
        <span className="page-lead-inline">{report.description}</span>
        <span className="spacer" />
        {report.downloadable && (
          <button className="button secondary" onClick={download}>
            Download Excel
          </button>
        )}
        <button className="button primary" onClick={printReport}>Print / Save PDF</button>
      </div>

      <div className="report-controls no-print">
        <PeriodPicker choice={periodChoice} onChange={onPeriodChoice} globalLabel={globalLabel} />
        {filterDefs.map((f) => (
          <div className="field" key={f.key}>
            <label>{f.label}</label>
            <select
              value={filters[f.key] ?? f.options[0]}
              onChange={(e) => setFilters({ ...filters, [f.key]: e.target.value })}
            >
              {f.options.map((o) => <option key={o}>{o}</option>)}
            </select>
          </div>
        ))}
        {!model.structured && (
          <div className="report-search">
            <SearchBox value={query} onChange={setQuery} placeholder="Search this report..." />
          </div>
        )}
      </div>

      <div className="table-card print-area rpt-sheet">
        <header className="rpt-head">
          <div>
            <div className="rpt-org">{ORG_NAME}</div>
            <h2 className="rpt-name">{report.name}</h2>
          </div>
          <dl className="rpt-meta">
            <div><dt>Period</dt><dd>{periodLabel}</dd></div>
            <div><dt>Generated</dt><dd>{generated}{preparedBy ? ` · ${preparedBy}` : ""}</dd></div>
            {model.basis && <div className="rpt-basis"><dt>Basis</dt><dd>{model.basis}</dd></div>}
          </dl>
        </header>

        {model.kpis.length > 0 && (
          <div className="rpt-kpis">
            {model.kpis.map((k) => (
              <div key={k.label} className={`rpt-kpi ${k.tone || ""}`}>
                <span>{k.label}</span>
                <strong>{formatKpi(k)}</strong>
                {k.caption && <small>{k.caption}</small>}
              </div>
            ))}
          </div>
        )}

        {!model.structured && model.summary && <p className="rpt-summary-line">{model.summary}</p>}

        {raw.chart?.type === "income-expense" && <IncomeExpenseChart points={raw.chart.points} />}

        {tables.map((t, ti) => (
          <div className="rpt-table-block" key={t.title || ti}>
            {t.title && <h3 className="rpt-table-title">{t.title}</h3>}
            <div className="table-scroll">
              <table className={model.structured ? "rpt-table" : ""}>
                <thead>
                  <tr>
                    {t.columns.map((c) => {
                      const right = c.money || c.pct || c.num;
                      return report.sortable && !model.structured ? (
                        <th
                          key={c.key}
                          className={`${right ? "ra " : ""}sortable`}
                          aria-sort={sort?.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                        >
                          <button type="button" className="th-sort" onClick={() => toggleSort(c.key)}>
                            {c.label}{sort?.key === c.key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                          </button>
                        </th>
                      ) : (
                        <th key={c.key} className={right ? "ra" : ""}>{c.label}</th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {t.rows.length === 0 && (
                    <tr><td colSpan={t.columns.length} className="table-empty">Nothing to show for this selection.</td></tr>
                  )}
                  {t.rows.map((r, i) =>
                    r._kind === "group" ? (
                      <tr key={i} className="rpt-row-group">
                        <td colSpan={t.columns.length}>{r[t.columns[0].key]}</td>
                      </tr>
                    ) : (
                      <tr key={i} className={[r._kind ? `rpt-row-${r._kind}` : "", r._tone ? `rpt-tone-${r._tone}` : ""].join(" ").trim() || undefined}>
                        {t.columns.map((c) => {
                          const right = c.money || c.pct || c.num;
                          const tone = cellTone(c, r[c.key], r);
                          const hot = r._hot?.includes(c.key);
                          return (
                            <td key={c.key} className={[right ? "ra" : "", tone ? `rpt-${tone}` : "", hot ? "rpt-hot" : ""].join(" ").trim() || undefined}>
                              {formatCell(c, r[c.key])}
                            </td>
                          );
                        })}
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
            {t.note && <p className="rpt-note">{t.note}</p>}
          </div>
        ))}

        {model.structured && (
          <div className={model.exceptions.length ? "rpt-attention" : "rpt-attention clear"}>
            <h3>Needs attention</h3>
            {model.exceptions.length ? (
              <ul>{model.exceptions.map((e) => <li key={e}>{e}</li>)}</ul>
            ) : (
              <p>Nothing unusual found for this period.</p>
            )}
          </div>
        )}

        <footer className="rpt-foot">
          {model.notes.map((n) => <p key={n}>{n}</p>)}
          <p>Amounts are rounded to the nearest ₹ for display; underlying records keep full paisa precision. Figures in brackets are negative.</p>
          <div className="rpt-sign print-only">
            <span>Prepared by: ____________________</span>
            <span>Checked by: ____________________</span>
          </div>
        </footer>
      </div>
    </section>
  );
}

// Grouped bars: income vs expenses per month. Plain SVG — no chart library.
function IncomeExpenseChart({ points }) {
  if (!points.length) return null;
  const W = 760;
  const H = 200;
  const padL = 56;
  const padB = 30;
  const padT = 10;
  const max = Math.max(1, ...points.map((p) => Math.max(p.income, p.expense)));
  const step = (W - padL) / points.length;
  const bw = Math.min(18, step / 3);
  const y = (v) => padT + (H - padT - padB) * (1 - v / max);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const short = (v) => (v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)));
  return (
    <figure className="rpt-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Income and expenses by month">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={y(t)} y2={y(t)} className="rpt-grid" />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" className="rpt-axis">₹{short(t)}</text>
          </g>
        ))}
        {points.map((p, i) => {
          const cx = padL + step * i + step / 2;
          return (
            <g key={`${p.label}${p.sub}${i}`}>
              <rect x={cx - bw - 1} y={y(p.income)} width={bw} height={Math.max(0, H - padB - y(p.income))} className="rpt-bar-inc">
                <title>{`${p.label} ${p.sub} income ${formatReportMoney(p.income)}`}</title>
              </rect>
              <rect x={cx + 1} y={y(p.expense)} width={bw} height={Math.max(0, H - padB - y(p.expense))} className="rpt-bar-exp">
                <title>{`${p.label} ${p.sub} expenses ${formatReportMoney(p.expense)}`}</title>
              </rect>
              <text x={cx} y={H - padB + 13} textAnchor="middle" className="rpt-axis">{p.label}</text>
              <text x={cx} y={H - padB + 24} textAnchor="middle" className="rpt-axis faint">{p.sub}</text>
            </g>
          );
        })}
      </svg>
      <figcaption>
        <span className="rpt-key inc" /> Income <span className="rpt-key exp" /> Expenses
      </figcaption>
    </figure>
  );
}
