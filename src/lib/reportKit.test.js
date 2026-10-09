import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  previousRange,
  monthsInRange,
  monthLabel,
  monthEnd,
  pctChange,
  share,
  formatReportMoney,
  formatPct,
  cellTone,
  normalizeReport,
  reportToSheetRows,
} from "./reportKit.js";

describe("previousRange", () => {
  test("financial year -> previous financial year", () => {
    assert.deepEqual(previousRange({ start: "2026-04-01", end: "2027-03-31" }), { start: "2025-04-01", end: "2026-03-31" });
  });
  test("one month -> the month before (handles short months)", () => {
    assert.deepEqual(previousRange({ start: "2026-03-01", end: "2026-03-31" }), { start: "2026-02-01", end: "2026-02-28" });
    assert.deepEqual(previousRange({ start: "2026-01-01", end: "2026-01-31" }), { start: "2025-12-01", end: "2025-12-31" });
  });
  test("custom days -> same number of days just before", () => {
    assert.deepEqual(previousRange({ start: "2026-03-10", end: "2026-03-19" }), { start: "2026-02-28", end: "2026-03-09" });
  });
  test("all time / open range -> null", () => {
    assert.equal(previousRange(null), null);
    assert.equal(previousRange({ start: "2026-01-01", end: null }), null);
  });
});

describe("months", () => {
  test("monthsInRange spans the range inclusive", () => {
    assert.deepEqual(monthsInRange({ start: "2025-11-15", end: "2026-02-03" }), ["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
  test("open range falls back to the data's dates", () => {
    assert.deepEqual(monthsInRange(null, ["2026-03-05", "2026-01-20"]), ["2026-01", "2026-02", "2026-03"]);
  });
  test("labels and month ends", () => {
    assert.equal(monthLabel("2026-04"), "Apr 2026");
    assert.equal(monthEnd("2028-02"), "2028-02-29");
  });
});

describe("formatting", () => {
  test("money: Indian grouping, brackets for negatives, dash for zero", () => {
    assert.equal(formatReportMoney(125000), "₹1,25,000");
    assert.equal(formatReportMoney(-12500), "(₹12,500)");
    assert.equal(formatReportMoney(0), "–");
    assert.equal(formatReportMoney(null), "");
  });
  test("percent and change", () => {
    assert.equal(formatPct(12.345), "12.3%");
    assert.equal(formatPct(5, { signed: true }), "+5.0%");
    assert.equal(formatPct(null), "–");
    assert.equal(pctChange(150, 100), 50);
    assert.equal(pctChange(10, 0), null);
    assert.equal(share(25, 200), 12.5);
    assert.equal(share(1, 0), null);
  });
  test("cell tone: change columns colour by direction, expense rows inverted", () => {
    const col = { key: "chg", money: true, change: true };
    assert.equal(cellTone(col, 100), "pos");
    assert.equal(cellTone(col, -100), "neg");
    assert.equal(cellTone(col, 100, { _invert: true }), "neg");
    assert.equal(cellTone({ key: "x", money: true }, -5), "neg");
    assert.equal(cellTone({ key: "x", money: true }, 5), "");
  });
});

describe("normalizeReport + Excel rows", () => {
  test("legacy shape becomes one table", () => {
    const m = normalizeReport({ columns: [{ key: "a", label: "A" }], rows: [{ a: 1 }], summary: "s" });
    assert.equal(m.structured, false);
    assert.equal(m.tables.length, 1);
    assert.equal(m.summary, "s");
  });
  test("sheet rows carry header, KPIs, tables and attention items", () => {
    const model = normalizeReport({
      basis: "Cash basis",
      kpis: [{ label: "Income", value: 100, kind: "money" }],
      tables: [{ title: "T", columns: [{ key: "a", label: "A" }, { key: "p", label: "P", pct: true }], rows: [{ a: 5, p: 12.345 }] }],
      exceptions: ["Check X"],
      notes: ["Note"],
    });
    const aoa = reportToSheetRows({ orgName: "ORG", reportName: "R", periodLabel: "FY", generated: "now", model });
    assert.deepEqual(aoa[0], ["ORG — R"]);
    assert.ok(aoa.some((r) => r[0] === "Basis: Cash basis"));
    assert.ok(aoa.some((r) => r[0] === "Income" ) && aoa.some((r) => r[0] === 100));
    assert.ok(aoa.some((r) => r[0] === 5 && r[1] === 12.3));
    assert.ok(aoa.some((r) => r[0] === "Check X"));
    assert.deepEqual(aoa[aoa.length - 1], ["Note"]);
  });
});
