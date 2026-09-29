import React, { useMemo, useState } from "react";
import { formatMoney } from "../lib/format.js";
import { SearchBox } from "../components/SearchPager.jsx";
import { REPORTS, exportReportToXlsx } from "../lib/reports.js";
import { STAFF_REPORT_IDS } from "../lib/access.js";

export default function ReportsPage({ data, range, periodLabel = "All time", allReports = true }) {
  const [openId, setOpenId] = useState(null);
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
                <h3>{r.name}</h3>
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
      onBack={() => setOpenId(null)}
    />
  );
}

function ReportView({ report, data, range, periodLabel, onBack }) {
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

  const result = useMemo(
    () => report.build(data, filters, range),
    [report, data, filters, range]
  );

  const rows = useMemo(() => {
    let out = result.rows;
    if (query.trim()) {
      const q = query.toLowerCase();
      out = out.filter((r) =>
        result.columns.some((c) => String(r[c.key] ?? "").toLowerCase().includes(q))
      );
    }
    if (sort) {
      const col = result.columns.find((c) => c.key === sort.key);
      const dir = sort.dir === "desc" ? -1 : 1;
      out = [...out].sort((a, b) => {
        const x = a[sort.key] ?? "";
        const y = b[sort.key] ?? "";
        const cmp = col?.money ? Number(x) - Number(y) : String(x).localeCompare(String(y), undefined, { numeric: true });
        return cmp * dir;
      });
    }
    return out;
  }, [result, query, sort]);

  const toggleSort = (key) =>
    setSort((cur) => (cur?.key === key ? (cur.dir === "asc" ? { key, dir: "desc" } : null) : { key, dir: "asc" }));

  const fileName = `${report.name.replace(/[^\w]+/g, "_")}_${periodLabel.replace(/[^\w]+/g, "_")}.xlsx`;

  return (
    <section className="page">
      <div className="page-actions no-print">
        <button className="button ghost small" onClick={onBack}>← All reports</button>
        <strong className="report-title">{report.name}</strong>
        <span className="page-lead-inline">{report.description} · {periodLabel}</span>
        <span className="spacer" />
        {report.downloadable && (
          <button
            className="button secondary"
            onClick={() => exportReportToXlsx(fileName, result.columns, rows)}
          >
            Download Excel
          </button>
        )}
        <button className="button primary" onClick={() => window.print()}>Print / Save PDF</button>
      </div>

      <div className="report-controls no-print">
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
        <div className="report-search">
          <SearchBox value={query} onChange={setQuery} placeholder="Search this report..." />
        </div>
      </div>

      <div className="table-card print-area">
        <div className="report-print-head">
          <h3>OKSY ACADEMY LLP — {report.name}</h3>
          <p>Period: {periodLabel} · Generated {new Date().toLocaleDateString("en-IN")}</p>
          {result.summary && <p className="report-summary">{result.summary}</p>}
          <p className="report-rounding-note">
            Amounts are rounded to the nearest ₹ for display; underlying records keep full paisa precision.
          </p>
        </div>
        <table>
          <thead>
            <tr>
              {result.columns.map((c) =>
                report.sortable ? (
                  <th
                    key={c.key}
                    className={`${c.money ? "ra " : ""}sortable`}
                    aria-sort={sort?.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                  >
                    <button type="button" className="th-sort" onClick={() => toggleSort(c.key)}>
                      {c.label}{sort?.key === c.key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                    </button>
                  </th>
                ) : (
                  <th key={c.key} className={c.money ? "ra" : ""}>{c.label}</th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={result.columns.length} className="table-empty">Nothing to show for this selection.</td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={i}>
                {result.columns.map((c) => (
                  <td key={c.key} className={c.money ? "ra" : ""}>
                    {r[c.key] === null || r[c.key] === undefined
                      ? ""
                      : c.money
                      ? formatMoney(r[c.key])
                      : String(r[c.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
