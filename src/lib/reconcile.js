// Bank reconciliation helpers: book-balance math and auto-matching uploaded
// statement lines against the app's own transactions.

import { receiptNo, expenseCode } from "./format.js";
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
        bankReference: c.bank_reference || "",
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
        bankReference: e.bank_reference || "",
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
        bankReference: t.bank_reference || "",
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
        bankReference: t.bank_reference || "",
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
// Sentinel match_score that older versions stored for a pairing chosen only
// by statement order. Nothing writes it any more; isOrderAssumed() still lets
// the UI flag such historic matches for a manual check.
export const ORDER_ASSUMED_SCORE = 0.01;

const isoDay = (d) => String(d || "").slice(0, 10);
const entryKey = (e) => `${e.kind}:${e.id}`;

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

// True for a stored line that was paired only by statement order.
export const isOrderAssumed = (line) =>
  line?.status === "matched" && Number(line.match_score) === ORDER_ASSUMED_SCORE;

const OPEN_STATUSES = new Set(["review", "unmatched"]);
// Entries ("kind:id") already linked to a stored bank line. The database
// allows a book entry one bank line PER ACCOUNT (migration 36): collections and
// expenses belong to one account, so any link counts; a transfer moves money
// between two accounts and appears on both statements, so for a transfer only
// links from lines of `account` count. Without `account`, every link counts.
// A line's `links` (see attachLinks) win; lines without them fall back to the
// legacy match_kind/match_id pair.
const usedKeysOf = (lines, account = null) =>
  lines.flatMap((l) => {
    const keys = l.links?.length
      ? l.links.map((k) => ({ kind: k.bookKind, id: k.bookId }))
      : (l.status === "matched" || l.status === "classified") && l.match_kind && l.match_id != null
        ? [{ kind: l.match_kind, id: l.match_id }]
        : [];
    return keys
      .filter((k) => k.kind !== "transfer" || account === null || l.account === account)
      .map((k) => `${k.kind}:${k.id}`);
  });
const asAutoLine = (l) => ({
  date: l.txn_date,
  description: l.description,
  reference: l.reference,
  deposit: l.deposit,
  withdrawal: l.withdrawal,
});

// Dry-run for "Re-run auto-match" on a stored statement, using the same
// matchStatementLines passes as upload. Only lines that are currently
// 'review' or 'unmatched' are considered; matched / classified / ignored
// lines are never touched, and the entries they hold (every link) are
// excluded. Returns only the lines whose outcome would change:
//   [{ line, old_status, new_status, links, reason, candidates,
//      match_kind, match_id }]   (match_kind/id = first link, for display)
export function planRerun(statementLines, allLines, account, data) {
  const { open, results } = rematchOpen(statementLines, allLines, account, data);
  const changes = [];
  open.forEach((line, i) => {
    const r = results[i];
    if (r.status !== "matched" && r.status === line.status) return;
    changes.push({
      line,
      old_status: line.status,
      new_status: r.status,
      links: r.links,
      reason: r.reason,
      candidates: r.candidates,
      match_kind: r.links[0]?.bookKind || null,
      match_id: r.links[0]?.bookId ?? null,
    });
  });
  return changes;
}

// Why each open line is still open, for the review table: re-runs the
// matcher read-only and keeps the 'review' outcomes.
//   -> Map(lineId -> { reason, candidates })
export function reviewHints(statementLines, allLines, account, data) {
  const { open, results } = rematchOpen(statementLines, allLines, account, data);
  const hints = new Map();
  open.forEach((line, i) => {
    if (results[i].status === "review") hints.set(line.id, { reason: results[i].reason, candidates: results[i].candidates });
  });
  return hints;
}

