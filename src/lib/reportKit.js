// Shared building blocks for the Reports tab (pure, no React).
//
// A report's build() may return either the legacy shape
//   { columns, rows, summary }
// or the structured "corporate" shape
//   { kpis, tables: [{ title?, columns, rows, note? }], exceptions, notes, basis }
// normalizeReport() turns both into the structured shape so the page and the
// Excel export only deal with one model.
//
// Column: { key, label, money?, pct?, num?, change? }   (change = colour +/−)
// Row:    plain object; optional `_kind`: "group" | "subtotal" | "total"
//         and `_tone`: "neg" | "warn" to tint a row.
// KPI:    { label, value, kind: "money" | "pct" | "num" | "text", tone?, caption? }

const pad = (n) => String(n).padStart(2, "0");
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => {
  const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
};
const lastDayOfMonth = (y, m0) => new Date(y, m0 + 1, 0).getDate();

export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-04" -> "Apr 2026"
export function monthLabel(ym) {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTH_SHORT[m - 1]} ${y}`;
}

// ISO day before `iso`.
export function dayBefore(iso) {
  const d = parse(iso);
  d.setDate(d.getDate() - 1);
  return isoOf(d);
}

// The comparison period for `range` ({ start, end } inclusive ISO dates):
//   * a whole financial year (1 Apr -> 31 Mar)  -> the previous FY
//   * whole calendar months                      -> the same number of months just before
//   * anything else                              -> the same number of days just before
// null when there is nothing to compare (all time, or an open-ended range).
export function previousRange(range) {
  if (!range || !range.start || !range.end) return null;
  const s = parse(range.start);
  const e = parse(range.end);
  const wholeMonths = s.getDate() === 1 && e.getDate() === lastDayOfMonth(e.getFullYear(), e.getMonth());
  if (wholeMonths) {
    const months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1;
    const ps = new Date(s.getFullYear(), s.getMonth() - months, 1);
    const pe = new Date(s.getFullYear(), s.getMonth(), 0);
    return { start: isoOf(ps), end: isoOf(pe) };
  }
  const days = Math.round((e - s) / 86400000) + 1;
  const pe = new Date(s);
  pe.setDate(pe.getDate() - 1);
  const ps = new Date(pe);
  ps.setDate(ps.getDate() - (days - 1));
  return { start: isoOf(ps), end: isoOf(pe) };
}

// Every "YYYY-MM" from the range's first to last month. For an open range the
// missing bound comes from the data's own dates (`dates`), else today.
export function monthsInRange(range, dates = [], today = new Date()) {
  const sorted = dates.filter(Boolean).map((d) => String(d).slice(0, 10)).sort();
  const start = range?.start || sorted[0] || isoOf(today);
  const end = range?.end || sorted[sorted.length - 1] || isoOf(today);
  if (start > end) return [];
  const out = [];
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  const endKey = end.slice(0, 7);
  for (let guard = 0; guard < 600; guard++) {
    const key = `${y}-${pad(m)}`;
    out.push(key);
    if (key >= endKey) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

// Last ISO day of "YYYY-MM".
export function monthEnd(ym) {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${pad(lastDayOfMonth(y, m - 1))}`;
}

// % change from `prev` to `cur`; null when there is no base to compare.
export function pctChange(cur, prev) {
  if (!prev) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

// Share of `part` in `whole`, as a percentage; null when whole is 0.
export function share(part, whole) {
  if (!whole) return null;
  return (part / whole) * 100;
}

const INR = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

// Corporate money format: ₹1,25,000 · negatives in brackets (₹12,500) · zero "–".
export function formatReportMoney(n) {
  if (n === null || n === undefined || n === "") return "";
  const v = Math.round(Number(n));
  if (!v) return "–";
  return v < 0 ? `(₹${INR.format(-v)})` : `₹${INR.format(v)}`;
}

export function formatPct(n, { signed = false } = {}) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "–";
  const v = Number(n);
  const txt = `${Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)}%`;
  return signed && v > 0 ? `+${txt}` : txt;
}

export function formatCount(n) {
  if (n === null || n === undefined || n === "") return "";
  return Number(n) ? INR.format(Number(n)) : "–";
}

// Display text for one cell.
export function formatCell(col, value) {
  if (value === null || value === undefined) return "";
  if (col.money) return formatReportMoney(value);
  if (col.pct) return formatPct(value, { signed: !!col.change });
  if (col.num) return formatCount(value);
  return String(value);
}

// CSS tone for a numeric cell: negatives red; with `change`, + green / − red
// (or the reverse when `col.invert` / `row._invert`, e.g. a rise in an
// expense is bad).
export function cellTone(col, value, row = {}) {
  if (value === null || value === undefined || value === "" || !(col.money || col.pct)) return "";
  const v = Number(value);
  if (!v) return "";
  if (col.change) {
    const invert = !!col.invert !== !!row._invert;
    const good = invert ? v < 0 : v > 0;
    return good ? "pos" : "neg";
  }
  return v < 0 ? "neg" : "";
}

export function formatKpi(k) {
  if (k.kind === "money") return formatReportMoney(k.value);
  if (k.kind === "pct") return formatPct(k.value);
  if (k.kind === "num") return formatCount(k.value) || "–";
  return k.value === null || k.value === undefined || k.value === "" ? "–" : String(k.value);
}

// Both report shapes -> { kpis, tables, exceptions, notes, basis, summary, structured }
export function normalizeReport(result) {
  if (!result) return { kpis: [], tables: [], exceptions: [], notes: [], structured: false };
  if (result.tables) {
    return {
      kpis: result.kpis || [],
      tables: result.tables,
      exceptions: result.exceptions || [],
      notes: result.notes || [],
      basis: result.basis || "",
      summary: result.summary || "",
      structured: true,
    };
  }
  return {
    kpis: [],
    tables: [{ columns: result.columns || [], rows: result.rows || [] }],
    exceptions: [],
    notes: [],
    basis: "",
    summary: result.summary || "",
    structured: false,
  };
}

// Rows for an Excel sheet: the header block, the KPIs, then every table with
// its title, header and rows (raw numbers so Excel can total them), then the
// exceptions and notes.  -> array of arrays
export function reportToSheetRows({ orgName, reportName, periodLabel, generated, model }) {
  const out = [[`${orgName} — ${reportName}`], [`Period: ${periodLabel}`], [`Generated: ${generated}`]];
  if (model.basis) out.push([`Basis: ${model.basis}`]);
  out.push([]);
  if (model.kpis.length) {
    out.push(model.kpis.map((k) => k.label));
    out.push(model.kpis.map((k) => (k.kind === "money" || k.kind === "num" || k.kind === "pct" ? k.value ?? "" : k.value ?? "")));
    out.push([]);
  }
  model.tables.forEach((t) => {
    if (t.title) out.push([t.title]);
    out.push(t.columns.map((c) => c.label));
    t.rows.forEach((r) =>
      out.push(
        t.columns.map((c) => {
          const v = r[c.key];
          if (v === null || v === undefined) return "";
          if (c.pct) return Number.isFinite(Number(v)) ? Math.round(Number(v) * 10) / 10 : "";
          return v;
        })
      )
    );
    if (t.note) out.push([t.note]);
    out.push([]);
  });
  if (model.exceptions.length) {
    out.push(["Needs attention"]);
    model.exceptions.forEach((e) => out.push([e]));
    out.push([]);
  }
  model.notes.forEach((n) => out.push([n]));
  return out;
}
