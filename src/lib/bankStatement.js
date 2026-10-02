import { localDateString, excelSerialToISO } from "./dates.js";
// Bank statement parser. Dynamically loads xlsx on demand when a statement is uploaded.
// Parse an uploaded bank statement workbook into a normalised shape:
//   { periodStart, periodEnd, openingBalance, closingBalance, lines: [...] }
// where each line is
//   { seq, date, description, reference, withdrawal, deposit, runningBalance }
//
// Tuned for the ICICI "Detailed Statement" export (Withdrawal / Deposit /
// Balance columns) but tolerant of other layouts: it locates the header row
// by name and skips any preamble and the legend footer automatically.

// Absolute rupee value of a cell. Handles "1,00,000.00", "₹1,000", "500.00 Dr",
// "(500.00)" and blanks.
const num = (v) => {
  if (v === undefined || v === null || v === "") return 0;
  if (typeof v === "number") return Math.abs(v);
  const s = String(v).replace(/[,\s₹()]/g, "").replace(/(dr|cr)$/i, "");
  const n = Number(s);
  return Number.isFinite(n) ? Math.abs(n) : 0;
};

// Signed value — used for the running balance, which can be negative.
const signedNum = (v) => {
  if (v === undefined || v === null || v === "") return 0;
  if (typeof v === "number") return v;
  let s = String(v).replace(/[,\s₹]/g, "");
  let sign = 1;
  if (/^\(.*\)$/.test(s)) sign = -1;
  s = s.replace(/[()]/g, "");
  if (/dr$/i.test(s)) sign = -1;
  s = s.replace(/(dr|cr)$/i, "");
  const n = Number(s);
  return Number.isFinite(n) ? sign * n : 0;
};

// "Dr" / "Cr" / "D" / "C" / "debit" / "credit" -> 'dr' | 'cr' | null
const drcr = (v) => {
  const s = String(v || "").trim().toLowerCase();
  if (/^d(r|ebit)?$/.test(s) || s.includes("debit") || / dr$/.test(` ${s}`)) return "dr";
  if (/^c(r|redit)?$/.test(s) || s.includes("credit") || / cr$/.test(` ${s}`)) return "cr";
  return null;
};

const MONTHS = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

export function parseStatementDate(value) {
  if (value === undefined || value === null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // Local calendar fields, not toISOString(): SheetJS builds cellDates at
    // local midnight, which UTC conversion would move back a day in IST.
    return localDateString(value);
  }
  // Raw Excel serial (cell not recognised as a date), e.g. 45876 -> 2025-08-07.
  if (typeof value === "number" && value > 20000 && value < 80000) {
    return excelSerialToISO(value);
  }
  const s = String(value).trim();

  // 07/Aug/2025  or  7-Aug-25
  let m = s.match(/^(\d{1,2})[/-]([A-Za-z]{3})[A-Za-z]*[/-](\d{2,4})/);
  if (m) {
    const mm = MONTHS[m[2].toLowerCase()];
    if (mm) {
      const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
      return `${yyyy}-${mm}-${m[1].padStart(2, "0")}`;
    }
  }
  // 07/08/2025  or  07-08-2025  (assume DD/MM/YYYY — Indian statements)
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) {
    const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yyyy}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  // 2025-08-07
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  return null;
}

const findCol = (header, ...res) =>
  header.findIndex((h) => {
    const t = String(h || "").toLowerCase();
    return res.some((re) => re.test(t));
  });

export async function parseBankStatement(fileBuffer) {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(fileBuffer, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });

  // Locate the header row: the first row that has a date-ish column plus
  // either debit/credit columns or a single amount column.
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 60); i += 1) {
    const joined = rows[i].map((c) => String(c || "").toLowerCase()).join(" | ");
    const hasDate = /date/.test(joined);
    const hasDrCr = /withdrawal|deposit|debit|credit/.test(joined);
    const hasAmount = /amount|\bamt\b/.test(joined);
    if (hasDate && (hasDrCr || hasAmount) && /balance/.test(joined)) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    throw new Error(
      "Could not find the table header. Expected columns like Date, Debit/Credit (or Amount), and Balance."
    );
  }

  const header = rows[headerIdx];
  const col = {
    seq: findCol(header, /^s\.?\s*n/, /^sr\.?$/, /^#$/, /serial/, /sl\.? ?no/),
    date: findCol(header, /transaction date/, /txn date/, /^date$/, /value date/, /date/),
    desc: findCol(header, /remark/, /description/, /narration/, /particular/, /details/),
    ref: findCol(header, /cheque/, /ref/, /utr/, /instrument/),
    withdrawal: findCol(header, /withdrawal/, /debit(?! ?\/)/, /dr amount/, /^dr$/),
    deposit: findCol(header, /deposit/, /credit(?! ?\/)/, /cr amount/, /^cr$/),
    amount: findCol(header, /^amount$/, /^amt$/, /transaction amount/, /txn amount/),
    drcr: findCol(header, /dr ?\/ ?cr/, /cr ?\/ ?dr/, /type/, /indicator/),
    balance: findCol(header, /closing balance/, /balance/),
  };
  if (col.date === -1 || col.balance === -1) {
    throw new Error("Statement is missing a Date or Balance column.");
  }
  const singleAmount = col.withdrawal === -1 && col.deposit === -1 && col.amount !== -1;

  const lines = [];
  let prevBalance = null;
  for (let i = headerIdx + 1; i < rows.length; i += 1) {
    const r = rows[i];
    const date = parseStatementDate(r[col.date]);
    if (!date) continue; // preamble / legend / blank rows
    const balance = signedNum(r[col.balance]);

    let withdrawal = 0;
    let deposit = 0;
    if (singleAmount) {
      const amt = num(r[col.amount]);
      let sign = col.drcr !== -1 ? drcr(r[col.drcr]) : null;
      if (!sign && col.drcr !== -1) sign = drcr(r[col.amount]); // "500 Dr" in the amount cell
      if (!sign && prevBalance !== null) sign = balance >= prevBalance ? "cr" : "dr";
      if (sign === "dr") withdrawal = amt;
      else deposit = amt;
    } else {
      withdrawal = col.withdrawal === -1 ? 0 : num(r[col.withdrawal]);
      deposit = col.deposit === -1 ? 0 : num(r[col.deposit]);
    }
    prevBalance = balance;
    if (withdrawal === 0 && deposit === 0) continue;

    lines.push({
      seq: col.seq === -1 ? lines.length + 1 : Number(num(r[col.seq])) || lines.length + 1,
      date,
      description: col.desc === -1 ? "" : String(r[col.desc] || "").trim(),
      reference: col.ref === -1 ? "" : String(r[col.ref] || "").trim(),
      withdrawal,
      deposit,
      runningBalance: balance,
    });
  }

  if (!lines.length) throw new Error("No transaction rows found in the statement.");

  const first = lines[0];
  const last = lines[lines.length - 1];
  const closingBalance = last.runningBalance;
  const openingBalance = first.runningBalance - first.deposit + first.withdrawal;

  return {
    periodStart: first.date,
    periodEnd: last.date,
    openingBalance,
    closingBalance,
    lines,
  };
}
