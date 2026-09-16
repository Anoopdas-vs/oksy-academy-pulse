// Bank reconciliation helpers: book-balance math and auto-matching uploaded
// statement lines against the app's own transactions.

import { formatMoney } from "./format.js";

const amt = (v) => Number(v || 0);
const onOrBefore = (dateStr, cutoff) => !cutoff || String(dateStr).slice(0, 10) <= cutoff;

// Signed movement each transaction applies to `account`'s balance. Each
// entry also carries a free-text `label` — the record's own identifying
// text (payer name, category/description, purpose/reference) — used by
// autoMatch to score payer-identity against the bank line's description.
export function accountLedger(account, { collections = [], expenses = [], transfers = [] }) {
  const entries = [];
  collections.forEach((c) => {
    if (c.account === account) {
      entries.push({ kind: "collection", id: c.id, date: c.date, delta: amt(c.amount), label: c.student_name || "" });
    }
  });
  expenses.forEach((e) => {
    if (e.account === account) {
      entries.push({
        kind: "expense",
        id: e.id,
        date: e.date,
        delta: -amt(e.amount),
        label: [e.category, e.description].filter(Boolean).join(" "),
      });
    }
  });
  transfers.forEach((t) => {
    if (t.to_account === account) {
      entries.push({
        kind: "transfer",
        id: t.id,
        date: t.date,
        delta: amt(t.amount),
        label: [t.purpose, t.reference].filter(Boolean).join(" "),
      });
    }
    if (t.from_account === account) {
      entries.push({
        kind: "transfer",
        id: t.id,
        date: t.date,
        delta: -amt(t.amount),
        label: [t.purpose, t.reference].filter(Boolean).join(" "),
      });
    }
  });
  return entries;
}

export function bookBalanceAsOf(account, cutoff, data) {
  return accountLedger(account, data)
    .filter((e) => onOrBefore(e.date, cutoff))
    .reduce((sum, e) => sum + e.delta, 0);
}

/* -------------------- payer-identity matching helpers -------------------- */

// Words that show up in bank descriptions/references but never identify a
// payer — payment-network jargon, bank names, generic transfer language.
const IDENTITY_STOPWORDS = new Set([
  "upi", "neft", "imps", "rtgs", "ach", "bank", "of", "india", "ltd", "pvt",
  "limited", "co", "ind", "account", "acct", "payment", "transfer", "fund",
  "funds", "utr", "txn", "ref", "reference", "no", "from", "to", "via",
  "and", "the", "charges", "charge", "fee", "fees", "paid", "collect",
  "collected", "deposit", "credit", "debit", "mode", "cms",
]);

const normalizeToken = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
const stripTrailingDigits = (s) => String(s || "").replace(/[0-9]+$/, "");

// Pull out the text fragments in a bank line's description/reference that
// could plausibly identify the payer: the local part of any UPI VPA
// (e.g. "fahmidat0181@okbank" -> "fahmidat"), and any other alphabetic
// word long enough to be a name, minus payment-network noise words.
export function extractIdentityCandidates(description = "", reference = "") {
  const text = `${description || ""} ${reference || ""}`;
  const candidates = new Set();

  const vpas = text.match(/[a-zA-Z0-9._-]+@[a-zA-Z][a-zA-Z0-9.]*/g) || [];
  vpas.forEach((vpa) => {
    const local = normalizeToken(stripTrailingDigits(vpa.split("@")[0]));
    if (local.length >= 3) candidates.add(local);
  });

  text
    .split(/[^a-zA-Z]+/)
    .filter(Boolean)
    .forEach((w) => {
      const lw = w.toLowerCase();
      if (lw.length < 3 || IDENTITY_STOPWORDS.has(lw)) return;
      candidates.add(lw);
    });

  return Array.from(candidates);
}

const bigrams = (s) => {
  const out = [];
  for (let i = 0; i < s.length - 1; i += 1) out.push(s.slice(i, i + 2));
  return out;
};

// 0-1 similarity between two short strings (names/tokens), via bigram Dice
// coefficient with a boost for a clean prefix match (handles a VPA local
// part like "fahmidat" against the name "fahmida").
export function nameSimilarity(a, b) {
  const na = normalizeToken(a);
  const nb = normalizeToken(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.length >= 3 && nb.length >= 3 && (na.startsWith(nb) || nb.startsWith(na))) return 0.9;
  const ba = bigrams(na);
  const bb = bigrams(nb);
  if (!ba.length || !bb.length) return 0;
  const bbCount = new Map();
  bb.forEach((g) => bbCount.set(g, (bbCount.get(g) || 0) + 1));
  let overlap = 0;
  ba.forEach((g) => {
    const c = bbCount.get(g) || 0;
    if (c > 0) {
      overlap += 1;
      bbCount.set(g, c - 1);
    }
  });
  return (2 * overlap) / (ba.length + bb.length);
}

