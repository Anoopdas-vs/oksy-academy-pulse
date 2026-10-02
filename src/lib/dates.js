// Timezone-safe date helpers. Dates in the database are plain 'YYYY-MM-DD'
// strings (Postgres `date`), so they are handled as calendar days — never
// round-tripped through toISOString(), which converts to UTC and can move a
// local-midnight date back one day (IST is UTC+05:30).

const pad2 = (n) => String(n).padStart(2, "0");

// 'YYYY-MM-DD' from a Date using its LOCAL calendar fields (no UTC shift).
export function localDateString(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

const MS_PER_DAY = 86400000;

// Calendar-day arithmetic on 'YYYY-MM-DD' strings. Uses UTC internally on
// both sides of the conversion, so no timezone or DST is involved.
function toDayNumber(iso) {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / MS_PER_DAY;
}

function fromDayNumber(n) {
  const d = new Date(n * MS_PER_DAY);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function addDaysISO(iso, days) {
  const n = toDayNumber(iso);
  return Number.isNaN(n) ? null : fromDayNumber(n + days);
}

// Whole days from `a` to `b` (b - a).
export function daysBetweenISO(a, b) {
  return toDayNumber(b) - toDayNumber(a);
}

// 'YYYY-MM' of a 'YYYY-MM-DD' string, or null if it isn't one.
export function monthKeyOfISO(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-\d{2}/);
  return m ? `${m[1]}-${m[2]}` : null;
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Jan".."Dec" for a 'YYYY-MM' key.
export function monthShortOfKey(key) {
  return MONTH_SHORT[Number(String(key).slice(5, 7)) - 1] || "";
}

// 'YYYY-MM-DD' from an Excel serial day count (1900 date system). Pure UTC
// arithmetic — 25569 is the serial of 1970-01-01.
export function excelSerialToISO(serial) {
  if (typeof serial !== "number" || !Number.isFinite(serial)) return null;
  return fromDayNumber(Math.floor(serial) - 25569);
}
