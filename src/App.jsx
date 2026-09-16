import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

import { useAuth } from "./context/useAuth.js";
import Login from "./components/Login.jsx";
import ForcePasswordChange from "./components/ForcePasswordChange.jsx";
import ImportPreviewModal from "./components/ImportPreviewModal.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import NotificationBell from "./components/NotificationBell.jsx";
import { today } from "./lib/format.js";
import PeriodFilter from "./components/PeriodFilter.jsx";
import { resolvePeriod, inRange, periodLabel } from "./lib/period.js";
import {
  waiverForDrop,
  sumByAccount,
  accountBalance,
  studentFeeTotals,
} from "./lib/fees.js";
import { parseBankStatement } from "./lib/bankStatement.js";
import { autoMatch } from "./lib/reconcile.js";
import { getAccess } from "./lib/access.js";
import {
  fetchStudents,
  insertNewStudent,
  upsertStudent,
  bulkUpsertStudents,
  fetchCollections,
  insertCollection,
  bulkInsertCollections,
  updateCollection,
  fetchExpenses,
  insertExpense,
  bulkInsertExpenses,
  updateExpense,
  deleteExpense,
  deleteCollection,
  fetchTransfers,
  insertTransfer,
  bulkInsertTransfers,
  updateTransfer,
  deleteTransfer,
  fetchBankStatements,
  fetchBankStatementLines,
  createBankStatement,
  updateBankStatementLine,
  deleteBankStatement,
  fetchBatches,
  insertBatch,
  updateBatch,
  deleteBatch,
  fetchExpenseCategories,
  insertExpenseCategory,
  renameExpenseCategory,
  deleteExpenseCategory,
  mergeExpenseCategory,
  createStaffUser,
  fetchAppSettings,
  updateAppSettings,
} from "./lib/data.js";
import {
  friendlyError,
  isBlank,
  isValidDateStr,
  isPositiveNumber,
  isValidStatus,
  validateMoneyRow,
} from "./lib/validation.js";

import Dashboard from "./pages/Dashboard.jsx";
import EnrollmentPage from "./pages/EnrollmentPage.jsx";
import FeeCollectionPage from "./pages/FeeCollectionPage.jsx";
import ExpensesPage from "./pages/ExpensesPage.jsx";
import BankingPage from "./pages/BankingPage.jsx";
import ReportsPage from "./pages/ReportsPage.jsx";
import AdminPage from "./pages/AdminPage.jsx";
// Academy Suite pages are code-split — they're never the landing tab and
// pull their own data layer.
const TimetablePage = React.lazy(() => import("./pages/TimetablePage.jsx"));
const LiveClassPage = React.lazy(() => import("./pages/LiveClassPage.jsx"));
const AssignmentsPage = React.lazy(() => import("./pages/AssignmentsPage.jsx"));
const ExamsPage = React.lazy(() => import("./pages/ExamsPage.jsx"));
const ReviewsPage = React.lazy(() => import("./pages/ReviewsPage.jsx"));
import Receipt from "./components/Receipt.jsx";

const HOME = "Pulse"; // dashboard tab name

const TAB_TITLES = {
  Pulse: "Academy Pulse",
  Timetable: "Class Timetable & Schedule",
  "Live Class": "Online Classroom",
  Assignments: "Projects & Assignments",
  Exams: "Examinations & Quizzes",
  Reviews: "Faculty & Course Reviews",
  Enrollment: "Student Enrollment",
  "Fee Collection": "Fee Collection",
  Expenses: "Expenses",
  Banking: "Banking",
  Reports: "Reports & Controls",
  Admin: "Admin",
};

// Contextual subtitle per tab displayed in the topbar
const TAB_SUBTITLES = {
  [HOME]: "Academic and financial performance overview",
  Timetable: "Schedule and manage daily class sessions across batches",
  "Live Class": "Join active sessions and track live attendance",
  Assignments: "Create, publish, and grade coursework",
  Exams: "Schedule tests and review student submissions",
  Reviews: "Student feedback and faculty rating trends",
  Enrollment: "Student registration, batch assignment, and fee plans",
  "Fee Collection": "Record student payments, track receipts and dues",
  Expenses: "Track operational expenses and vendor disbursements",
  Banking: "Account balances, bank reconciliation, and cash transfers",
  Reports: "Financial statements, audit logs, and analytical reports",
  Admin: "System settings, batches, user roles, and access control",
};

const NAV_BASE = [
  { key: HOME, icon: "◎" },
  { key: "Timetable", icon: "📅" },
  { key: "Live Class", icon: "🎥" },
  { key: "Assignments", icon: "📋" },
  { key: "Exams", icon: "📝" },
  { key: "Reviews", icon: "⭐" },
  { key: "Enrollment", icon: "♙" },
  { key: "Fee Collection", icon: "₹" },
  { key: "Expenses", icon: "−" },
  { key: "Banking", icon: "⇄", financial: true },
  { key: "Reports", icon: "▤" },
];

const ACCOUNTS = ["HDFC", "ICICI", "Cash", "Healthcare"];

// Tabs where date-range filtering applies (financial and reporting views).
// Academic suite and Admin manage their own temporal scoping or lists.
const PERIOD_FILTER_TABS = new Set([
  HOME,
  "Enrollment",
  "Fee Collection",
  "Expenses",
  "Banking",
  "Reports",
]);

export default function App() {
  const { loading, session, profile, profileError, signOut } = useAuth();

  if (loading) {
    return <FullScreenMessage title="Loading..." text="Checking your session." />;
  }

  if (!session) {
    return <Login />;
  }

  if (profileError) {
    return (
      <FullScreenMessage
        title="Couldn't load your profile"
        text={profileError}
        action={{ label: "Sign out", onClick: signOut }}
      />
    );
  }

  if (!profile || !profile.is_approved) {
    return (
      <FullScreenMessage
        title="Waiting for approval"
        text="Your account has been created. An Oksy Academy admin needs to approve your access before you can use Oksy Academy Pulse."
        action={{ label: "Sign out", onClick: signOut }}
      />
    );
  }

  // Logins provisioned via "Create Login" start with an admin-set temp
  // password — require a real one before letting them into the app.
  if (profile.must_change_password) {
    return <ForcePasswordChange />;
  }

  return <AppShell />;
}

