// Shared validation + friendly-error helpers used across every form and
// bulk-import screen in the app.

// Maps the raw error text Postgres/Supabase sends back into plain
// language a non-technical staff member can understand. Every call site
// already catches and displays the string this returns, but until now
// nothing left a trace of the original error anywhere — logging it here
// (the one place nearly every catch block in the app funnels through)
// gives the browser console a record to check without touching every
// call site individually.
export function friendlyError(err) {
  // eslint-disable-next-line no-console
  console.error("[friendlyError]", err);
  const msg = (err && err.message) || String(err || "");

  if (/invalid input syntax for type date/i.test(msg)) {
    return "One of the dates isn't valid. Please check the Date field/column and try again.";
  }
  if (/invalid input syntax for type numeric/i.test(msg)) {
    return "One of the amounts isn't a valid number. Please check the Amount field/column.";
  }
  if (/duplicate key value/i.test(msg) && /students/i.test(msg)) {
    return "That Student ID already exists.";
  }
  if (/duplicate key value/i.test(msg) && /courses_code/i.test(msg)) {
    return "That course code is already used by another course.";
  }
  if (/duplicate key value/i.test(msg)) {
    return "That record already exists.";
  }
  if (/violates row-level security policy/i.test(msg)) {
    return "You don't have permission to do that. Ask an admin if this seems wrong.";
  }
  if (/violates check constraint/i.test(msg) && /amount/i.test(msg)) {
    return "Amount must be greater than zero.";
  }
  if (/violates check constraint/i.test(msg) && /account/i.test(msg)) {
    return "Account must be one of: HDFC, ICICI, Cash, Healthcare.";
  }
  if (/violates check constraint/i.test(msg) && /phone_format/i.test(msg)) {
    return "Phone numbers must be exactly 10 digits.";
  }
  if (/violates check constraint/i.test(msg) && /email_format/i.test(msg)) {
    return "That email address doesn't look valid.";
  }
  if (/violates check constraint/i.test(msg) && /guardian_relation/i.test(msg)) {
    return "Guardian relation must be Father, Mother or Other.";
  }
  if (/violates check constraint/i.test(msg) && /status/i.test(msg)) {
    return "Status must be one of: Registered, Active, Completed, Dropped.";
  }
  if (/violates foreign key constraint/i.test(msg) && /student/i.test(msg)) {
    return "That Student ID doesn't exist in Enrollment.";
  }
  if (/failed to fetch|networkerror|network error/i.test(msg)) {
    return "Couldn't reach the server. Check your internet connection and try again.";
  }
  if (!msg || msg === "[object Object]") {
    return "Something went wrong. Please try again.";
  }
  return msg;
}

export function isBlank(v) {
  return v === undefined || v === null || String(v).trim() === "";
}

export function isValidDateStr(v) {
  if (isBlank(v)) return false;
  const d = new Date(v);
  return !Number.isNaN(d.getTime());
}

export function isPositiveNumber(v) {
  if (isBlank(v)) return false;
  const n = Number(v);
  return !Number.isNaN(n) && n > 0;
}

// "Healthcare" is an inter-company clearing account, valid on money rows
// (fee collections / expenses / income) alongside the real bank & cash accounts.
export const VALID_ACCOUNTS = ["HDFC", "ICICI", "Cash", "Healthcare"];
export function isValidAccount(v) {
  return VALID_ACCOUNTS.includes(v);
}

export const VALID_STATUSES = ["Registered", "Active", "Completed", "Dropped"];
export function isValidStatus(v) {
  return VALID_STATUSES.includes(v);
}

// Validates a single money-transaction-style row (expense/income/fee
// collection) before it is sent to the database. Returns an array of
// human-readable problems; an empty array means the row is valid.
export function validateMoneyRow({ date, amount, account }) {
  const problems = [];
  if (!isValidDateStr(date)) problems.push("Missing or invalid date");
  if (!isPositiveNumber(amount)) problems.push("Amount must be a positive number");
  if (account && !isValidAccount(account)) {
    problems.push(`Unknown account "${account}" (use HDFC, ICICI, Cash or Healthcare)`);
  }
  return problems;
}

// -------- Student personal / contact fields (migration 24) --------
// These mirror the CHECK constraints on public.students so the form catches
// problems before the database does; the constraints remain the backstop.

// Strips the spaces and dashes people type into phone numbers ("98470 12345").
export function normalizePhone(v) {
  return isBlank(v) ? "" : String(v).replace(/[\s-]/g, "");
}

// Exactly 10 digits — matches students_*_phone_format.
export function isValidPhone(v) {
  return /^[0-9]{10}$/.test(normalizePhone(v));
}

// Basic shape only (something@something.tld) — matches students_student_email_format.
export function isValidEmail(v) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v ?? "").trim());
}

export const GUARDIAN_RELATIONS = ["Father", "Mother", "Other"];

export const STUDENT_PERSONAL_FIELDS = [
  "student_phone",
  "student_email",
  "parent_name",
  "parent_phone",
  "guardian_relation",
  "place",
  "address",
  "date_of_birth",
  "lead_source",
];

export const STUDENT_REQUIRED_PERSONAL_FIELDS = ["student_phone", "parent_name", "parent_phone", "place"];

const PERSONAL_LABEL = {
  student_phone: "Student phone",
  parent_name: "Parent name",
  parent_phone: "Parent phone",
  place: "Place",
};

// Validates the personal fields of the enrollment form. `requireAll` is true
// for new enrollments; existing students (enrolled before these fields
// existed) are only format-checked so a quick status/fee edit isn't blocked.
// Returns human-readable problems; empty array = valid.
export function validateStudentPersonal(form, { requireAll = true } = {}) {
  const problems = [];
  if (requireAll) {
    for (const f of STUDENT_REQUIRED_PERSONAL_FIELDS) {
      if (isBlank(form[f])) problems.push(`${PERSONAL_LABEL[f]} is required.`);
    }
  }
  if (!isBlank(form.student_phone) && !isValidPhone(form.student_phone)) {
    problems.push("Student phone must be exactly 10 digits.");
  }
  if (!isBlank(form.parent_phone) && !isValidPhone(form.parent_phone)) {
    problems.push("Parent phone must be exactly 10 digits.");
  }
  if (!isBlank(form.student_email) && !isValidEmail(form.student_email)) {
    problems.push("Student email doesn't look valid.");
  }
  if (!isBlank(form.guardian_relation) && !GUARDIAN_RELATIONS.includes(form.guardian_relation)) {
    problems.push("Guardian relation must be Father, Mother or Other.");
  }
  if (!isBlank(form.date_of_birth) && !isValidDateStr(form.date_of_birth)) {
    problems.push("Date of birth isn't a valid date.");
  }
  return problems;
}

// Shapes the personal fields for the database: trims text, strips phone
// separators, and turns blanks into null (an empty string would fail the
// phone/email CHECK constraints and isn't a valid date).
export function preparePersonalFields(form) {
  const out = {};
  for (const f of STUDENT_PERSONAL_FIELDS) {
    const raw = form[f];
    if (isBlank(raw)) out[f] = null;
    else if (f === "student_phone" || f === "parent_phone") out[f] = normalizePhone(raw);
    else out[f] = String(raw).trim();
  }
  return out;
}

// Course codes are short upper-case tokens (DBHM, ODHM) — matches courses_code_format.
export function normalizeCourseCode(v) {
  return isBlank(v) ? "" : String(v).trim().toUpperCase();
}
