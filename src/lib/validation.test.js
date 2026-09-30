// Unit tests for validation.js — the shared guardrails every fee-collection,
// expense, and bulk-import form runs data through before it reaches
// Supabase, plus the friendlyError() mapping that turns raw Postgres/RLS
// errors (including "violates row-level security policy" — the signature of
// a blocked forged-record attempt, see docs/audits/02-security-audit.md
// C-1) into a message a non-technical staff member can act on.
//
// Run directly with: node --test src/lib
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  friendlyError,
  isBlank,
  isValidDateStr,
  isPositiveNumber,
  isValidAccount,
  isValidStatus,
  validateMoneyRow,
  VALID_ACCOUNTS,
  VALID_STATUSES,
  normalizePhone,
  isValidPhone,
  isValidEmail,
  validateStudentPersonal,
  preparePersonalFields,
  normalizeCourseCode,
} from "./validation.js";

describe("isBlank", () => {
  test("treats undefined, null, and whitespace-only strings as blank", () => {
    assert.equal(isBlank(undefined), true);
    assert.equal(isBlank(null), true);
    assert.equal(isBlank("   "), true);
    assert.equal(isBlank(""), true);
  });

  test("treats 0 and non-empty strings as not blank", () => {
    assert.equal(isBlank(0), false);
    assert.equal(isBlank("0"), false);
    assert.equal(isBlank("x"), false);
  });
});

describe("isValidDateStr / isPositiveNumber", () => {
  test("rejects blank or unparsable dates", () => {
    assert.equal(isValidDateStr(""), false);
    assert.equal(isValidDateStr("not-a-date"), false);
  });

  test("accepts a well-formed date string", () => {
    assert.equal(isValidDateStr("2026-09-14"), true);
  });

  test("rejects zero, negative, blank, and non-numeric amounts", () => {
    assert.equal(isPositiveNumber(0), false);
    assert.equal(isPositiveNumber(-5), false);
    assert.equal(isPositiveNumber(""), false);
    assert.equal(isPositiveNumber("abc"), false);
  });

  test("accepts a positive numeric string or number", () => {
    assert.equal(isPositiveNumber("100"), true);
    assert.equal(isPositiveNumber(0.5), true);
  });
});

describe("isValidAccount / isValidStatus", () => {
  test("only the four documented accounts are valid", () => {
    for (const a of VALID_ACCOUNTS) assert.equal(isValidAccount(a), true);
    assert.equal(isValidAccount("Random Bank"), false);
    assert.equal(isValidAccount(""), false);
  });

  test("only the four documented statuses are valid", () => {
    for (const s of VALID_STATUSES) assert.equal(isValidStatus(s), true);
    assert.equal(isValidStatus("Graduated"), false);
  });
});

describe("validateMoneyRow — the gate every fee/expense row passes through before Supabase", () => {
  test("a well-formed row has no problems", () => {
    assert.deepEqual(
      validateMoneyRow({ date: "2026-09-14", amount: 5000, account: "HDFC" }),
      []
    );
  });

  test("flags a missing date", () => {
    const problems = validateMoneyRow({ date: "", amount: 100, account: "Cash" });
    assert.ok(problems.some((p) => /date/i.test(p)));
  });

  test("flags a zero or negative amount", () => {
    for (const amount of [0, -100]) {
      const problems = validateMoneyRow({ date: "2026-09-14", amount, account: "Cash" });
      assert.ok(problems.some((p) => /amount/i.test(p)));
    }
  });

  test("flags an unrecognized account", () => {
    const problems = validateMoneyRow({ date: "2026-09-14", amount: 100, account: "Swiss Bank" });
    assert.ok(problems.some((p) => /account/i.test(p)));
  });

  test("an absent account is allowed (account is optional on this row shape)", () => {
    const problems = validateMoneyRow({ date: "2026-09-14", amount: 100 });
    assert.deepEqual(problems, []);
  });

  test("a row bad in every way reports every problem, not just the first", () => {
    const problems = validateMoneyRow({ date: "", amount: -1, account: "Nope" });
    assert.equal(problems.length, 3);
  });
});

describe("friendlyError — batch date order (migration 29)", () => {
  test("maps the batches_end_after_start check violation to a plain message", () => {
    const msg = friendlyError({
      message: 'new row for relation "batches" violates check constraint "batches_end_after_start"',
    });
    assert.equal(msg, "End date can't be before the start date.");
  });
});