// Best identity-match score (0-1) between a bank line's free text
// (description + reference) and a candidate record's own label (student
// name, expense category/description, transfer purpose/reference).
export function identityMatchScore(description, reference, label) {
  const candidates = extractIdentityCandidates(description, reference);
  const targetWords = String(label || "")
    .split(/[^a-zA-Z]+/)
    .filter((w) => w.length >= 3);
  if (!candidates.length || !targetWords.length) return 0;
  let best = 0;
  candidates.forEach((c) => {
    targetWords.forEach((w) => {
      best = Math.max(best, nameSimilarity(c, w));
    });
  });
  return best;
}

/* ---------------------------- auto-matching ------------------------------ */

// Weighted score of how well a candidate app entry explains a bank line,
// on top of the mandatory amount+direction filter: date exactness and
// payer identity (extracted from the line's description/reference vs the
// candidate's own label).
const DATE_WEIGHT = 0.4;
const IDENTITY_WEIGHT = 0.6;
// When more than one candidate shares the amount and lands on the same
// date, the identity score must clear this floor, AND beat the runner-up
// by this margin, before we auto-pick a winner — otherwise it's a genuine
// ambiguity (e.g. two students paying the same fee the same day) and the
// line is surfaced for manual review instead of guessed.
const MIN_IDENTITY_TO_DISAMBIGUATE = 0.55;
const DISAMBIGUATION_MARGIN = 0.15;

// Score/rank candidate matches for `lines` against `account`'s ledger.
// Returns an array parallel to `lines`, each element one of:
//   { status: 'unmatched' }
//   { status: 'matched', match_kind, match_id, match_score }
//   { status: 'review', candidates: [{ match_kind, match_id, date, score }] }
// A line only ever considers app entries of the same direction and equal
// amount (to the rupee) within `dayWindow` days — that filter is mandatory,
// not itself the ranking. Each app entry is consumed by at most one line.
export function autoMatch(lines, account, data, dayWindow = 4) {
  const ledger = accountLedger(account, data);
  const used = new Set();
  const key = (e) => `${e.kind}:${e.id}`;
  const dayMs = 86400000;

  return lines.map((ln) => {
    const wantDeposit = amt(ln.deposit) > 0;
    const target = wantDeposit ? amt(ln.deposit) : amt(ln.withdrawal);
    const lnTime = new Date(ln.date).getTime();
    const lnDateStr = String(ln.date).slice(0, 10);

    const pool = ledger.filter((e) => {
      if (used.has(key(e))) return false;
      const isDeposit = e.delta > 0;
      if (isDeposit !== wantDeposit) return false;
      if (Math.round(Math.abs(e.delta)) !== Math.round(target)) return false;
      const dd = Math.abs(new Date(e.date).getTime() - lnTime) / dayMs;
      return dd <= dayWindow;
    });

    if (!pool.length) return { status: "unmatched" };

    const scored = pool
      .map((e) => {
        const dd = Math.abs(new Date(e.date).getTime() - lnTime) / dayMs;
        const dateScore = Math.max(0, 1 - dd / Math.max(dayWindow, 1));
        const identityScore = identityMatchScore(ln.description, ln.reference, e.label);
        const score = DATE_WEIGHT * dateScore + IDENTITY_WEIGHT * identityScore;
        const sameDate = String(e.date).slice(0, 10) === lnDateStr;
        return { e, score, identityScore, sameDate };
      })
      .sort((a, b) => b.score - a.score);

    const [top, runnerUp] = scored;

    // The classic collision: two-or-more same-amount/same-date candidates.
    // Only auto-pick between them when the identity signal is both strong
    // and decisive; otherwise this is a genuine ambiguity, not a match.
    const tiedOnDate = scored.filter((s) => s.sameDate);
    const contest = tiedOnDate.length > 1 ? tiedOnDate : scored;
    const isAmbiguous =
      contest.length > 1 &&
      (top.identityScore < MIN_IDENTITY_TO_DISAMBIGUATE ||
        (runnerUp && top.score - runnerUp.score < DISAMBIGUATION_MARGIN));

    if (isAmbiguous) {
      return {
        status: "review",
        candidates: scored.slice(0, 5).map((s) => ({
          match_kind: s.e.kind,
          match_id: s.e.id,
          date: s.e.date,
          score: Math.round(s.score * 100) / 100,
        })),
      };
    }

    used.add(key(top.e));
    return {
      status: "matched",
      match_kind: top.e.kind,
      match_id: top.e.id,
      match_score: Math.round(top.score * 100) / 100,
    };
  });
}

// Human label for a match kind. "collection" reads as "fee collection".
export const MATCH_KIND_LABEL = {
  collection: "fee collection",
  expense: "expense",
  transfer: "transfer",
};

export function matchKindLabel(kind) {
  return MATCH_KIND_LABEL[kind] || kind || "record";
}

