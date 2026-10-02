// Tests for the timezone-safe date helpers (dates.js), today() (format.js)
// and statement-date parsing (bankStatement.js). Process TZ is not assumed:
// IST instants are built from explicit UTC offsets.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  localDateString, addDaysISO, daysBetweenISO, monthKeyOfISO, monthShortOfKey, excelSerialToISO, formatDayMonthYear,
} from "./dates.js";
import { today } from "./format.js";
import { parseStatementDate } from "./bankStatement.js";

describe("today() — India calendar date", () => {
  test("00:30 IST is still that IST day (UTC date is the previous day)", () => {
    assert.equal(today(new Date("2026-06-01T00:30:00+05:30")), "2026-06-01");
  });
  test("23:30 IST is still that IST day", () => {
    assert.equal(today(new Date("2026-06-01T23:30:00+05:30")), "2026-06-01");
  });
  test("crosses the day at IST midnight", () => {
    assert.equal(today(new Date("2026-06-01T23:59:59+05:30")), "2026-06-01");
    assert.equal(today(new Date("2026-06-02T00:00:00+05:30")), "2026-06-02");
  });
});

describe("localDateString / parseStatementDate with Date objects", () => {
  test("a Date at local midnight keeps its calendar day", () => {
    assert.equal(localDateString(new Date(2025, 7, 7, 0, 0, 0)), "2025-08-07");
    assert.equal(parseStatementDate(new Date(2025, 7, 7, 0, 0, 0)), "2025-08-07");
  });
  test("a Date at local 23:30 keeps its calendar day", () => {
    assert.equal(parseStatementDate(new Date(2025, 11, 31, 23, 30)), "2025-12-31");
  });
  test("invalid Date is rejected", () => {
    assert.equal(parseStatementDate(new Date("nope")), null);
  });
});

describe("Excel serial dates", () => {
  test("known serials", () => {
    assert.equal(excelSerialToISO(25569), "1970-01-01");
    assert.equal(excelSerialToISO(45876), "2025-08-07");
    assert.equal(excelSerialToISO(46174), "2026-06-01");
  });
  test("fractional serial (time of day) does not change the day", () => {
    assert.equal(excelSerialToISO(45876.99), "2025-08-07");
  });
  test("parseStatementDate accepts serials; text formats unchanged", () => {
    assert.equal(parseStatementDate(45876), "2025-08-07");
    assert.equal(parseStatementDate("07/08/2025"), "2025-08-07");
    assert.equal(parseStatementDate("7-Aug-25"), "2025-08-07");
    assert.equal(parseStatementDate("2025-08-07"), "2025-08-07");
    assert.equal(parseStatementDate(5), null);
  });
});

describe("ISO calendar-day arithmetic", () => {
  test("addDaysISO across month/year/leap boundaries", () => {
    assert.equal(addDaysISO("2026-03-01", -1), "2026-02-28");
    assert.equal(addDaysISO("2024-03-01", -1), "2024-02-29");
    assert.equal(addDaysISO("2025-12-31", 1), "2026-01-01");
    assert.equal(addDaysISO("garbage", 1), null);
  });
  test("daysBetweenISO is inclusive-span length", () => {
    assert.equal(daysBetweenISO("2026-04-01", "2027-03-31"), 364);
    assert.equal(daysBetweenISO("2026-06-01", "2026-06-01"), 0);
  });
  test("previous window of equal length (Dashboard logic)", () => {
    const start = "2026-06-01", end = "2026-06-30";
    const len = daysBetweenISO(start, end);
    const pe = addDaysISO(start, -1);
    assert.equal(pe, "2026-05-31");
    assert.equal(addDaysISO(pe, -len), "2026-05-02");
  });
  test("month key / label come from the string, not a Date", () => {
    assert.equal(monthKeyOfISO("2026-06-01"), "2026-06");
    assert.equal(monthKeyOfISO("2026-06-01T00:00:00Z"), "2026-06");
    assert.equal(monthKeyOfISO(""), null);
    assert.equal(monthShortOfKey("2026-06"), "Jun");
    assert.equal(monthShortOfKey("2026-01"), "Jan");
  });
});

describe("formatDayMonthYear", () => {
  test("formats an ISO day as 'dd Mon yyyy' (the Match popup header)", () => {
    assert.equal(formatDayMonthYear("2026-03-04"), "04 Mar 2026");
    assert.equal(formatDayMonthYear("2025-12-31T10:00:00Z"), "31 Dec 2025");
  });
  test("returns an empty string for anything that is not a date", () => {
    assert.equal(formatDayMonthYear(""), "");
    assert.equal(formatDayMonthYear(null), "");
    assert.equal(formatDayMonthYear("soon"), "");
  });
});