describe("friendlyError — translating raw Postgres/RLS errors for non-technical staff", () => {
  test("maps a blocked-by-RLS write to a permission message, not the raw Postgres text", () => {
    const msg = friendlyError({ message: "new row violates row-level security policy for table" });
    assert.match(msg, /don't have permission/i);
  });

  test("maps a duplicate student id to a specific message", () => {
    const msg = friendlyError({ message: 'duplicate key value violates unique constraint "students_pkey"' });
    assert.match(msg, /Student ID already exists/i);
  });

  test("maps a generic duplicate key to a generic 'already exists' message", () => {
    const msg = friendlyError({ message: "duplicate key value violates unique constraint on collections" });
    assert.match(msg, /already exists/i);
  });

  test("maps an invalid numeric amount", () => {
    const msg = friendlyError({ message: 'invalid input syntax for type numeric: "abc"' });
    assert.match(msg, /amounts isn't a valid number/i);
  });

  test("maps a network failure to an actionable message", () => {
    const msg = friendlyError({ message: "TypeError: Failed to fetch" });
    assert.match(msg, /Couldn't reach the server/i);
  });

  test("falls back to the raw message when nothing else matches", () => {
    assert.equal(friendlyError({ message: "some other unexpected error" }), "some other unexpected error");
  });

  test("never throws and never returns a blank/[object Object] message for an empty or malformed error", () => {
    for (const err of [undefined, null, {}, ""]) {
      const msg = friendlyError(err);
      assert.equal(typeof msg, "string");
      assert.ok(msg.length > 0);
      assert.notEqual(msg, "[object Object]");
    }
  });
});

// Student personal fields (migration 24). The JS rules must agree with the
// database CHECK constraints: students_*_phone_format = '^[0-9]{10}$',
// students_student_email_format = basic something@something.tld.
describe("isValidPhone", () => {
  test("accepts exactly 10 digits, tolerating spaces and dashes", () => {
    assert.equal(isValidPhone("9847012345"), true);
    assert.equal(isValidPhone("98470 12345"), true);
    assert.equal(isValidPhone("984-701-2345"), true);
  });

  test("rejects too short, too long, country code, letters and blanks", () => {
    assert.equal(isValidPhone("984701234"), false);
    assert.equal(isValidPhone("98470123456"), false);
    assert.equal(isValidPhone("+919847012345"), false);
    assert.equal(isValidPhone("98470abcde"), false);
    assert.equal(isValidPhone(""), false);
    assert.equal(isValidPhone(null), false);
  });

  test("normalizePhone produces what the DB constraint checks", () => {
    assert.equal(normalizePhone(" 98470 12345 "), "9847012345");
    assert.match(normalizePhone("984-701-2345"), /^[0-9]{10}$/);
  });
});

describe("isValidEmail", () => {
  test("accepts ordinary addresses", () => {
    assert.equal(isValidEmail("student@example.com"), true);
    assert.equal(isValidEmail("a.b+tag@mail.co.in"), true);
  });

  test("rejects malformed addresses", () => {
    assert.equal(isValidEmail("student"), false);
    assert.equal(isValidEmail("student@"), false);
    assert.equal(isValidEmail("student@example"), false);
    assert.equal(isValidEmail("stu dent@example.com"), false);
    assert.equal(isValidEmail("a@@example.com"), false);
    assert.equal(isValidEmail(""), false);
  });
});

describe("validateStudentPersonal", () => {
  const valid = {
    student_phone: "9847012345",
    parent_name: "Ravi",
    parent_phone: "9847054321",
    place: "Kochi",
  };

  test("a complete new enrollment passes", () => {
    assert.deepEqual(validateStudentPersonal(valid), []);
  });

  test("new enrollments require phone, parent name, parent phone and place", () => {
    const problems = validateStudentPersonal({});
    assert.equal(problems.length, 4);
    assert.ok(problems.some((p) => /Student phone is required/.test(p)));
    assert.ok(problems.some((p) => /Place is required/.test(p)));
  });

  test("editing a legacy student only checks format, not presence", () => {
    assert.deepEqual(validateStudentPersonal({}, { requireAll: false }), []);
    const problems = validateStudentPersonal({ parent_phone: "123" }, { requireAll: false });
    assert.deepEqual(problems, ["Parent phone must be exactly 10 digits."]);
  });

  test("flags bad email, guardian relation and date of birth", () => {
    const problems = validateStudentPersonal({
      ...valid,
      student_email: "nope",
      guardian_relation: "Uncle",
      date_of_birth: "not-a-date",
    });
    assert.equal(problems.length, 3);
  });
});

describe("preparePersonalFields", () => {
  test("blanks become null so the DB checks and date type accept them", () => {
    const out = preparePersonalFields({ student_phone: "", student_email: "  ", date_of_birth: "" });
    assert.equal(out.student_phone, null);
    assert.equal(out.student_email, null);
    assert.equal(out.date_of_birth, null);
    assert.equal(out.lead_source, null);
  });

  test("phones are normalized and text is trimmed", () => {
    const out = preparePersonalFields({ parent_phone: "98470 54321", place: "  Kochi " });
    assert.equal(out.parent_phone, "9847054321");
    assert.equal(out.place, "Kochi");
  });
});

describe("normalizeCourseCode", () => {
  test("upper-cases and trims to match courses_code_format", () => {
    assert.equal(normalizeCourseCode(" dbhm "), "DBHM");
    assert.equal(normalizeCourseCode(""), "");
  });
});

describe("friendlyError for student personal-field constraints", () => {
  test("maps phone/email check violations and duplicate course codes", () => {
    const orig = console.error;
    console.error = () => {};
    try {
      assert.match(
        friendlyError({ message: 'new row for relation "students" violates check constraint "students_parent_phone_format"' }),
        /10 digits/
      );
      assert.match(
        friendlyError({ message: 'new row for relation "students" violates check constraint "students_student_email_format"' }),
        /email/
      );
      assert.match(
        friendlyError({ message: 'duplicate key value violates unique constraint "courses_code_key"' }),
        /course code/
      );
    } finally {
      console.error = orig;
    }
  });
});
