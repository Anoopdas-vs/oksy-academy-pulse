// Report catalogue for the Reports tab. Each report:
//   { id, name, description, downloadable, filters?, build(data, filters, range) }
// build() returns the structured shape described in reportKit.js.
import { pnlReport, monthlyReport, cashBankReport, accountWiseReport } from "./financeReports.js";
import { batchSummaryReport, feeRegisterReport, studentDuesReport, categoryMonthReport } from "./feeReports.js";
import { expenseRegisterReport, transfersReport, healthcareStatementReport, studentRegisterReport } from "./opsReports.js";

export const REPORTS = [
  accountWiseReport,
  pnlReport,
  monthlyReport,
  cashBankReport,
  batchSummaryReport,
  feeRegisterReport,
  studentDuesReport,
  categoryMonthReport,
  expenseRegisterReport,
  transfersReport,
  healthcareStatementReport,
  studentRegisterReport,
];

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