// For a line sitting in 'review' (an ambiguous same-amount/same-date
// collision the auto-matcher refused to guess on), recompute the tied
// candidates live from current data so the UI can show staff exactly what
// it's choosing between -- same live-lookup approach as matchedRecordDetail
// below, so this never goes stale relative to a stored snapshot.
//   -> { title, rows: [{ k, v }] } | null
export function reviewCandidatesDetail(line, data = {}, students = []) {
  const account = line.account;
  if (!account) return null;
  const ledger = accountLedger(account, data);
  const wantDeposit = Number(line.deposit) > 0;
  const target = wantDeposit ? Number(line.deposit) : Number(line.withdrawal);
  const lnTime = new Date(line.txn_date).getTime();
  const dayMs = 86400000;
  const dayWindow = 4;

  const pool = ledger.filter((e) => {
    const isDeposit = e.delta > 0;
    if (isDeposit !== wantDeposit) return false;
    if (Math.round(Math.abs(e.delta)) !== Math.round(target)) return false;
    const dd = Math.abs(new Date(e.date).getTime() - lnTime) / dayMs;
    return dd <= dayWindow;
  });

  const rows = pool
    .map((e) => {
      const identityScore = identityMatchScore(line.description, line.reference, e.label);
      let who = e.label || "—";
      if (e.kind === "collection") {
        const stu = (students || []).find((s) => String(s.id) === String(e.id) || s.name === e.label);
        who = e.label || stu?.name || "—";
      }
      return { k: `${e.date} · ${matchKindLabel(e.kind)}`, v: `${who} (identity match ${Math.round(identityScore * 100)}%)` };
    })
    .sort((a, b) => (a.k < b.k ? -1 : 1));

  if (!rows.length) return null;
  return { title: "Possible matches — pick one via Resolve", rows };
}

// Resolve a matched/classified statement line to the underlying app record
// and return the fields to show when the user hovers its status tag — so an
// auto-match can be visually confirmed (or spotted as wrong and unmatched).
//   -> { title, rows: [{ k, v }] }  |  null
export function matchedRecordDetail(line, data = {}, students = []) {
  const kind = line?.match_kind;
  const id = line?.match_id;
  if (!kind || id == null) return null;

  const notFound = (title) => ({
    title,
    rows: [{ k: "Record", v: "not found — it may have been deleted" }],
  });

  if (kind === "collection") {
    const c = (data.collections || []).find((r) => String(r.id) === String(id));
    if (!c) return notFound("Fee collection");
    const stu = (students || []).find((s) => s.id === c.student_id);
    return {
      title: "Fee collection",
      rows: [
        { k: "Date", v: c.date },
        { k: "Student ID", v: c.student_id },
        { k: "Student", v: c.student_name || stu?.name || "—" },
        { k: "Batch", v: stu?.batch || "—" },
        { k: "Type", v: c.type || "—" },
        { k: "Amount", v: formatMoney(c.amount) },
        ...(c.bank_reference ? [{ k: "Bank reference", v: c.bank_reference }] : []),
      ],
    };
  }

  if (kind === "expense") {
    const e = (data.expenses || []).find((r) => String(r.id) === String(id));
    if (!e) return notFound("Expense");
    return {
      title: "Expense",
      rows: [
        { k: "Date", v: e.date },
        { k: "Category", v: e.category || "—" },
        { k: "Description", v: e.description || "—" },
        { k: "Account", v: e.account || "—" },
        { k: "Amount", v: formatMoney(e.amount) },
        ...(e.bank_reference ? [{ k: "Bank reference", v: e.bank_reference }] : []),
      ],
    };
  }

  if (kind === "transfer") {
    const t = (data.transfers || []).find((r) => String(r.id) === String(id));
    if (!t) return notFound("Transfer");
    return {
      title: "Transfer",
      rows: [
        { k: "Date", v: t.date },
        { k: "From → To", v: `${t.from_account} → ${t.to_account}` },
        { k: "Purpose", v: t.purpose || "—" },
        { k: "Reference", v: t.reference || "—" },
        { k: "Amount", v: formatMoney(t.amount) },
        ...(t.bank_reference ? [{ k: "Bank reference", v: t.bank_reference }] : []),
      ],
    };
  }

  return null;
}

export function reconciliationSummary(statement, lines, data) {
  const book = bookBalanceAsOf(statement.account, statement.period_end, data);
  const statementClosing = Number(statement.closing_balance || 0);
  const open = lines.filter((l) => l.status === "unmatched").length;
  const review = lines.filter((l) => l.status === "review").length;
  const ignored = lines.filter((l) => l.status === "ignored").length;
  return {
    bookBalance: book,
    statementClosing,
    difference: statementClosing - book,
    openCount: open,
    reviewCount: review,
    ignoredCount: ignored,
    reconciled: open === 0 && review === 0 && Math.round(statementClosing - book) === 0,
  };
}

// Fee collections whose bank_reference doesn't textually match their own
// student_name — a re-verification report for historical matches (see the
// "Fix Bank Reconciliation Matching Logic" brief, acceptance criterion on
// re-verifying existing matches). Sorted worst-match first.
export function bankReferenceMismatches(collections = [], threshold = 0.45) {
  return collections
    .filter((c) => c.bank_reference)
    .map((c) => ({
      id: c.id,
      date: c.date,
      student_name: c.student_name,
      amount: c.amount,
      bank_reference: c.bank_reference,
      score: identityMatchScore(c.bank_reference, "", c.student_name),
    }))
    .filter((r) => r.score < threshold)
    .sort((a, b) => a.score - b.score);
}