function FullScreenMessage({ title, text, action }) {
  return (
    <div className="auth-shell">
      <div className="auth-card status-card">
        <img src="/oksy-logo.jpeg" alt="Oksy Academy" className="status-logo" />
        <h2>{title}</h2>
        <p>{text}</p>
        {action && (
          <button className="button primary" onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}

// Excel stores dates as either a JS Date (when we read the workbook with
// cellDates: true), a raw day-count "serial number" (e.g. 45806) when the
// cell wasn't recognized as a date, or plain text the user typed in. This
// normalizes any of those into a clean "YYYY-MM-DD" string for the database.
let xlsxModule = null;
async function getXlsx() {
  if (!xlsxModule) {
    xlsxModule = await import("xlsx");
  }
  return xlsxModule;
}

function parseExcelDate(value) {
  if (value === undefined || value === null || value === "") return null;
  if (value instanceof Date && !isNaN(value)) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof value === "number") {
    if (xlsxModule?.SSF) {
      const parsed = xlsxModule.SSF.parse_date_code(value);
      if (parsed) {
        const y = parsed.y;
        const m = String(parsed.m).padStart(2, "0");
        const d = String(parsed.d).padStart(2, "0");
        return `${y}-${m}-${d}`;
      }
    }
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    if (!isNaN(date.getTime())) {
      const y = date.getUTCFullYear();
      const m = String(date.getUTCMonth() + 1).padStart(2, "0");
      const d = String(date.getUTCDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
  }
  return String(value).trim();
}

function readWorkbookRows(file, onRows) {
  getXlsx().then((XLSX) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const workbook = XLSX.read(e.target.result, { type: "array", cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      onRows(XLSX.utils.sheet_to_json(sheet));
    };
    reader.readAsArrayBuffer(file);
  });
}

function AppShell() {
  const { profile, canViewFinancials, signOut } = useAuth();

  const [appSettings, setAppSettings] = useState({});
  const access = useMemo(() => getAccess(profile, appSettings), [profile, appSettings]);
  const isAdmin = access.isAdmin;

  const [activeTab, setActiveTab] = useState(HOME);
  const [navOpen, setNavOpen] = useState(() => {
    try {
      return localStorage.getItem("oksy.nav") !== "closed";
    } catch {
      return true;
    }
  });
  const toggleNav = () =>
    setNavOpen((v) => {
      try {
        localStorage.setItem("oksy.nav", v ? "closed" : "open");
      } catch {
        /* ignore */
      }
      return !v;
    });

  const [students, setStudents] = useState([]);
  const [collections, setCollections] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [bankStatements, setBankStatements] = useState([]);
  const [bankLines, setBankLines] = useState([]);
  // Bank statements + lines are only used on the Banking tab, so they are
  // loaded the first time that tab is opened rather than on every app load.
  const bankLoadedRef = useRef(false);
  const [batches, setBatches] = useState([]);
  const [expenseCategories, setExpenseCategories] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState("");
  const [bankBusy, setBankBusy] = useState(false);
  const [adminBusy, setAdminBusy] = useState(false);

  // Fee receipt to show/print after a collection is recorded.
  const [receipt, setReceipt] = useState(null);

  // Global top-bar period filter: { preset, start, end }. Drives the money
  // views (Dashboard financials + chart, Fee Collection & Expenses lists).
  const [period, setPeriod] = useState({ preset: "all", start: "", end: "" });

  const [showStudentForm, setShowStudentForm] = useState(false);
  const [editingStudent, setEditingStudent] = useState(null);

  const [savingStudent, setSavingStudent] = useState(false);
  const [savingCollection, setSavingCollection] = useState(false);
  const [savingExpense, setSavingExpense] = useState(false);
  const [savingTransfer, setSavingTransfer] = useState(false);

  const [studentFormError, setStudentFormError] = useState("");
  const [collectionFormError, setCollectionFormError] = useState("");
  const [expenseFormError, setExpenseFormError] = useState("");
  const [transferFormError, setTransferFormError] = useState("");

  // When a bulk-import file is chosen, its parsed rows land here for
  // review (valid vs. invalid, with reasons) before anything is saved.
  const [importPreview, setImportPreview] = useState(null);

  const emptyStudentForm = {
    id: "",
    batch: "",
    name: "",
    course: "",
    registration_fee: "",
    course_fee: "",
    exam_fee: "",
    other_fee: "",
    waiver: "",
    status: "Registered",
    enrollment_date: today(),
  };
  const [studentForm, setStudentForm] = useState(emptyStudentForm);

  const emptyCollectionForm = {
    studentId: "",
    date: today(),
    type: "Course Fee",
    account: "HDFC",
    amount: "",
    reference: "",
  };
  const [collectionForm, setCollectionForm] = useState(emptyCollectionForm);

  const emptyExpenseForm = {
    date: today(),
    category: "Rent",
    account: "HDFC",
    amount: "",
    reference: "",
    description: "",
  };
  const [expenseForm, setExpenseForm] = useState(emptyExpenseForm);

  const emptyTransferForm = {
    date: today(),
    from_account: "Cash",
    to_account: "ICICI",
    amount: "",
    purpose: "",
    reference: "",
    note: "",
  };
  const [transferForm, setTransferForm] = useState(emptyTransferForm);

  const loadData = async () => {
    setDataLoading(true);
    try {
      const needCollections = access.financials || access.canOpen("Fee Collection");
      const needExpenses = access.financials || access.canOpen("Expenses");

      const [studentRows, collectionRows, batchRows, expenseRows, categoryRows, settings] =
        await Promise.all([
          fetchStudents(),
          needCollections ? fetchCollections().catch(() => []) : Promise.resolve([]),
          fetchBatches().catch(() => []),
          needExpenses ? fetchExpenses().catch(() => []) : Promise.resolve([]),
          needExpenses ? fetchExpenseCategories().catch(() => []) : Promise.resolve([]),
          fetchAppSettings().catch(() => ({})),
        ]);
      setStudents(studentRows);
      setCollections(collectionRows);
      setBatches(batchRows);
      setExpenses(expenseRows);
      setExpenseCategories(categoryRows);
      setAppSettings(settings || {});

      if (access.financials) {
        setTransfers(await fetchTransfers());
      } else {
        setTransfers([]);
      }
      setDataError("");
    } catch (err) {
      setDataError(friendlyError(err));
    } finally {
      setDataLoading(false);
    }
  };

  // Fetch bank statements + their lines. Called the first time the Banking
  // tab is opened, and after every reconciliation mutation. Kept separate
  // from loadData() so Dashboard / Fee Collection loads don't pay for it.
  const loadBankData = async () => {
    if (!access.financials) {
      setBankStatements([]);
      setBankLines([]);
      bankLoadedRef.current = true;
      return;
    }
    try {
      const [statementRows, lineRows] = await Promise.all([
        fetchBankStatements(),
        fetchBankStatementLines(),
      ]);
      setBankStatements(statementRows);
      setBankLines(lineRows);
      bankLoadedRef.current = true;
    } catch (err) {
      setDataError(friendlyError(err));
    }
  };

  useEffect(() => {
    loadData();
    // A role / financial-access change invalidates any bank data already
    // loaded. Re-arm the lazy load, and if the user is sitting on the
    // Banking tab right now, refetch immediately.
    bankLoadedRef.current = false;
    setBankStatements([]);
    setBankLines([]);
    if (activeTab === "Banking") loadBankData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewFinancials, access.role]);

  useEffect(() => {
    if (activeTab === "Banking" && !bankLoadedRef.current) {
      loadBankData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Resolved { start, end } for the active period, or null for all-time.
  const range = useMemo(() => resolvePeriod(period), [period]);

  // Money FLOWS (revenue, expense, the monthly chart, recent transactions)
  // respond to the selected period. BALANCES (bank/cash, receivables, batch
  // fee position, collection health) are always the true running total —
  // "This Month" doesn't change what's in a bank account.
  const visibleCollections = useMemo(
    () => (range ? collections.filter((c) => inRange(c.date, range)) : collections),
    [collections, range]
  );
  const visibleExpenses = useMemo(
    () => (range ? expenses.filter((e) => inRange(e.date, range)) : expenses),
    [expenses, range]
  );

  const totals = useMemo(() => {
    // --- Student counts: the current roster (all-time). ---
    const totalStudents = students.length;
    const registered = students.filter((s) => s.status === "Registered").length;
    const active = students.filter((s) => s.status === "Active").length;
    const completed = students.filter((s) => s.status === "Completed").length;
    const dropped = students.filter((s) => s.status === "Dropped").length;

    // --- Flows: respond to the selected period. Transfers are never a flow. ---
    const totalRevenue = sumByAccount(visibleCollections, "*");
    const totalExpense = sumByAccount(visibleExpenses, "*");

    // --- Balances & receivables: the true running position (all-time). A bank
    //     balance or an unpaid fee isn't a "this month" number. ---
    const bal = (acct) => accountBalance(acct, { collections, expenses, transfers });
    const hdfcBalance = bal("HDFC");
    const iciciBalance = bal("ICICI");
    const cashBalance = bal("Cash");
    const totalBalance = cashBalance + hdfcBalance + iciciBalance;

    const fees = studentFeeTotals(students, collections);
    const studentReceivable = fees.outstanding;

    // "Healthcare" is an inter-company clearing account. Its running balance is
    // what the two owe each other: < 0 → Academy owes Healthcare (a liability).
    // balance = fees held by HC − Academy expenses HC paid + repayments to HC.
    const healthcareBalance = bal("Healthcare");
    const healthcareReceivable = Math.max(0, healthcareBalance);
    const healthcareLiability = Math.max(0, -healthcareBalance);
    const netInterCompany = -healthcareBalance;

    // Net P&L: Revenue − Expense − Due to Healthcare (healthcareLiability).
    // Deliberate design choice, confirmed directly with the owner: subtract
    // the actual "Due to Healthcare" figure shown on its own tile below,
    // exactly as it reads there — not a period-scoped version of it. A
    // Healthcare-paid expense already sits inside totalExpense too, so this
    // is a known, intentional double-count: until the Academy actually
    // repays Healthcare, that money is treated as not yet "earned" profit,
    // full stop, regardless of which period you're viewing. (An earlier
    // pass here tried period-scoping this subtraction instead — that
    // produced a different number than the visible "Due to Healthcare"
    // tile, which was confusing and not what was wanted. Reverted.)
    const netProfit = totalRevenue - totalExpense - healthcareLiability;

    return {
      totalStudents,
      registered,
      active,
      completed,
      dropped,
      totalRevenue,
      totalExpense,
      netProfit,
      cashBalance,
      hdfcBalance,
      iciciBalance,
      totalBalance,
      studentReceivable,
      expectedFees: fees.expected,
      collectedFees: fees.collected,
      healthcareBalance,
      healthcareReceivable,
      healthcareLiability,
      netInterCompany,
    };
  }, [students, collections, expenses, transfers, visibleCollections, visibleExpenses]);

  const openNewStudent = () => {
    setEditingStudent(null);
    setStudentForm(emptyStudentForm);
    setStudentFormError("");
    setShowStudentForm(true);
  };

  const editStudent = (student) => {
    setEditingStudent(student);
    setStudentForm({
      ...student,
      registration_fee: student.registration_fee || "",
      course_fee: student.course_fee || "",
      exam_fee: student.exam_fee || "",
      other_fee: student.other_fee || "",
      waiver: student.waiver || "",
    });
    setStudentFormError("");
    setShowStudentForm(true);
  };

  const saveStudent = async (e) => {
    e.preventDefault();
    setStudentFormError("");

    if (isBlank(studentForm.id) || isBlank(studentForm.name)) {
      setStudentFormError("Student ID and Name are required.");
      return;
    }
    const duplicate =
      !editingStudent &&
      students.some((s) => s.id.toLowerCase() === studentForm.id.toLowerCase());
    if (duplicate) {
      setStudentFormError("Student ID already exists.");
      return;
    }
    if (!isValidStatus(studentForm.status)) {
      setStudentFormError("Please choose a valid status.");
      return;
    }
    if (!isValidDateStr(studentForm.enrollment_date)) {
      setStudentFormError("Please enter a valid enrollment date.");
      return;
    }

    const prepared = {
      ...studentForm,
      registration_fee: Number(studentForm.registration_fee || 0),
      course_fee: Number(studentForm.course_fee || 0),
      exam_fee: Number(studentForm.exam_fee || 0),
      other_fee: Number(studentForm.other_fee || 0),
      waiver: Number(studentForm.waiver || 0),
    };

    // A dropped student's uncollected balance is written off: raise the waiver
    // so their outstanding balance becomes zero.
    if (prepared.status === "Dropped") {
      const collectedSoFar = collections
        .filter((c) => c.student_id === prepared.id)
        .reduce((sum, c) => sum + Number(c.amount || 0), 0);
      prepared.waiver = waiverForDrop(prepared, collectedSoFar);
    }

    setSavingStudent(true);
    try {
      if (editingStudent) {
        await upsertStudent(prepared, profile.id);
      } else {
        await insertNewStudent(prepared, profile.id);
      }
      setShowStudentForm(false);
      await loadData();
    } catch (err) {
      setStudentFormError(friendlyError(err));
    } finally {
      setSavingStudent(false);
    }
  };

  const addCollection = async (e) => {
    e.preventDefault();
    setCollectionFormError("");

    const student = students.find(
      (s) =>
        s.id === collectionForm.studentId ||
        s.name.toLowerCase() === collectionForm.studentId.toLowerCase()
    );
    if (!student) {
      setCollectionFormError("Student not found. Check the Student ID / Name.");
      return;
    }
    if (!isValidDateStr(collectionForm.date)) {
      setCollectionFormError("Please enter a valid date.");
      return;
    }
    if (!isPositiveNumber(collectionForm.amount)) {
      setCollectionFormError("Amount must be greater than zero.");
      return;
    }

    setSavingCollection(true);
    try {
      const amount = Number(collectionForm.amount);
      const created = await insertCollection(
        {
          student_id: student.id,
          student_name: student.name,
          date: collectionForm.date,
          type: collectionForm.type,
          account: collectionForm.account,
          amount,
          reference: collectionForm.reference,
        },
        profile.id
      );

      // Build the printable receipt (this payment + updated running totals).
      const gross =
        Number(student.registration_fee || 0) +
        Number(student.course_fee || 0) +
        Number(student.exam_fee || 0) +
        Number(student.other_fee || 0);
      const priorPaid = collections
        .filter((c) => c.student_id === student.id)
        .reduce((s, c) => s + Number(c.amount || 0), 0);
      const totalPaid = priorPaid + amount;
      const netFee = Math.max(0, gross - Number(student.waiver || 0));
      setReceipt({
        receiptNo: created?.id ? `OKSY/${String(created.id).padStart(6, "0")}` : "OKSY/—",
        date: collectionForm.date,
        student,
        type: collectionForm.type,
        account: collectionForm.account,
        reference: collectionForm.reference,
        amount,
        totalFee: netFee,
        waiver: Number(student.waiver || 0),
        totalPaid,
        balance: Math.max(0, netFee - totalPaid),
        cashierName: profile.full_name || profile.email,
      });

      setCollectionForm(emptyCollectionForm);
      await loadData();
    } catch (err) {
      setCollectionFormError(friendlyError(err));
    } finally {
      setSavingCollection(false);
    }
  };

  const addExpense = async (e) => {
    e.preventDefault();
    setExpenseFormError("");

    const problems = validateMoneyRow({
      date: expenseForm.date,
      amount: expenseForm.amount,
      account: expenseForm.account,
    });
    if (problems.length) {
      setExpenseFormError(problems.join(" "));
      return;
    }

    setSavingExpense(true);
    try {
      await insertExpense(
        { ...expenseForm, amount: Number(expenseForm.amount) },
        profile.id
      );
      setExpenseForm(emptyExpenseForm);
      await loadData();
    } catch (err) {
      setExpenseFormError(friendlyError(err));
    } finally {
      setSavingExpense(false);
    }
  };

  const editExpense = async (id, patch) => {
    await updateExpense(id, { ...patch, amount: Number(patch.amount) }, profile.id);
    await loadData();
  };

  const removeExpense = async (id) => {
    await deleteExpense(id);
    await loadData();
  };

  const editCollection = async (id, patch) => {
    await updateCollection(id, { ...patch, amount: Number(patch.amount) });
    await loadData();
  };

  const removeCollection = async (id) => {
    await deleteCollection(id);
    await loadData();
  };

  const editTransfer = async (id, patch) => {
    await updateTransfer(id, { ...patch, amount: Number(patch.amount) });
    await loadData();
  };

  const removeTransfer = async (id) => {
    await deleteTransfer(id);
    await loadData();
  };

  /* ---------------- Admin: batches, categories, users ---------------- */

  const adminAction = async (fn) => {
    setAdminBusy(true);
    try {
      await fn();
      await loadData();
    } finally {
      setAdminBusy(false);
    }
  };

  const admin = {
    addBatch: (batch) => adminAction(() => insertBatch(batch, profile.id)),
    editBatch: (id, patch) => adminAction(() => updateBatch(id, patch)),
    removeBatch: (id) => adminAction(() => deleteBatch(id)),
    addCategory: (name) => adminAction(() => insertExpenseCategory(name, profile.id)),
    renameCategory: (id, name) => adminAction(() => renameExpenseCategory(id, name)),
    removeCategory: (id) => adminAction(() => deleteExpenseCategory(id)),
    mergeCategory: (fromId, fromName, toName) =>
      adminAction(() => mergeExpenseCategory(fromId, fromName, toName)),
    createUser: (payload) => adminAction(() => createStaffUser(payload)),
    saveAccess: (nextRoleAreas) =>
      adminAction(async () => {
        const next = { ...appSettings, roleAreas: nextRoleAreas };
        await updateAppSettings(next, profile.id);
        setAppSettings(next);
      }),
  };

  const addTransfer = async (e) => {
    e.preventDefault();
    setTransferFormError("");

    if (!isValidDateStr(transferForm.date)) {
      setTransferFormError("Please enter a valid date.");
      return;
    }
    if (transferForm.from_account === transferForm.to_account) {
      setTransferFormError("From and To accounts must be different.");
      return;
    }
    if (!isPositiveNumber(transferForm.amount)) {
      setTransferFormError("Amount must be greater than zero.");
      return;
    }

    setSavingTransfer(true);
    try {
      await insertTransfer(
        { ...transferForm, amount: Number(transferForm.amount) },
        profile.id
      );
      setTransferForm(emptyTransferForm);
      await loadData();
    } catch (err) {
      setTransferFormError(friendlyError(err));
    } finally {
      setSavingTransfer(false);
    }
  };

  /* ---------------- Bank reconciliation ---------------- */

  // Full bank statement text to copy onto a matched fee collection's
  // bank_reference field -- description plus any separate reference/UTR
  // column, so staff can audit the collection against the statement
  // without reopening the reconciliation screen.
  const bankReferenceText = (line) =>
    [line.description, line.reference].filter(Boolean).join(" ").trim().slice(0, 500);

  // Parse an uploaded statement, auto-match its lines against existing
  // collections / expenses / transfers, and store it.
  const uploadBankStatement = async (account, file) => {
    setBankBusy(true);
    setDataError("");
    try {
      const buffer = await file.arrayBuffer();
      const parsed = await parseBankStatement(buffer);
      const matches = autoMatch(parsed.lines, account, { collections, expenses, transfers });

      const lineRows = parsed.lines.map((ln, i) => ({
        seq: ln.seq,
        txn_date: ln.date,
        description: ln.description,
        reference: ln.reference,
        withdrawal: ln.withdrawal,
        deposit: ln.deposit,
        running_balance: ln.runningBalance,
        status: matches[i].status,
        match_kind: matches[i].match_kind || null,
        match_id: matches[i].match_id || null,
        match_score: matches[i].match_score ?? null,
        matched_at: matches[i].status === "matched" ? new Date().toISOString() : null,
        matched_by: matches[i].status === "matched" ? profile.id : null,
      }));

      await createBankStatement(
        {
          account,
          period_start: parsed.periodStart,
          period_end: parsed.periodEnd,
          opening_balance: parsed.openingBalance,
          closing_balance: parsed.closingBalance,
          file_name: file.name,
        },
        lineRows,
        profile.id
      );

      // Auto-matched collections/expenses/transfers get the full bank line
      // description/reference written onto them as a permanent audit trail
      // (see the "Fix Bank Reconciliation Matching Logic" brief) -- same as
      // a manual match/classification does below.
      const matchedLines = parsed.lines
        .map((ln, i) => ({ ln, m: matches[i] }))
        .filter(({ m }) => m.status === "matched");
      const bankRefUpdaters = {
        collection: (id, patch) => updateCollection(id, patch),
        expense: (id, patch) => updateExpense(id, patch, profile.id),
        transfer: (id, patch) => updateTransfer(id, patch),
      };
      const bankRefWrites = matchedLines.filter(({ m }) => bankRefUpdaters[m.match_kind]);
      if (bankRefWrites.length) {
        await Promise.all(
          bankRefWrites.map(({ ln, m }) =>
            bankRefUpdaters[m.match_kind](m.match_id, {
              bank_reference: bankReferenceText(ln),
            })
          )
        );
      }

      await Promise.all([loadData(), loadBankData()]);
    } catch (err) {
      setDataError(friendlyError(err));
    } finally {
      setBankBusy(false);
    }
  };

  // Turn one unmatched statement line into a real record and mark it matched.
  // `input.kind` is 'collection' | 'expense' | 'transfer'.
  const classifyBankLine = async (line, input) => {
    setBankBusy(true);
    setDataError("");
    try {
      const amount = Number(line.deposit) > 0 ? Number(line.deposit) : Number(line.withdrawal);
      let created;

      // Link to a record that already exists (no new record created).
      if (input.kind === "link") {
        if (input.linkKind === "collection") {
          await updateCollection(input.linkId, { bank_reference: bankReferenceText(line) });
        } else if (input.linkKind === "expense") {
          await updateExpense(input.linkId, { bank_reference: bankReferenceText(line) }, profile.id);
        } else if (input.linkKind === "transfer") {
          await updateTransfer(input.linkId, { bank_reference: bankReferenceText(line) });
        }
        await updateBankStatementLine(line.id, {
          status: "matched",
          match_kind: input.linkKind,
          match_id: input.linkId,
          matched_at: new Date().toISOString(),
          matched_by: profile.id,
        });
        await Promise.all([loadData(), loadBankData()]);
        return;
      }

      if (input.kind === "collection") {
        const student = students.find(
          (s) =>
            s.id === input.studentId ||
            s.name.toLowerCase() === String(input.studentId || "").toLowerCase()
        );
        if (!student) throw new Error("Student not found. Check the Student ID / Name.");
        created = await insertCollection(
          {
            student_id: student.id,
            student_name: student.name,
            date: line.txn_date,
            type: input.type || "Course Fee",
            account: line.account,
            amount,
            reference: line.reference || `Bank: ${line.description || ""}`.slice(0, 120),
            bank_reference: bankReferenceText(line),
          },
          profile.id
        );
      } else if (input.kind === "expense") {
        created = await insertExpense(
          {
            date: line.txn_date,
            category: input.category || "Bank Charge",
            account: line.account,
            amount,
            reference: line.reference || "",
            description: input.description || line.description || "",
            bank_reference: bankReferenceText(line),
          },
          profile.id
        );
      } else if (input.kind === "transfer") {
        const deposit = Number(line.deposit) > 0;
        const other = input.otherAccount;
        if (!other || other === line.account) throw new Error("Pick a different other account.");
        created = await insertTransfer(
          {
            date: line.txn_date,
            from_account: deposit ? other : line.account,
            to_account: deposit ? line.account : other,
            amount,
            purpose: input.purpose || line.description || "",
            reference: line.reference || "",
            note: "Created from bank reconciliation",
            bank_reference: bankReferenceText(line),
          },
          profile.id
        );
      } else {
        throw new Error("Unknown classification.");
      }

      await updateBankStatementLine(line.id, {
        status: "classified",
        match_kind: input.kind,
        match_id: created ? created.id : null,
        matched_at: new Date().toISOString(),
        matched_by: profile.id,
      });
      await Promise.all([loadData(), loadBankData()]);
    } catch (err) {
      setDataError(friendlyError(err));
      throw err;
    } finally {
      setBankBusy(false);
    }
  };

  const setBankLineIgnored = async (line, ignored) => {
    setBankBusy(true);
    try {
      await updateBankStatementLine(line.id, {
        status: ignored ? "ignored" : "unmatched",
        match_kind: null,
        match_id: null,
      });
      await Promise.all([loadData(), loadBankData()]);
    } catch (err) {
      setDataError(friendlyError(err));
    } finally {
      setBankBusy(false);
    }
  };

  // Detach a matched/classified line so it can be re-done. If the line had
  // CREATED a record (status 'classified'), that record is deleted too, so
  // expenses / transfers aren't left double-counted.
  const unmatchBankLine = async (line, { deleteRecord = false } = {}) => {
    setBankBusy(true);
    try {
      if (deleteRecord && line.status === "classified" && line.match_id) {
        if (line.match_kind === "expense") await deleteExpense(line.match_id);
        else if (line.match_kind === "transfer") await deleteTransfer(line.match_id);
        else if (line.match_kind === "collection") await deleteCollection(line.match_id);
      }
      await updateBankStatementLine(line.id, {
        status: "unmatched",
        match_kind: null,
        match_id: null,
        matched_at: null,
        matched_by: null,
      });
      await Promise.all([loadData(), loadBankData()]);
    } catch (err) {
      setDataError(friendlyError(err));
    } finally {
      setBankBusy(false);
    }
  };

  const removeBankStatement = async (id) => {
    setBankBusy(true);
    try {
      await deleteBankStatement(id);
      await Promise.all([loadData(), loadBankData()]);
    } catch (err) {
      setDataError(friendlyError(err));
    } finally {
      setBankBusy(false);
    }
  };

  /* ---------------- Bulk import: parse -> preview -> confirm ---------------- */

  const openImportPreview = (type, title, columns, parsedRows) => {
    const validRows = parsedRows.filter((r) => r.problems.length === 0);
    const invalidRows = parsedRows.filter((r) => r.problems.length > 0);
    setImportPreview({ type, title, columns, validRows, invalidRows, committing: false });
  };

  const handleStudentFile = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    readWorkbookRows(file, (rows) => {
      const seenIds = new Set();
      const parsed = rows.map((row, idx) => {
        const rowNumber = idx + 2;
        const id = row["Student ID"] || row["studentId"] || row["ID"];
        const name = row["Name"] || row["name"];
        const problems = [];

        if (isBlank(id)) problems.push("Missing Student ID");
        if (isBlank(name)) problems.push("Missing Name");
        if (!isBlank(id)) {
          const key = String(id).toLowerCase();
          if (seenIds.has(key)) problems.push("Duplicate Student ID within this file");
          seenIds.add(key);
        }

        const enrollment_date = parseExcelDate(row["Enrollment Date"]) || today();
        const status = row["Status"] || "Registered";

        const preview = {
          "Student ID": id ?? "",
          Name: name ?? "",
          Batch: row["Batch"] || "",
          Course: row["Course"] || row["Courses"] || "",
          Status: status,
          "Enrollment Date": enrollment_date,
        };

        const record =
          problems.length === 0
            ? {
                id: String(id),
                batch: row["Batch"] || "",
                name: String(name),
                course: row["Course"] || row["Courses"] || "",
                registration_fee: Number(row["Registration Fee"] || 0),
                course_fee: Number(row["Course Fee"] || 0),
                exam_fee: Number(row["Exam Fee"] || 0),
                other_fee: Number(row["Other Fee"] || 0),
                waiver: Number(row["Waiver"] || 0),
                status,
                enrollment_date,
              }
            : null;

        return { rowNumber, preview, problems, record };
      });

      openImportPreview(
        "students",
        "Import Students — Review",
        ["Student ID", "Name", "Batch", "Course", "Status", "Enrollment Date"],
        parsed
      );
    });

    event.target.value = "";
  };

  const handleCollectionFile = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    readWorkbookRows(file, (rows) => {
      const parsed = rows.map((row, idx) => {
        const rowNumber = idx + 2;
        const studentIdRaw = row["Student ID"] || row["studentId"] || row["ID"];
        const date = parseExcelDate(row["Date"] || row["date"]);
        const amount = row["Amount"] ?? row["amount"];
        const type = row["Type"] || row["type"] || "Course Fee";
        // Old templates had a separate "Money Received By" column — treat a
        // Healthcare value there as the account, so those files still import.
        const legacyParty = String(row["Money Received By"] || row["Received Via"] || "").trim();
        const account =
          legacyParty.toLowerCase() === "healthcare"
            ? "Healthcare"
            : row["Payment A/C"] || row["Account"] || "HDFC";

        const problems = [];
        if (isBlank(studentIdRaw)) problems.push("Missing Student ID");
        const student =
          !isBlank(studentIdRaw) &&
          students.find((s) => s.id.toLowerCase() === String(studentIdRaw).toLowerCase());
        if (!isBlank(studentIdRaw) && !student) {
          problems.push("Student ID not found in Enrollment");
        }
        problems.push(...validateMoneyRow({ date, amount, account }));

        const preview = {
          "Student ID": studentIdRaw ?? "",
          Date: date ?? "",
          Type: type,
          Account: account,
          Amount: amount ?? "",
          Reference: row["Reference"] || row["reference"] || "",
        };

        const record =
          problems.length === 0
            ? {
                student_id: student.id,
                student_name: student.name,
                date,
                type,
                account,
                amount: Number(amount),
                reference: row["Reference"] || row["reference"] || "",
              }
            : null;

        return { rowNumber, preview, problems, record };
      });

      openImportPreview(
        "collections",
        "Import Fee Collections — Review",
        ["Student ID", "Date", "Type", "Account", "Amount", "Reference"],
        parsed
      );
    });

    event.target.value = "";
  };

  const handleExpenseFile = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    readWorkbookRows(file, (rows) => {
      const parsed = rows
        .filter((row) => row["Amount"] !== undefined || row["amount"] !== undefined)
        .map((row, idx) => {
          const rowNumber = idx + 2;
          const date = parseExcelDate(row["Date"] || row["date"]);
          const amount = row["Amount"] ?? row["amount"];
          const category = row["Category"] || row["category"] || "Other";
          // Old templates had a separate "Paid By" column — a Healthcare value
          // there now means the payment account is Healthcare.
          const legacyParty = String(row["Paid By"] || "").trim();
          const account =
            legacyParty.toLowerCase() === "healthcare"
              ? "Healthcare"
              : row["Payment A/C"] || row["Account"] || "HDFC";

          const problems = validateMoneyRow({ date, amount, account });

          const preview = {
            Date: date ?? "",
            Category: category,
            Account: account,
            Amount: amount ?? "",
          };

          const record =
            problems.length === 0
              ? {
                  date,
                  category,
                  account,
                  amount: Number(amount),
                  reference: row["Reference"] || row["reference"] || "",
                  description: row["Description"] || row["description"] || "",
                }
              : null;

          return { rowNumber, preview, problems, record };
        });

      openImportPreview(
        "expenses",
        "Import Expenses — Review",
        ["Date", "Category", "Account", "Amount"],
        parsed
      );
    });

    event.target.value = "";
  };

  const handleTransferFile = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    readWorkbookRows(file, (rows) => {
      const parsed = rows
        .filter((row) => row["Amount"] !== undefined || row["amount"] !== undefined)
        .map((row, idx) => {
          const rowNumber = idx + 2;
          const date = parseExcelDate(row["Date"] || row["date"]);
          const amount = row["Amount"] ?? row["amount"];
          const from_account = String(row["From Account"] || row["From"] || "").trim();
          const to_account = String(row["To Account"] || row["To"] || "").trim();
          const purpose = row["Purpose"] || row["purpose"] || "";

          const problems = [];
          if (!isValidDateStr(date)) problems.push("Missing or invalid date");
          if (!isPositiveNumber(amount)) problems.push("Amount must be a positive number");
          if (!ACCOUNTS.includes(from_account))
            problems.push(`From Account must be one of ${ACCOUNTS.join(", ")}`);
          if (!ACCOUNTS.includes(to_account))
            problems.push(`To Account must be one of ${ACCOUNTS.join(", ")}`);
          if (from_account && from_account === to_account)
            problems.push("From and To must differ");

          const preview = {
            Date: date ?? "",
            From: from_account,
            To: to_account,
            Amount: amount ?? "",
            Purpose: purpose,
          };

          const record =
            problems.length === 0
              ? {
                  date,
                  from_account,
                  to_account,
                  amount: Number(amount),
                  purpose,
                  reference: row["Reference"] || row["reference"] || "",
                  note: row["Note"] || row["note"] || "",
                }
              : null;

          return { rowNumber, preview, problems, record };
        });

      openImportPreview(
        "transfers",
        "Import Transfers — Review",
        ["Date", "From", "To", "Amount", "Purpose"],
        parsed
      );
    });

    event.target.value = "";
  };

  const cancelImport = () => setImportPreview(null);

  const confirmImport = async () => {
    if (!importPreview) return;
    setImportPreview((p) => ({ ...p, committing: true }));

    const records = importPreview.validRows.map((r) => r.record);
    try {
      if (importPreview.type === "students") {
        await bulkUpsertStudents(records, profile.id);
      } else if (importPreview.type === "collections") {
        await bulkInsertCollections(records, profile.id);
      } else if (importPreview.type === "expenses") {
        await bulkInsertExpenses(records, profile.id);
      } else if (importPreview.type === "transfers") {
        await bulkInsertTransfers(records, profile.id);
      }
      await loadData();
      setImportPreview(null);
      alert(`${records.length} row(s) imported successfully.`);
    } catch (err) {
      alert(friendlyError(err));
      setImportPreview((p) => ({ ...p, committing: false }));
    }
  };

  /* ---------------- Navigation & layout ---------------- */

  const nav = [...NAV_BASE, { key: "Admin", icon: "☺" }].filter(
    (item) => (!item.financial || access.financials) && access.canOpen(item.key)
  );

  useEffect(() => {
    if (nav.length && !nav.some((n) => n.key === activeTab)) {
      setActiveTab(nav[0]?.key || HOME);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access.areas.join("|")]);

  return (
    <div className={navOpen ? "app-shell" : "app-shell nav-collapsed"}>
      <aside className="sidebar">
        <div className="brand">
          <img src="/oksy-logo.jpeg" alt="Oksy Academy" className="brand-logo" />
          <div>
            <div className="brand-title">OKSY ACADEMY</div>
            <div className="brand-subtitle">Learn · Grow · Build Tomorrow</div>
          </div>
        </div>

        <nav className="navigation">
          {nav.map((item) => (
            <button
              key={item.key}
              className={activeTab === item.key ? "nav-item active" : "nav-item"}
              onClick={() => setActiveTab(item.key)}
              title={item.key}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.key}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-mini">
            <div className="avatar">
              {(profile.full_name || profile.email || "?").charAt(0).toUpperCase()}
            </div>
            <div>
              <strong>{profile.full_name || profile.email}</strong>
              <small>{access.roleLabel}</small>
            </div>
          </div>

          <button
            className="button secondary full sign-out"
            onClick={signOut}
            title="Sign Out"
            aria-label="Sign Out"
          >
            <span className="sign-out-text">Sign Out</span>
            <span className="sign-out-icon" aria-hidden="true">⎋</span>
          </button>

          <div className="brand-footer">
            <strong>Oksy Academy</strong>
            <span>Oksy Academy Pulse v2.0</span>
            <span>Education for a Brighter Tomorrow</span>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-left">
            <button className="nav-toggle" onClick={toggleNav} title="Show / hide menu" aria-label="Toggle navigation">
              ☰
            </button>
            <div>
              <h1>{TAB_TITLES[activeTab] || activeTab}</h1>
              {TAB_SUBTITLES[activeTab] && <p>{TAB_SUBTITLES[activeTab]}</p>}
            </div>
          </div>
          <div className="topbar-right">
            {PERIOD_FILTER_TABS.has(activeTab) && (
              <PeriodFilter period={period} onChange={setPeriod} />
            )}
            <NotificationBell onNavigate={(tab) => access.canOpen(tab) && setActiveTab(tab)} />
            <div className="top-user">
              <span className="top-user-avatar">
                {(profile.full_name || profile.email || "?").charAt(0).toUpperCase()}
              </span>
              <span className="top-user-name">
                {profile.full_name || profile.email}
              </span>
            </div>
            <button
              className="top-sign-out"
              onClick={signOut}
              title="Sign Out"
              aria-label="Sign Out"
            >
              <span className="top-sign-out-text">Sign Out</span>
              <span className="top-sign-out-icon" aria-hidden="true">⎋</span>
            </button>
          </div>
        </header>

        {dataLoading && <div className="auth-message page-error">Loading data...</div>}
        {dataError && <div className="auth-message error page-error">{dataError}</div>}

        <ErrorBoundary key={activeTab}>
        <React.Suspense fallback={<div className="auth-message page-error">Loading…</div>}>

        {nav.length === 0 && (
          <div className="page">
            <div className="empty-state">
              <div className="empty-icon">🔒</div>
              <h3>No sections enabled for your role yet</h3>
              <p>
                Your account ({access.roleLabel}) is approved, but the Owner hasn&apos;t
                granted it access to any area. Ask them to set it in Admin → Access.
              </p>
            </div>
          </div>
        )}

        {nav.length > 0 && access.canOpen(HOME) && activeTab === HOME && (
          <Dashboard
            profile={profile}
            role={access.role}
            batches={batches}
            totals={totals}
            allStudents={students}
            allCollections={collections}
            allExpenses={expenses}
            periodCollections={visibleCollections}
            periodExpenses={visibleExpenses}
            range={range}
            periodLabel={periodLabel(period)}
            fullDashboard={access.fullDashboard}
            onNavigate={setActiveTab}
          />
        )}

        {activeTab === "Timetable" && (
          <TimetablePage
            access={access}
            batches={batches}
            onOpenLiveClass={() => setActiveTab("Live Class")}
          />
        )}

        {activeTab === "Live Class" && <LiveClassPage access={access} />}

        {activeTab === "Assignments" && (
          <AssignmentsPage access={access} profile={profile} batches={batches} />
        )}

        {activeTab === "Exams" && (
          <ExamsPage access={access} profile={profile} batches={batches} />
        )}

        {activeTab === "Reviews" && (
          <ReviewsPage access={access} profile={profile} />
        )}

        {activeTab === "Enrollment" && (
          <EnrollmentPage
            students={students}
            batches={batches}
            loading={dataLoading}
            onFileSelected={handleStudentFile}
            onNew={openNewStudent}
            onEdit={editStudent}
            showForm={showStudentForm}
            editingStudent={editingStudent}
            form={studentForm}
            setForm={setStudentForm}
            onCancel={() => setShowStudentForm(false)}
            onSave={saveStudent}
            saving={savingStudent}
            formError={studentFormError}
          />
        )}

        {activeTab === "Fee Collection" && (
          <FeeCollectionPage
            students={students}
            collections={visibleCollections}
            allCollections={collections}
            periodLabel={periodLabel(period)}
            loading={dataLoading}
            form={collectionForm}
            setForm={setCollectionForm}
            onSubmit={addCollection}
            onEdit={editCollection}
            onDelete={removeCollection}
            onFileSelected={handleCollectionFile}
            canEdit={access.canEditRecords}
            canDelete={access.canDelete}
            saving={savingCollection}
            formError={collectionFormError}
          />
        )}

        {activeTab === "Expenses" && (
          <ExpensesPage
            expenses={visibleExpenses}
            categories={expenseCategories}
            periodLabel={periodLabel(period)}
            loading={dataLoading}
            form={expenseForm}
            setForm={setExpenseForm}
            onSubmit={addExpense}
            onEdit={editExpense}
            onDelete={removeExpense}
            onFileSelected={handleExpenseFile}
            canEdit={access.canEditRecords}
            canDelete={access.canDelete}
            saving={savingExpense}
            formError={expenseFormError}
          />
        )}

        {activeTab === "Banking" && (
          <BankingPage
            totals={totals}
            isAdmin={isAdmin}
            students={students}
            transfers={transfers}
            collections={collections}
            expenses={expenses}
            bankStatements={bankStatements}
            bankLines={bankLines}
            busy={bankBusy}
            loading={dataLoading}
            transferForm={transferForm}
            setTransferForm={setTransferForm}
            onAddTransfer={addTransfer}
            onEditTransfer={editTransfer}
            onDeleteTransfer={removeTransfer}
            savingTransfer={savingTransfer}
            transferFormError={transferFormError}
            onTransferFile={handleTransferFile}
            onUploadStatement={uploadBankStatement}
            onClassifyLine={classifyBankLine}
            onIgnoreLine={setBankLineIgnored}
            onUnmatchLine={unmatchBankLine}
            onDeleteStatement={removeBankStatement}
          />
        )}

        {activeTab === "Reports" && (
          <ReportsPage
            data={{ collections, expenses, transfers, students }}
            range={range}
            periodLabel={periodLabel(period)}
            allReports={access.allReports}
          />
        )}

        {activeTab === "Admin" && (
          <AdminPage
            batches={batches}
            categories={expenseCategories}
            expenses={expenses}
            busy={adminBusy}
            actions={admin}
            canManageUsers={access.manageUsers}
            canManageAccess={access.manageAccess}
            canDelete={access.canDelete}
            roleAreas={appSettings.roleAreas}
          />
        )}

        </React.Suspense>
        </ErrorBoundary>
      </main>

      {importPreview && (
        <ImportPreviewModal
          title={importPreview.title}
          columns={importPreview.columns}
          validRows={importPreview.validRows}
          invalidRows={importPreview.invalidRows}
          busy={importPreview.committing}
          onCancel={cancelImport}
          onConfirm={confirmImport}
        />
      )}

      {receipt && <Receipt receipt={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}
