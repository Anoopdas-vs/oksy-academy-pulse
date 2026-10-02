// Bank reconciliation helpers: book-balance math and auto-matching uploaded
// statement lines against the app's own transactions.

import { formatMoney } from "./format.js";
import { daysBetweenISO } from "./dates.js";

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
      entries.push({
        kind: "collection",
        id: c.id,
        date: c.date,
        delta: amt(c.amount),
        label: c.student_name || "",
        refText: [c.reference, c.bank_reference].filter(Boolean).join(" "),
      });
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
        refText: [e.reference, e.bank_reference].filter(Boolean).join(" "),
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
        refText: [t.reference, t.bank_reference].filter(Boolean).join(" "),
      });
    }
    if (t.from_account === account) {
      entries.push({
        kind: "transfer",
        id: t.id,
        date: t.date,
        delta: -amt(t.amount),
        label: [t.purpose, t.reference].filter(Boolean).join(" "),
        refText: [t.reference, t.bank_reference].filter(Boolean).join(" "),
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
// When several candidates contend for a line, the identity score must clear
// this floor, AND beat the runner-up by this margin, before we auto-pick a
// winner -- otherwise it's a genuine ambiguity and the line goes to review.
const MIN_IDENTITY_TO_DISAMBIGUATE = 0.55;
const DISAMBIGUATION_MARGIN = 0.15;
// Sentinel match_score stored for a pairing chosen only by statement order
// (same date + amount, equal line/record counts, no name evidence). The UI
// reads it back via isOrderAssumed() to flag the match for a manual check.
export const ORDER_ASSUMED_SCORE = 0.01;

const isoDay = (d) => String(d || "").slice(0, 10);
const entryKey = (e) => `${e.kind}:${e.id}`;
const round2 = (n) => Math.round(n * 100) / 100;

// Direction, whole-rupee amount and calendar day of a statement line.
// Accepts either an upload-time line ({ date }) or a stored one ({ txn_date }).
function lineFacts(ln) {
  const wantDeposit = amt(ln.deposit) > 0;
  return {
    wantDeposit,
    target: Math.round(wantDeposit ? amt(ln.deposit) : amt(ln.withdrawal)),
    dateStr: isoDay(ln.date ?? ln.txn_date),
  };
}

// 12-digit transaction ids (UPI RRN / IMPS ref) found in free text.
export function extractUtrs(...texts) {
  const found = texts.filter(Boolean).join(" ").match(/(?<![0-9A-Za-z])[0-9]{12}(?![0-9A-Za-z])/g);
  return found ? Array.from(new Set(found)) : [];
}

// Every unused ledger entry that could explain `ln` (same direction, same
// amount to the rupee, within `dayWindow` calendar days), scored and sorted
// best-first. The single place this filter lives -- autoMatch and the
// review-candidates tooltip both call it so they can never disagree.
export function rankCandidates(ln, ledger, { used = new Set(), dayWindow = 4 } = {}) {
  const { wantDeposit, target, dateStr } = lineFacts(ln);
  return ledger
    .filter((e) => !used.has(entryKey(e)) && e.delta > 0 === wantDeposit && Math.round(Math.abs(e.delta)) === target)
    .map((e) => ({ e, dd: Math.abs(daysBetweenISO(dateStr, isoDay(e.date))) }))
    .filter(({ dd }) => dd <= dayWindow)
    .map(({ e, dd }) => {
      const dateScore = Math.max(0, 1 - dd / Math.max(dayWindow, 1));
      const identityScore = identityMatchScore(ln.description, ln.reference, e.label);
      return {
        e,
        dd,
        identityScore,
        sameDate: dd === 0,
        score: DATE_WEIGHT * dateScore + IDENTITY_WEIGHT * identityScore,
      };
    })
    .sort((a, b) => b.score - a.score);
}

// An exact-date candidate is still not trusted when a different candidate
// in the window is clearly the better payer-identity fit.
const hasIdentityConflict = (exact, pool) =>
  pool.some(
    (s) =>
      s !== exact &&
      s.identityScore >= MIN_IDENTITY_TO_DISAMBIGUATE &&
      s.identityScore - exact.identityScore >= DISAMBIGUATION_MARGIN
  );

// Auto-match statement `lines` against `account`'s ledger. Returns an array
// parallel to `lines`, each element one of:
//   { status: 'unmatched' }
//   { status: 'matched', match_kind, match_id, match_score, match_method,
//     assumed_by_order? }
//   { status: 'review', candidates: [{ match_kind, match_id, date, score }] }
// Each app entry is consumed by at most one line. Passes, most certain first:
//   0. UTR       a 12-digit transaction id on the record equals the line's
//   1. exact     the line has exactly one same-date candidate nobody else
//                also claims (and no better identity fit elsewhere)
//   2. group     N lines and N records share date+amount: pair by identity
//                where decisive, the rest by statement order ("assumed")
//   3. scored    date + identity scoring; ambiguity goes to review
// `usedKeys` ("kind:id") seeds entries that must not be matched again.
export function autoMatch(lines, account, data, dayWindow = 4, { usedKeys = [] } = {}) {
  const ledger = accountLedger(account, data);
  const used = new Set(usedKeys);
  const results = new Array(lines.length).fill(null);
  const rankedFor = (i) => rankCandidates(lines[i], ledger, { used, dayWindow });
  const openIdx = () => lines.map((_, i) => i).filter((i) => !results[i]);

  const take = (i, e, score, method, extra = {}) => {
    used.add(entryKey(e));
    results[i] = {
      status: "matched",
      match_kind: e.kind,
      match_id: e.id,
      match_score: round2(score),
      match_method: method,
      ...extra,
    };
  };

  // Resolve proposals {i, e, score} only where the record is proposed by one
  // line alone (and, for `claims`, claimed by no other line at all).
  const applyUnique = (proposals, claims, method) => {
    proposals.forEach(({ i, s }) => {
      if ((claims.get(entryKey(s.e)) || 0) === 1) take(i, s.e, s.score, method);
    });
  };
  const countClaims = (poolsByLine) => {
    const claims = new Map();
    poolsByLine.forEach((pool) =>
      pool.forEach((s) => claims.set(entryKey(s.e), (claims.get(entryKey(s.e)) || 0) + 1))
    );
    return claims;
  };

  // Pass 0 -- UTR.
  {
    const pools = [];
    const proposals = [];
    openIdx().forEach((i) => {
      const utrs = extractUtrs(lines[i].description, lines[i].reference);
      if (!utrs.length) return;
      const hits = rankedFor(i).filter((s) => extractUtrs(s.e.refText).some((u) => utrs.includes(u)));
      pools.push(hits);
      if (hits.length === 1) proposals.push({ i, s: hits[0] });
    });
    applyUnique(proposals, countClaims(pools), "utr");
    proposals.forEach(({ i }) => {
      if (results[i]) results[i].match_score = 1;
    });
  }

  // Pass 1 -- unique exact date + amount, one-to-one.
  {
    const pools = [];
    const proposals = [];
    openIdx().forEach((i) => {
      const ranked = rankedFor(i);
      const exact = ranked.filter((s) => s.sameDate);
      pools.push(exact);
      if (exact.length === 1 && !hasIdentityConflict(exact[0], ranked)) proposals.push({ i, s: exact[0] });
    });
    applyUnique(proposals, countClaims(pools), "exact");
  }

  // Pass 2 -- equal-sized same date+amount groups.
  {
    const groups = new Map();
    openIdx().forEach((i) => {
      const { wantDeposit, target, dateStr } = lineFacts(lines[i]);
      const k = `${wantDeposit}|${target}|${dateStr}`;
      if (!groups.has(k)) groups.set(k, { wantDeposit, target, dateStr, idxs: [] });
      groups.get(k).idxs.push(i);
    });
    groups.forEach(({ wantDeposit, target, dateStr, idxs }) => {
      if (idxs.length < 2) return;
      let entries = ledger
        .filter(
          (e) =>
            !used.has(entryKey(e)) &&
            e.delta > 0 === wantDeposit &&
            Math.round(Math.abs(e.delta)) === target &&
            isoDay(e.date) === dateStr
        )
        .sort((a, b) => Number(a.id) - Number(b.id) || (a.kind < b.kind ? -1 : 1));
      if (entries.length !== idxs.length) return;
      let todo = idxs.slice();

      // Identity first: a line whose payer clearly points at one record.
      for (let progress = true; progress && todo.length; ) {
        progress = false;
        const picks = [];
        todo.forEach((i) => {
          const scored = entries
            .map((e) => ({ e, id: identityMatchScore(lines[i].description, lines[i].reference, e.label) }))
            .sort((a, b) => b.id - a.id);
          const [best, next] = scored;
          if (best.id >= MIN_IDENTITY_TO_DISAMBIGUATE && (!next || best.id - next.id >= DISAMBIGUATION_MARGIN)) {
            picks.push({ i, e: best.e, id: best.id });
          }
        });
        picks.forEach(({ i, e, id }) => {
          if (picks.filter((p) => p.e === e).length !== 1) return;
          take(i, e, DATE_WEIGHT + IDENTITY_WEIGHT * id, "group-identity");
          todo = todo.filter((x) => x !== i);
          entries = entries.filter((x) => x !== e);
          progress = true;
        });
      }

      // The rest: statement order <-> receipt order. Not evidence, so it is
      // flagged and the caller must not write bank_reference for it.
      todo.forEach((i, n) => take(i, entries[n], ORDER_ASSUMED_SCORE, "order", { assumed_by_order: true }));
    });
  }

  // Pass 3 -- date + identity scoring for whatever is left.
  openIdx().forEach((i) => {
    const pool = rankedFor(i);
    if (!pool.length) {
      results[i] = { status: "unmatched" };
      return;
    }
    // A lone exact-date candidate is judged alone (unless a better identity
    // fit exists elsewhere); several exact-date candidates contest among
    // themselves; otherwise the whole window contests.
    const exact = pool.filter((s) => s.sameDate);
    let contest = pool;
    if (exact.length > 1 || (exact.length === 1 && !hasIdentityConflict(exact[0], pool))) contest = exact;
    const [top, runnerUp] = contest;
    const ambiguous =
      contest.length > 1 &&
      (top.identityScore < MIN_IDENTITY_TO_DISAMBIGUATE || top.score - runnerUp.score < DISAMBIGUATION_MARGIN);

    if (ambiguous) {
      results[i] = {
        status: "review",
        candidates: pool.slice(0, 5).map((s) => ({
          match_kind: s.e.kind,
          match_id: s.e.id,
          date: s.e.date,
          score: round2(s.score),
        })),
      };
      return;
    }
    take(i, top.e, top.score, "scored");
  });

  return results;
}

// True for a stored line that was paired only by statement order.
export const isOrderAssumed = (line) =>
  line?.status === "matched" && Number(line.match_score) === ORDER_ASSUMED_SCORE;

const OPEN_STATUSES = new Set(["review", "unmatched"]);
// Entries already held by stored lines. A line's `links` (see attachLinks)
// win; lines without them fall back to the legacy match_kind/match_id pair.
const usedKeysOf = (lines, account) =>
  lines
    .filter((l) => l.account === account && (l.status === "matched" || l.status === "classified"))
    .flatMap((l) =>
      l.links?.length
        ? l.links.map((k) => `${k.bookKind}:${k.bookId}`)
        : l.match_kind && l.match_id != null
          ? [`${l.match_kind}:${l.match_id}`]
          : []
    );
const asAutoLine = (l) => ({
  date: l.txn_date,
  description: l.description,
  reference: l.reference,
  deposit: l.deposit,
  withdrawal: l.withdrawal,
});

// Dry-run for "Re-run auto-match" on a stored statement. Only lines that are
// currently 'review' or 'unmatched' are considered; matched / classified /
// ignored lines are never touched, and the records they hold are excluded
// from matching. Returns only the lines whose outcome would change:
//   [{ line, old_status, new_status, match_kind, match_id, match_score,
//      match_method, assumed_by_order }]
export function planRerun(statementLines, allLines, account, data, dayWindow = 4) {
  const open = statementLines
    .filter((l) => OPEN_STATUSES.has(l.status))
    .sort((a, b) => (a.seq || 0) - (b.seq || 0));
  const results = autoMatch(open.map(asAutoLine), account, data, dayWindow, {
    usedKeys: usedKeysOf(allLines, account),
  });
  const changes = [];
  open.forEach((line, i) => {
    const r = results[i];
    if (r.status !== "matched" && r.status === line.status) return;
    changes.push({
      line,
      old_status: line.status,
      new_status: r.status,
      match_kind: r.match_kind || null,
      match_id: r.match_id ?? null,
      match_score: r.match_score ?? null,
      match_method: r.match_method || null,
      assumed_by_order: !!r.assumed_by_order,
    });
  });
  return changes;
}

// Up to 5 subsets (2..maxSize entries) of `entries` whose values sum to
// `total`. `valueOf` defaults to whole rupees; the link matcher passes paise.
function subsetsSumming(entries, total, maxSize, valueOf = (e) => Math.round(Math.abs(e.delta))) {
  const out = [];
  const walk = (start, picked, sum) => {
    if (out.length >= 5) return;
    if (sum === total && picked.length >= 2) out.push(picked.slice());
    if (picked.length === maxSize || sum >= total) return;
    for (let i = start; i < entries.length; i += 1) {
      picked.push(entries[i]);
      walk(i + 1, picked, sum + valueOf(entries[i]));
      picked.pop();
    }
  };
  walk(0, [], 0);
  return out;
}

// Suggest -- never apply -- groupings where no single record explains a
// line: one line equal to the sum of 2-3 records, or several same-day lines
// whose total equals the sum of up to 4 records. A line can only hold one
// match in the schema, so the user confirms these by hand via Resolve.
//   -> [{ lines: [line...], total, options: [[entry...]...] }]
export function suggestSplitGroups(statementLines, allLines, account, data, dayWindow = 4) {
  const ledger = accountLedger(account, data);
  const used = new Set(usedKeysOf(allLines, account));
  const open = statementLines.filter(
    (l) => OPEN_STATUSES.has(l.status) && !rankCandidates(asAutoLine(l), ledger, { used, dayWindow }).length
  );

  const suggestFor = (group, maxSize) => {
    const { wantDeposit, dateStr } = lineFacts(asAutoLine(group[0]));
    const total = group.reduce((s, l) => s + lineFacts(asAutoLine(l)).target, 0);
    const free = ledger.filter((e) => !used.has(entryKey(e)) && e.delta > 0 === wantDeposit);
    const sameDay = free.filter((e) => isoDay(e.date) === dateStr);
    let options = subsetsSumming(sameDay, total, maxSize);
    if (!options.length) {
      const near = free.filter((e) => Math.abs(daysBetweenISO(dateStr, isoDay(e.date))) <= dayWindow);
      options = subsetsSumming(near, total, maxSize);
    }
    return options.length ? { lines: group, total, options } : null;
  };

  const suggestions = [];
  open.forEach((l) => {
    const s = suggestFor([l], 3);
    if (s) suggestions.push(s);
  });
  const byDay = new Map();
  open.forEach((l) => {
    const { wantDeposit, dateStr } = lineFacts(asAutoLine(l));
    const k = `${wantDeposit}|${dateStr}`;
    byDay.set(k, [...(byDay.get(k) || []), l]);
  });
  byDay.forEach((group) => {
    if (group.length < 2) return;
    const s = suggestFor(group, 4);
    if (s) suggestions.push(s);
  });
  return suggestions;
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
  const pool = rankCandidates(
    { date: line.txn_date, description: line.description, reference: line.reference, deposit: line.deposit, withdrawal: line.withdrawal },
    ledger
  ).map((s) => s.e);

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
        ...(isOrderAssumed(line) ? [{ k: "Match basis", v: "assumed by order — please verify" }] : []),
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

// ---------------------------------------------------------------------------
// Link-based matching (bank_match_links, migration 32).
// Rules: ONE bank line may link to MANY book entries; a book entry links to
// only ONE bank line. Many lines -> one entry is never auto-linked: it is
// reported as "split_needed" and the user splits the book entry. Direction is
// never crossed (CR <-> collections / transfers in, DR <-> expenses /
// transfers out). Nothing is guessed: ambiguity stays in review with the
// candidates attached. Single-tenant: one academy, no tenant scoping.
// ---------------------------------------------------------------------------

const NEAR_DATE_DAYS = 3;
const MAX_GROUP_ENTRIES = 4;
const cents = (v) => Math.round(Math.abs(amt(v)) * 100);
const lineCents = (ln) => cents(amt(ln.deposit) > 0 ? ln.deposit : ln.withdrawal);
const moneyText = (n) =>
  Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const centsOf = (e) => Math.round(Math.abs(e.delta) * 100);

const candidateOf = (line, e) => ({
  bookKind: e.kind,
  bookId: e.id,
  date: isoDay(e.date),
  amount: centsOf(e) / 100,
  dateDiff: daysBetweenISO(isoDay(e.date), lineFacts(line).dateStr),
});

// Match every statement line against the unlinked ledger entries of `account`.
// Returns an array parallel to `lines`:
//   { lineId, index, links: [{ bookKind, bookId, source }],
//     status: 'matched' | 'review' | 'unmatched', reason, candidates }
// reasons: utr_amount_mismatch, utr_ambiguous, ambiguous, split_needed,
//          near_date_suggestion (candidates[0].suggested), null.
// Passes (each only on what is still open, an entry used at most once):
//   a) auto_utr    12-digit UTR in the description equals the entry's reference
//                  AND the amount is equal; unequal amount -> review
//   b) auto_exact  same date + amount, exactly one candidate on both sides
//   c) auto_group  amount == sum of 2..4 same-day entries, one such combination
//   d) near date   same amount within +/-3 days, one candidate -> suggestion
// `usedKeys` ("kind:id") seeds entries that are already linked elsewhere.
export function matchStatementLines(lines, account, data, { usedKeys = [] } = {}) {
  const ledger = accountLedger(account, data);
  const used = new Set(usedKeys);
  const held = new Set(); // reserved by a UTR review; nobody else may take them
  const out = lines.map((ln, i) => ({
    lineId: ln.id ?? ln.seq ?? i,
    index: i,
    links: [],
    status: "unmatched",
    reason: null,
    candidates: [],
  }));
  const free = (e) => !used.has(entryKey(e)) && !held.has(entryKey(e));
  const open = () => out.map((_, i) => i).filter((i) => out[i].status === "unmatched");
  const facts = lines.map((ln) => ({ ...lineFacts(ln), cents: lineCents(ln) }));
  const link = (i, entries, source) => {
    entries.forEach((e) => used.add(entryKey(e)));
    out[i].links = entries.map((e) => ({ bookKind: e.kind, bookId: e.id, source }));
    out[i].status = "matched";
  };
  const review = (i, reason, entries) => {
    out[i].status = "review";
    out[i].reason = reason;
    out[i].candidates = entries.map((e) => candidateOf(lines[i], e));
  };
  // Hand an entry to a line only if no other open line also claims it.
  const claimCounts = (pools) => {
    const counts = new Map();
    pools.forEach((pool) => pool.forEach((e) => counts.set(entryKey(e), (counts.get(entryKey(e)) || 0) + 1)));
    return counts;
  };

  // a) UTR
  {
    const hits = new Map();
    open().forEach((i) => {
      const utrs = extractUtrs(lines[i].description, lines[i].reference);
      if (!utrs.length || !facts[i].cents) return;
      hits.set(
        i,
        ledger.filter(
          (e) => free(e) && e.delta > 0 === facts[i].wantDeposit && extractUtrs(e.refText).some((u) => utrs.includes(u))
        )
      );
    });
    const counts = claimCounts([...hits.values()]);
    hits.forEach((pool, i) => {
      if (!pool.length) return;
      if (pool.length > 1 || counts.get(entryKey(pool[0])) > 1) {
        review(i, "utr_ambiguous", pool);
      } else if (centsOf(pool[0]) !== facts[i].cents) {
        review(i, "utr_amount_mismatch", pool);
      } else {
        link(i, [pool[0]], "auto_utr");
        return;
      }
      pool.forEach((e) => held.add(entryKey(e)));
    });
  }

  // Same-day same-amount candidates of an open line (exact cents).
  const exactPool = (i) =>
    ledger.filter(
      (e) =>
        free(e) &&
        e.delta > 0 === facts[i].wantDeposit &&
        centsOf(e) === facts[i].cents &&
        isoDay(e.date) === facts[i].dateStr
    );

  // b) exact date + amount, one-to-one
  {
    const idxs = open().filter((i) => facts[i].cents);
    const pools = new Map(idxs.map((i) => [i, exactPool(i)]));
    const counts = claimCounts([...pools.values()]);
    pools.forEach((pool, i) => {
      if (pool.length === 1 && counts.get(entryKey(pool[0])) === 1) link(i, [pool[0]], "auto_exact");
    });
  }

  // c) group: one line == sum of 2..4 same-day entries, unique combination
  {
    const combos = new Map();
    open().forEach((i) => {
      if (!facts[i].cents || exactPool(i).length) return; // a single entry already fits: ambiguity, not a group
      const day = ledger.filter(
        (e) => free(e) && e.delta > 0 === facts[i].wantDeposit && isoDay(e.date) === facts[i].dateStr
      );
      const options = subsetsSumming(day, facts[i].cents, MAX_GROUP_ENTRIES, centsOf);
      if (options.length === 1) combos.set(i, options[0]);
    });
    const counts = claimCounts([...combos.values()]);
    combos.forEach((entries, i) => {
      if (entries.every((e) => counts.get(entryKey(e)) === 1)) link(i, entries, "auto_group");
    });
  }

  // split needed: several same-day lines whose total equals some entries'
  // total, but not as a plain one-to-one pairing -> the user splits an entry.
  {
    const byDay = new Map();
    open().forEach((i) => {
      if (!facts[i].cents) return;
      const k = `${facts[i].wantDeposit}|${facts[i].dateStr}`;
      byDay.set(k, [...(byDay.get(k) || []), i]);
    });
    byDay.forEach((idxs) => {
      if (idxs.length < 2) return;
      const { wantDeposit, dateStr } = facts[idxs[0]];
      const total = idxs.reduce((sum, i) => sum + facts[i].cents, 0);
      const day = ledger.filter((e) => free(e) && e.delta > 0 === wantDeposit && isoDay(e.date) === dateStr);
      const lineAmounts = idxs.map((i) => facts[i].cents).sort((a, b) => a - b).join();
      const options = subsetsSumming(day, total, MAX_GROUP_ENTRIES, centsOf)
        .concat(day.length === 1 && centsOf(day[0]) === total ? [day] : [])
        // identical amounts on both sides is plain ambiguity, not a split
        .filter((o) => o.map(centsOf).sort((a, b) => a - b).join() !== lineAmounts);
      if (!options.length) return;
      idxs.forEach((i) => review(i, "split_needed", options[0]));
    });
  }

  // d) near date suggestion / ambiguity -- never auto-linked
  {
    const pools = new Map();
    open().forEach((i) => {
      if (!facts[i].cents) return;
      const pool = rankCandidates(lines[i], ledger, { used: new Set([...used, ...held]), dayWindow: NEAR_DATE_DAYS })
        .filter(({ e }) => centsOf(e) === facts[i].cents)
        .map(({ e }) => e);
      if (pool.length) pools.set(i, pool);
    });
    const counts = claimCounts([...pools.values()]);
    pools.forEach((pool, i) => {
      review(i, "ambiguous", pool);
      if (pool.length === 1 && counts.get(entryKey(pool[0])) === 1) {
        out[i].reason = "near_date_suggestion";
        out[i].candidates[0].suggested = true;
      }
    });
  }

  return out;
}

// Explain a line's links. `linkedBooks` = [{ date, amount }] for each linked
// entry. dateDiff = bank date minus book date in days (signed value of the
// largest absolute gap); amountDiff = bank amount minus the SUM of the books.
//   result: MATCH | GROUP | DATE_DIFF | AMOUNT_DIFF | REVIEW | UNMATCHED
// Priority: no links -> UNMATCHED/REVIEW; amount gap -> AMOUNT_DIFF;
// 2+ links -> GROUP; date gap -> DATE_DIFF; otherwise MATCH.
export function describeLine(line, linkedBooks = []) {
  if (!linkedBooks.length) {
    return {
      dateDiff: 0,
      amountDiff: 0,
      bookAmounts: [],
      result: line?.status === "review" ? "REVIEW" : "UNMATCHED",
    };
  }
  const lineDay = isoDay(line.txn_date ?? line.date);
  const dateDiff = linkedBooks
    .map((b) => daysBetweenISO(isoDay(b.date), lineDay))
    .reduce((worst, d) => (Math.abs(d) > Math.abs(worst) ? d : worst), 0);
  const bookTotal = linkedBooks.reduce((sum, b) => sum + Math.round(Math.abs(amt(b.amount)) * 100), 0);
  const amountDiff = (lineCents(line) - bookTotal) / 100;
  let result = "MATCH";
  if (amountDiff !== 0) result = "AMOUNT_DIFF";
  else if (linkedBooks.length >= 2) result = "GROUP";
  else if (dateDiff !== 0) result = "DATE_DIFF";
  return {
    dateDiff,
    amountDiff,
    bookAmounts: linkedBooks.map((b) => moneyText(Math.abs(amt(b.amount)))),
    result,
  };
}

// Read side of the rollout: a line's links come from bank_match_links rows
// (`rows`: { line_id, book_kind, book_id, source }); a line with no row falls
// back to its legacy match_kind/match_id.
export function attachLinks(lines, rows = []) {
  const byLine = new Map();
  rows.forEach((r) => {
    byLine.set(r.line_id, [...(byLine.get(r.line_id) || []), { bookKind: r.book_kind, bookId: r.book_id, source: r.source }]);
  });
  return lines.map((l) => {
    const links = byLine.get(l.id);
    if (links) return { ...l, links };
    const legacy =
      l.match_kind && l.match_id != null && (l.status === "matched" || l.status === "classified")
        ? [{ bookKind: l.match_kind, bookId: l.match_id, source: "legacy" }]
        : [];
    return { ...l, links: legacy };
  });
}

// Dual-write patch for bank_statement_lines while the old columns are still
// read by the live page: the FIRST link mirrors into match_kind / match_id.
export function linksToLinePatch(links, { status = "matched", userId = null, now = new Date().toISOString() } = {}) {
  const first = links[0];
  return {
    status,
    match_kind: first ? first.bookKind : null,
    match_id: first ? first.bookId : null,
    matched_at: first ? now : null,
    ...(userId && first ? { matched_by: userId } : {}),
  };
}

// Postgres unique violation on bank_match_links(book_kind, book_id).
export function isLinkConflict(err) {
  return err?.code === "23505" || /duplicate key value/i.test(err?.message || "");
}
export const LINK_CONFLICT_MESSAGE = "This entry is already linked to another bank line.";