function rematchOpen(statementLines, allLines, account, data) {
  const open = statementLines
    .filter((l) => OPEN_STATUSES.has(l.status))
    .sort((a, b) => (a.seq || 0) - (b.seq || 0));
  const results = matchStatementLines(
    open.map((l) => ({ ...asAutoLine(l), id: l.id, seq: l.seq })),
    account,
    data,
    { usedKeys: usedKeysOf(allLines, account) }
  );
  return { open, results };
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

// Bank names / UPI handles that never identify a payer.
const PAYER_NOISE = new Set([
  "hdfc", "icici", "sbi", "axis", "kotak", "canara", "federal", "yes", "idfc", "paytm", "ybl",
  "okaxis", "oksbi", "okhdfcbank", "okicici", "apl", "axl", "ibl", "upi",
]);

// Payer words of a bank line: handles (@okaxis) and digits stripped, bank
// names and network jargon dropped. Reuses extractIdentityCandidates, which
// already keeps UPI local parts ("sreeshmasreeshm@okaxis" -> sreeshmasreeshm).
const payerTokens = (description, reference) =>
  extractIdentityCandidates(
    `${description || ""} ${reference || ""}`.replace(/@[a-zA-Z][a-zA-Z0-9.]*/g, ""),
    ""
  ).filter((t) => !PAYER_NOISE.has(t));

// A record's own name tokens of 4+ letters (first name or any other token).
const nameTokensOf = (label) =>
  String(label || "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 4);

// True if a name token (4+ letters) is a substring of a payer word, or a
// payer word of 4+ letters is a substring of the name token.
const nameMatches = (payer, label) =>
  nameTokensOf(label).some((t) => payer.some((p) => p.includes(t) || (p.length >= 4 && t.includes(p))));

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
//   n) auto_name   2+ same-date same-amount candidates: the payer name in the
//                  description confirms exactly one (and nobody else's) entry
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

  // n) name tie-break. Only for lines that still have 2+ same-date,
  // same-amount candidates. Links only when exactly one candidate's name is
  // in the payer text and no other open line also name-matches that entry.
  {
    const payers = new Map(open().map((i) => [i, payerTokens(lines[i].description, lines[i].reference)]));
    const pools = new Map();
    open().forEach((i) => {
      if (facts[i].cents && exactPool(i).length >= 2) pools.set(i, exactPool(i));
    });
    // How many open lines name-match each entry (across every open line).
    const nameClaims = new Map();
    open().forEach((i) => {
      if (!facts[i].cents) return;
      exactPool(i).forEach((e) => {
        if (nameMatches(payers.get(i), e.label)) nameClaims.set(entryKey(e), (nameClaims.get(entryKey(e)) || 0) + 1);
      });
    });
    const verdicts = [];
    pools.forEach((pool, i) => {
      const named = pool.filter((e) => nameMatches(payers.get(i), e.label));
      if (named.length === 1 && nameClaims.get(entryKey(named[0])) === 1) {
        verdicts.push({ i, entry: named[0] });
      } else {
        verdicts.push({ i, reason: named.length === 0 ? "name_unknown" : "name_ambiguous" });
      }
    });
    verdicts.forEach(({ i, entry }) => {
      if (entry) {
        link(i, [entry], "auto_name");
        out[i].reason = "name_confirmed";
      }
    });
    verdicts.forEach(({ i, reason }) => {
      if (reason) review(i, reason, exactPool(i));
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
// Priority: no links -> UNMATCHED/REVIEW; AMOUNT_DIFF > DATE_DIFF > GROUP >
// MATCH (a date gap on a group is DATE_DIFF; bookAmounts is always returned).
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
  else if (dateDiff !== 0) result = "DATE_DIFF";
  else if (linkedBooks.length >= 2) result = "GROUP";
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

// ---------------------------------------------------------------------------
// Review-table view helpers (pure). Single-tenant: one academy's books.
// ---------------------------------------------------------------------------

export const transferCode = (id) => `TRF-${String(id).padStart(5, "0")}`;
export const BOOK_KIND_TAG = { collection: "Fee", expense: "Expense", transfer: "Transfer" };

// Plain-words reasons for review rows.
export const REASON_LABEL = {
  split_needed: "Split needed",
  name_unknown: "Name unknown",
  name_ambiguous: "Name ambiguous",
  utr_amount_mismatch: "UTR amount mismatch",
  utr_ambiguous: "UTR ambiguous",
  near_date_suggestion: "Near-date suggestion",
  ambiguous: "Ambiguous",
  name_confirmed: "Name-confirmed",
};

// "kind:id" -> { kind, id, date, amount (positive), label (human Book ID) }.
// Fee collections show their receipt no. (OKSY/000236), expenses their code
// (EXP-00273), transfers TRF-00012.
export function ledgerByKeyOf({ collections = [], expenses = [], transfers = [] } = {}) {
  const map = new Map();
  collections.forEach((c) =>
    map.set(`collection:${c.id}`, { kind: "collection", id: c.id, date: c.date, amount: amt(c.amount), label: receiptNo(c.id), bankReference: c.bank_reference ?? "" })
  );
  expenses.forEach((e) =>
    map.set(`expense:${e.id}`, { kind: "expense", id: e.id, date: e.date, amount: amt(e.amount), label: expenseCode(e.id), bankReference: e.bank_reference ?? "" })
  );
  transfers.forEach((t) =>
    map.set(`transfer:${t.id}`, { kind: "transfer", id: t.id, date: t.date, amount: amt(t.amount), label: transferCode(t.id), bankReference: t.bank_reference ?? "" })
  );
  return map;
}

// One row per bank line (a group shows all its entries in that one row).
// `lines` carry `.links` (attachLinks); `hints` is reviewHints() output.
export function buildReconRows(lines, ledgerByKey = new Map(), hints = new Map()) {
  const entryOf = (kind, id) => ledgerByKey.get(`${kind}:${id}`);
  return lines.map((ln) => {
    const direction = amt(ln.deposit) > 0 ? "CR" : "DR";
    const bankAmount = direction === "CR" ? amt(ln.deposit) : amt(ln.withdrawal);
    const links = (ln.links || []).map((k) => {
      const e = entryOf(k.bookKind, k.bookId);
      return {
        kind: k.bookKind,
        bookId: k.bookId,
        label: e ? e.label : `${BOOK_KIND_TAG[k.bookKind] || k.bookKind} #${k.bookId}`,
        date: e ? isoDay(e.date) : null,
        amount: e ? e.amount : 0,
        source: k.source,
      };
    });
    const d = describeLine(ln, links.map((k) => ({ date: k.date, amount: k.amount })));
    const hint = hints.get(ln.id);
    const bankDate = isoDay(ln.txn_date ?? ln.date);
    const suggested = hint?.candidates?.find((c) => c.suggested);
    const suggestionEntry = suggested && entryOf(suggested.bookKind, suggested.bookId);
    return {
      lineId: ln.id,
      seq: ln.seq,
      bankDate,
      description: ln.description || "",
      direction,
      bankAmount,
      links,
      bookDates: links.map((k) => k.date || "—"),
      bookAmounts: d.bookAmounts,
      dateDiff: d.dateDiff,
      amountDiff: d.amountDiff,
      result: ln.status === "ignored" ? "IGNORED" : d.result,
      reason: links.length ? null : (hint?.reason ?? null),
      status: ln.status,
      suggestion: suggested
        ? {
            kind: suggested.bookKind,
            bookId: suggested.bookId,
            label: suggestionEntry ? suggestionEntry.label : `${BOOK_KIND_TAG[suggested.bookKind]} #${suggested.bookId}`,
            date: suggested.date,
            amount: suggested.amount,
            dateDiff: suggested.dateDiff,
          }
        : null,
      line: ln,
    };
  });
}

export const RESULT_LABEL = {
  MATCH: "Match",
  GROUP: "Group",
  DATE_DIFF: "Date diff",
  AMOUNT_DIFF: "Amount diff",
  REVIEW: "Review",
  UNMATCHED: "Unmatched",
  IGNORED: "Ignored",
};

export const RECON_FILTERS = [
  { key: "all", label: "All" },
  { key: "match", label: "Match" },
  { key: "group", label: "Group" },
  { key: "date_diff", label: "Date diff" },
  { key: "amount_diff", label: "Amount diff" },
  { key: "review", label: "Review" },
  { key: "unmatched", label: "Unmatched" },
  { key: "ignored", label: "Ignored" },
];
const FILTER_RESULT = {
  match: "MATCH",
  group: "GROUP",
  date_diff: "DATE_DIFF",
  amount_diff: "AMOUNT_DIFF",
  review: "REVIEW",
  unmatched: "UNMATCHED",
  ignored: "IGNORED",
};

export const reconRowMatchesFilter = (row, key) => key === "all" || row.result === FILTER_RESULT[key];

// { all, match, group, date_diff, amount_diff, review, unmatched, ignored }
export function reconFilterCounts(rows) {
  const counts = Object.fromEntries(RECON_FILTERS.map((f) => [f.key, 0]));
  rows.forEach((r) => {
    counts.all += 1;
    const key = Object.keys(FILTER_RESULT).find((k) => FILTER_RESULT[k] === r.result);
    if (key) counts[key] += 1;
  });
  return counts;
}

// ---------------------------------------------------------------------------
// Manual link popup + "Book only" list (pure helpers). Single-tenant.
// ---------------------------------------------------------------------------

const DEFAULT_LINK_WINDOW_DAYS = 7;
const SUGGEST_WINDOW_DAYS = 3;

const bookItemOf = (e, labels) => ({
  key: entryKey(e),
  kind: e.kind,
  id: e.id,
  label: labels.get(entryKey(e))?.label ?? `${BOOK_KIND_TAG[e.kind]} #${e.id}`,
  who: e.label || "",
  date: isoDay(e.date),
  amount: centsOf(e) / 100,
  direction: e.delta > 0 ? "CR" : "DR",
  bankReference: e.bankReference || "",
});

// Book entries a bank line could be linked to by hand: same account, the
// line's direction (CR: collections + transfers in; DR: expenses + transfers
// out), and NOT already linked to any bank line (`usedKeys`, "kind:id").
// Best first: UTR hits and same-amount entries within 3 days (rankCandidates
// order) carry `suggested: true`; the rest follow by closeness in date, then
// in amount. Without `showAllDates`, non-suggested entries further than
// `windowDays` from the bank date are left out.
export function linkCandidates(line, account, data, usedKeys = [], { showAllDates = false, windowDays = DEFAULT_LINK_WINDOW_DAYS } = {}) {
  const ledger = accountLedger(account, data);
  const labels = ledgerByKeyOf(data);
  const used = new Set(usedKeys);
  const { wantDeposit, dateStr } = lineFacts(line);
  const bankCents = lineCents(line);
  const utrs = extractUtrs(line.description, line.reference);

  const ranked = rankCandidates(line, ledger, { used, dayWindow: SUGGEST_WINDOW_DAYS })
    .filter(({ e }) => centsOf(e) === bankCents)
    .map(({ e }) => entryKey(e));
  const rank = new Map(ranked.map((k, i) => [k, i]));

  return ledger
    .filter((e) => !used.has(entryKey(e)) && e.delta > 0 === wantDeposit)
    .map((e) => {
      const utr = utrs.length > 0 && extractUtrs(e.refText).some((u) => utrs.includes(u));
      return {
        ...bookItemOf(e, labels),
        dateDiff: daysBetweenISO(isoDay(e.date), dateStr),
        utr,
        suggested: utr || rank.has(entryKey(e)),
        _rank: rank.has(entryKey(e)) ? rank.get(entryKey(e)) : Infinity,
      };
    })
    .filter((c) => showAllDates || c.suggested || Math.abs(c.dateDiff) <= windowDays)
    .sort(
      (a, b) =>
        Number(b.suggested) - Number(a.suggested) ||
        Number(b.utr) - Number(a.utr) ||
        a._rank - b._rank ||
        Math.abs(a.dateDiff) - Math.abs(b.dateDiff) ||
        Math.abs(a.amount * 100 - bankCents) - Math.abs(b.amount * 100 - bankCents) ||
        Number(a.id) - Number(b.id)
    )
    .map(({ _rank, ...c }) => c);
}

// Search box for the link popup: Book ID, name / category, bank reference,
// date or amount ("2000" and "2,000.00" both work).
export function filterLinkCandidates(candidates, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return candidates;
  const bare = q.replace(/,/g, "");
  return candidates.filter((c) => {
    const hay = [c.label, c.who, c.bankReference, c.date, String(c.amount), moneyText(c.amount)].join(" ").toLowerCase();
    return hay.includes(q) || hay.replace(/,/g, "").includes(bare);
  });
}

// Live footer of the link popup. dateDiff = bank date minus book date (days),
// the signed value of the largest gap; amountDiff = bank minus selected total.
export function summarizeSelection(line, entries) {
  const bankCents = lineCents(line);
  const totalCents = entries.reduce((sum, e) => sum + Math.round(Math.abs(amt(e.amount)) * 100), 0);
  const lineDay = isoDay(line.txn_date ?? line.date);
  const dateDiff = entries
    .map((e) => daysBetweenISO(isoDay(e.date), lineDay))
    .reduce((worst, d) => (Math.abs(d) > Math.abs(worst) ? d : worst), 0);
  const amountDiff = (bankCents - totalCents) / 100;
  return {
    count: entries.length,
    total: totalCents / 100,
    bankAmount: bankCents / 100,
    amountDiff,
    dateDiff,
    needsConfirm: entries.length > 0 && (amountDiff !== 0 || dateDiff !== 0),
  };
}

// Payload for one all-or-nothing save (save_bank_match_links RPC).
export function buildManualLinkPayload(lineId, entries) {
  if (!entries.length) throw new Error("Select at least one entry to link.");
  return {
    lineId,
    links: entries.map((e) => ({ bookKind: e.kind, bookId: e.id, source: "manual" })),
    source: "manual",
    status: "matched",
  };
}

// Entries of the statement's account dated inside its period that no bank
// line of that account links to: in the books, not in the statement.
export function bookOnlyEntries(statement, allLines, data) {
  const used = new Set(usedKeysOf(allLines, statement.account));
  const labels = ledgerByKeyOf(data);
  const from = statement.period_start ? isoDay(statement.period_start) : null;
  const to = statement.period_end ? isoDay(statement.period_end) : null;
  return accountLedger(statement.account, data)
    .filter((e) => {
      const d = isoDay(e.date);
      return !used.has(entryKey(e)) && (!from || d >= from) && (!to || d <= to);
    })
    .map((e) => bookItemOf(e, labels))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || a.kind.localeCompare(b.kind) || Number(a.id) - Number(b.id));
}

// Entries ("kind:id") already linked for `account` (see usedKeysOf).
export const linkedKeys = (allLines, account) => usedKeysOf(allLines, account);

// Transfers linked on more than one account. Their date cannot be synced (the
// two bank lines may carry different dates), see migration 36.
export function multiAccountTransferKeys(allLines) {
  const accounts = new Map();
  allLines.forEach((l) =>
    (l.links || []).forEach((k) => {
      if (k.bookKind !== "transfer") return;
      const key = `transfer:${k.bookId}`;
      accounts.set(key, new Set([...(accounts.get(key) || []), l.account]));
    })
  );
  return new Set([...accounts].filter(([, set]) => set.size > 1).map(([key]) => key));
}

// ---------------------------------------------------------------------------
// Sync to books (bank reference + date correction). Pure helpers; the writes
// happen in the sync_bank_entries RPC (migration 35). Single-tenant.
// ---------------------------------------------------------------------------

// Full bank line text as the Classify flow stamps it onto a record's
// bank_reference: description plus any separate reference/UTR column, 500 max.
export const bankReferenceText = (line) =>
  [line.description, line.reference].filter(Boolean).join(" ").trim().slice(0, 500);

const monthOf = (iso) => String(iso || "").slice(0, 7);

// Why a row cannot be synced (only MATCH / GROUP / DATE_DIFF with a zero
// amount diff is eligible).
const SKIP_REASON = {
  AMOUNT_DIFF: "amount diff",
  REVIEW: "review",
  UNMATCHED: "unmatched",
  IGNORED: "ignored",
};

// rows = buildReconRows() output; ledger = ledgerByKeyOf(). For every entry
// linked to an eligible line:
//   reference: { status: 'fill' | 'conflict' | 'same', current, next }
//   date: null | { from, to, monthChanges, blocked }  (only when the book date
//         differs; `blocked` = a transfer linked on two accounts, see
//         multiAccountTransferKeys -- its date is corrected by hand)
export function buildSyncPreview(rows, ledger, { multiAccountKeys = new Set() } = {}) {
  const items = [];
  const skippedByReason = {};
  let eligible = 0;
  let skipped = 0;

  rows.forEach((r) => {
    const ok =
      r.links.length > 0 &&
      r.amountDiff === 0 &&
      (r.result === "MATCH" || r.result === "GROUP" || r.result === "DATE_DIFF");
    if (!ok) {
      skipped += 1;
      const why = SKIP_REASON[r.result] || "not linked";
      skippedByReason[why] = (skippedByReason[why] || 0) + 1;
      return;
    }
    eligible += 1;
    const next = bankReferenceText(r.line);
    r.links.forEach((k) => {
      const entry = ledger.get(`${k.kind}:${k.bookId}`);
      if (!entry) return;
      const current = String(entry.bankReference ?? "");
      const status = !next ? "same" : current === "" ? "fill" : current === next ? "same" : "conflict";
      const entryDate = isoDay(entry.date);
      items.push({
        key: `${k.kind}:${k.bookId}`,
        kind: k.kind,
        bookId: k.bookId,
        label: k.label,
        lineId: r.lineId,
        bankDate: r.bankDate,
        reference: { status, current, next },
        date:
          entryDate !== r.bankDate
            ? {
                from: entryDate,
                to: r.bankDate,
                monthChanges: monthOf(entryDate) !== monthOf(r.bankDate),
                blocked: multiAccountKeys.has(`${k.kind}:${k.bookId}`),
              }
            : null,
      });
    });
  });

  const count = (fn) => items.filter(fn).length;
  return {
    items,
    skippedByReason,
    totals: {
      eligible,
      skipped,
      fills: count((i) => i.reference.status === "fill"),
      conflicts: count((i) => i.reference.status === "conflict"),
      dateChanges: count((i) => i.date && !i.date.blocked),
      monthChanges: count((i) => i.date?.monthChanges && !i.date.blocked),
      blockedDates: count((i) => i.date?.blocked),
    },
  };
}

// Default ticks: reference fills on; conflicts, date changes and month
// changes all off.
export const defaultSyncSelection = (preview) => ({
  refKeys: new Set(preview.items.filter((i) => i.reference.status === "fill").map((i) => i.key)),
  dateKeys: new Set(),
});

// Master "Book date -> Bank date" checkbox: ticks every date change EXCEPT
// month changes (those need their own tick); off clears all date ticks.
export function setMasterDate(preview, selection, on) {
  const dateKeys = new Set(selection.dateKeys);
  preview.items.forEach((i) => {
    if (!i.date) return;
    if (!on) dateKeys.delete(i.key);
    else if (!i.date.monthChanges && !i.date.blocked) dateKeys.add(i.key);
  });
  return { ...selection, dateKeys };
}

// Select all / none. "All" never ticks reference conflicts or month-change
// dates -- those always need their own tick -- nor blocked transfer dates.
export function selectAllSync(preview, on) {
  return on
    ? {
        refKeys: new Set(preview.items.filter((i) => i.reference.status === "fill").map((i) => i.key)),
        dateKeys: new Set(
          preview.items.filter((i) => i.date && !i.date.monthChanges && !i.date.blocked).map((i) => i.key)
        ),
      }
    : { refKeys: new Set(), dateKeys: new Set() };
}

// Payload for sync_bank_entries. Every item names the bank line it was
// previewed against (line_id). A conflict is included only when ticked (and
// then carries overwrite: true); expected_old is the value seen in the preview.
export function buildSyncPayload(preview, selection) {
  const payload = [];
  preview.items.forEach((i) => {
    const ref = i.reference;
    if (selection.refKeys.has(i.key) && (ref.status === "fill" || ref.status === "conflict")) {
      payload.push({
        line_id: i.lineId,
        book_kind: i.kind,
        book_id: i.bookId,
        field: "bank_reference",
        new_value: ref.next,
        expected_old: ref.current,
        overwrite: ref.status === "conflict",
      });
    }
    if (selection.dateKeys.has(i.key) && i.date && !i.date.blocked) {
      payload.push({
        line_id: i.lineId,
        book_kind: i.kind,
        book_id: i.bookId,
        field: "date",
        new_value: i.date.to,
        expected_old: i.date.from,
        overwrite: false,
      });
    }
  });
  return payload;
}

// Recent sync runs, grouped from bank_sync_history rows.
export function groupSyncRuns(historyRows) {
  const runs = new Map();
  historyRows.forEach((h) => {
    const run = runs.get(h.run_id) || { runId: h.run_id, syncedAt: h.synced_at, syncedBy: h.synced_by, changes: 0, undone: 0 };
    run.changes += 1;
    if (h.undone_at) run.undone += 1;
    if (h.synced_at < run.syncedAt) run.syncedAt = h.synced_at;
    runs.set(h.run_id, run);
  });
  return [...runs.values()]
    .map((r) => ({ ...r, isUndone: r.undone === r.changes }))
    .sort((a, b) => (a.syncedAt < b.syncedAt ? 1 : -1));
}
