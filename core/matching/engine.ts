import { differenceInDays } from "date-fns";
import { classifyMatch, ClassificationResult } from "./classifier";
import { isStripePayoutTransaction, hasReferenceConflict, getConfidenceBand, isDigitTransposition } from "./matchingHelpers";
import { matchesProcessorFee, matchesProcessorFeeForCombo } from "./feeFormulas";


export interface BankTransaction {
  id: string;
  amount: number; // in paise
  date: Date;
  description: string;
  referenceId: string;
  direction?: "inflow" | "outflow" | "credit" | "debit";
  currency?: string;
  baseCurrency?: string;
  convertedAmountMinor?: number;
  fxStatus?: string;
  counterparty?: string;
  matchingSignals?: any;
}

export interface LedgerEntry {
  id: string;
  amount: number; // in paise
  date: Date;
  memo: string;
  invoiceRef: string;
  direction?: "inflow" | "outflow" | "credit" | "debit";
  currency?: string;
  baseCurrency?: string;
  convertedAmountMinor?: number;
  fxStatus?: string;
  counterparty?: string;
  matchingSignals?: any;
}

export type MatchType =
  | "exact"
  | "utr_exact"
  | "tolerance"
  | "fuzzy"
  | "fee_adjustment"
  | "one_to_many"
  | "many_to_one"
  | "bulk"
  | "partial_payment"
  | "fx_difference"
  | "unmatched_ledger"
  | "none";

export interface CandidateReason {
  reason: string;
  points: number;
}

export interface MatchResult {
  bankTransactionIds: string[];
  ledgerEntryIds: string[];
  confidenceScore: number;  // 0.0 to 1.0
  score: number;            // raw score
  confidenceBand: "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW" | "NONE";
  matchType: MatchType;
  reasons?: CandidateReason[];
  scoringBreakdown: {
    amountScore: number;
    dateScore: number;
    textScore: number;
  };
  classification: ClassificationResult;
}

// ── Scoring and Helper Functions ──────────────────────────────────────────────

function normalizeReference(ref?: string): string {
  if (!ref) return "";
  return ref.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeName(name?: string): string {
  if (!name) return "";
  return name
    .toUpperCase()
    .replace(/\b(CORPORATION|CORP|PVT|PRIVATE|LTD|LIMITED|SOLUTIONS|SOLUTION)\b/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

function referenceMatches(bankRef?: string, bookRef?: string): boolean {
  const a = normalizeReference(bankRef);
  const b = normalizeReference(bookRef);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function nameMatches(bank?: string, book?: string): boolean {
  const a = normalizeName(bank);
  const b = normalizeName(book);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function directionMatches(a: BankTransaction | LedgerEntry, b: BankTransaction | LedgerEntry): boolean {
  if (!a.direction || !b.direction) return true; // default match if direction is not provided
  
  // normalize directions: inflow/credit vs outflow/debit
  const getDir = (d: string) => {
    const norm = d.toLowerCase();
    if (norm === "credit" || norm === "inflow") return "in";
    return "out";
  };
  return getDir(a.direction) === getDir(b.direction);
}

function getCounterpartySimilarity(a?: string, b?: string): number {
  if (!a || !b) return 0;
  const normalize = (s: string) =>
    s.toLowerCase().split(/\W+/).filter((token) => token.length > 2);

  const setA = new Set(normalize(a));
  const setB = new Set(normalize(b));

  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);

  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

function getCombinations<T>(arr: T[], minSize: number, maxSize: number): T[][] {
  const result: T[][] = [];
  const f = (start: number, combo: T[]) => {
    if (combo.length >= minSize && combo.length <= maxSize) {
      result.push([...combo]);
    }
    if (combo.length >= maxSize) return;
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      f(i + 1, combo);
      combo.pop();
    }
  };
  f(0, []);
  return result;
}


function getEffectiveAmountMinor(txn: BankTransaction | LedgerEntry): number {
  return txn.convertedAmountMinor !== undefined && txn.convertedAmountMinor !== null
    ? txn.convertedAmountMinor
    : txn.amount;
}

// ── Candidate Generation (Phase 5 implementation) ───────────────────────────────────

interface CandidateResult {
  candidate: LedgerEntry;
  score: number;
  confidenceBand: "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW";
  reasons: CandidateReason[];
}

function generateCandidates(
  bankTxn: BankTransaction,
  bookTxns: LedgerEntry[],
  options?: { skipAmountGate?: boolean }
): CandidateResult[] {
  const results: CandidateResult[] = [];
  const TOLERANCE_BPS = 2000n; // 20%
  const MIN_AMOUNT_TOLERANCE = 500n; // 500 paise

  for (const bookTxn of bookTxns) {
    if (!directionMatches(bankTxn, bookTxn)) continue;

    // Currency check
    const currenciesDiffer = bankTxn.currency && bookTxn.currency && bankTxn.currency !== bookTxn.currency;
    if (currenciesDiffer && bankTxn.fxStatus === "MISSING_RATE") continue;

    const reportCurrencyBank = bankTxn.baseCurrency || bankTxn.currency;
    const reportCurrencyBook = bookTxn.baseCurrency || bookTxn.currency;
    const currencyMatch =
      (!bankTxn.currency || !bookTxn.currency) ||
      (bankTxn.currency === bookTxn.currency) ||
      (reportCurrencyBank && reportCurrencyBook && reportCurrencyBank === reportCurrencyBook);

    // FX bypass: when currencies differ (e.g. INR bank vs USD ledger) and the Gemini
    // enrichment hasn't run (no convertedAmountMinor), compute an implied rate from the
    // raw minor-unit amounts and accept the candidate if the rate is within realistic
    // INR/foreign-currency bounds (30–200 covers USD, EUR, GBP, SGD etc.).
    // The amount gate below is then skipped for these FX candidates because the amounts
    // are in incomparable units — counterparty and date signals do the real validation.
    let isFxCandidate = false;
    if (!currencyMatch && currenciesDiffer) {
      const bankRaw = BigInt(bankTxn.amount);
      const bookRaw = BigInt(bookTxn.amount);
      const inrRaw  = bankTxn.currency === "INR" ? bankRaw : bookRaw;
      const fxRaw   = bankTxn.currency === "INR" ? bookRaw : bankRaw;
      if (fxRaw === 0n) continue;
      const impliedRate = Number(inrRaw) / Number(fxRaw);
      if (impliedRate < 30 || impliedRate > 200) continue;
      isFxCandidate = true; // pass through; skip the amount gate
    } else if (!currencyMatch) {
      continue; // non-INR cross-currency without a valid rate — reject
    }

    const bankAmtMinor = BigInt(getEffectiveAmountMinor(bankTxn));
    const bookAmtMinor = BigInt(getEffectiveAmountMinor(bookTxn));

    const diff = bankAmtMinor > bookAmtMinor ? bankAmtMinor - bookAmtMinor : bookAmtMinor - bankAmtMinor;
    const comparisonAmount = bankAmtMinor > bookAmtMinor ? bankAmtMinor : bookAmtMinor;
    
    const calculatedTolerance = (comparisonAmount * TOLERANCE_BPS) / 10000n;
    const allowedTolerance = calculatedTolerance > MIN_AMOUNT_TOLERANCE ? calculatedTolerance : MIN_AMOUNT_TOLERANCE;

    // Skip amount gate for FX candidates (amounts are in different currency units)
    if (!isFxCandidate && !options?.skipAmountGate && diff > allowedTolerance) continue;


    const dayDiff = Math.abs(differenceInDays(bankTxn.date, bookTxn.date));
    let maxDateDifference = 7;
    const channel = bankTxn.matchingSignals?.channel || "";
    if (channel === "STRIPE" || (bankTxn.description || "").toLowerCase().includes("stripe")) maxDateDifference = 7;
    else if (channel === "NEFT" || channel === "RTGS") maxDateDifference = 4;
    else if (channel === "UPI") maxDateDifference = 2;
    else if (channel === "WIRE") maxDateDifference = 15;

    if (Math.floor(dayDiff) > maxDateDifference) continue;

    // Scoring
    let scoreVal = 0;
    const reasons: CandidateReason[] = [];

    if (diff === 0n) {
      scoreVal += 50;
      reasons.push({ reason: "amount_match", points: 50 });
    } else {
      const scorePoints = Number(50n - (diff * 50n) / allowedTolerance);
      const finalPoints = Math.max(0, Math.round(scorePoints));
      scoreVal += finalPoints;
      reasons.push({ reason: "amount_near_match", points: finalPoints });
    }

    const datePoints = Math.max(0, Math.round(30 - dayDiff * 3));
    if (datePoints > 0) {
      scoreVal += datePoints;
      reasons.push({ reason: "date_match", points: datePoints });
    }

    const bankSignals = bankTxn.matchingSignals || {};
    const bookSignals = bookTxn.matchingSignals || {};

    let signalScore = 0;
    let signalReason = "";

    if (bankSignals.utr && bookSignals.utr && bankSignals.utr === bookSignals.utr) {
      signalScore = 100;
      signalReason = "utr_match";
    } else if (bankSignals.relatedTransactionId && bookSignals.relatedTransactionId && bankSignals.relatedTransactionId === bookSignals.relatedTransactionId) {
      signalScore = 80;
      signalReason = "related_id_match";
    } else if (bankSignals.invoiceNumber && bookSignals.invoiceNumber && bankSignals.invoiceNumber === bookSignals.invoiceNumber) {
      signalScore = 80;
      signalReason = "invoice_match";
    } else if (bankSignals.voucherNumber && bookSignals.voucherNumber && bankSignals.voucherNumber === bookSignals.voucherNumber) {
      signalScore = 80;
      signalReason = "voucher_match";
    }

    if (signalReason) {
      scoreVal += signalScore;
      reasons.push({ reason: signalReason, points: signalScore });
    }

    const bankRef = (bankTxn.referenceId || "").trim().toLowerCase();
    const bookRef = (bookTxn.invoiceRef || "").trim().toLowerCase();

    if (bankRef && bookRef) {
      if (bankRef.includes(bookRef) || bookRef.includes(bankRef)) {
        scoreVal += 30;
        reasons.push({ reason: "reference_match", points: 30 });
      } else {
        const bankSignals = bankTxn.matchingSignals || {};
        const bookSignals = bookTxn.matchingSignals || {};
        const bankInv = bankSignals.invoiceNumber || "";
        const bookInv = bookSignals.invoiceNumber || "";

        if (isDigitTransposition(bankRef, bookRef) || (bankInv && bookInv && isDigitTransposition(bankInv, bookInv))) {
          scoreVal += 15;
          reasons.push({ reason: "reference_typo_transposition", points: 15 });
        } else {
          scoreVal -= 20;
          reasons.push({ reason: "reference_mismatch_penalty", points: -20 });
        }
      }
    }

    if (nameMatches(bankTxn.counterparty, bookTxn.counterparty)) {
      scoreVal += 20;
      reasons.push({ reason: "counterparty_match", points: 20 });
    }

    const bankSource = bankTxn.description.toLowerCase().includes("stripe") ? "stripe" : bankSignals.merchantName;
    const bookSource = bookTxn.memo.toLowerCase().includes("stripe") ? "stripe" : undefined;
    if (bankSource && bookSource && bankSource.toLowerCase() === bookSource.toLowerCase()) {
      scoreVal += 15;
      reasons.push({ reason: "source_alignment", points: 15 });
    }

    // Reference conflict penalty — must be applied here (before results.push / sort)
    // so the penalised score participates in candidate ranking.
    const refAlreadyMatched = reasons.some(r => r.reason === "reference_match");
    const refConflict = hasReferenceConflict(
      bankTxn.referenceId,
      bookTxn.invoiceRef,
      refAlreadyMatched
    );
    const signalMatch = reasons.some(r =>
      r.reason === "utr_match" ||
      r.reason === "invoice_match" ||
      r.reason === "voucher_match"
    );
    if (refConflict && !signalMatch) {
      // Both sides carry non-empty refs that disagree and no signal disambiguates.
      // Apply a heavy penalty so the candidate falls below the Pass 1 threshold
      // and drops to later passes. Do NOT hard-reject — preserves recall.
      scoreVal -= 50;
      reasons.push({ reason: "reference_conflict_penalty", points: -50 });
    }

    let confidenceBand: "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW" = "LOW";
    if (scoreVal >= 120) confidenceBand = "VERY_HIGH";
    else if (scoreVal >= 80) confidenceBand = "HIGH";
    else if (scoreVal >= 50) confidenceBand = "MEDIUM";

    results.push({
      candidate: bookTxn,
      score: scoreVal,
      confidenceBand,
      reasons
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 50);
}

// ── State Representation ───────────────────────────────────────────────────────

interface TransactionState<T> {
  id: string;
  txn: T;
  status: "UNMATCHED" | "PARTIALLY_MATCHED" | "MATCHED";
  matchedAmountMinor: number;
  remainingAmountMinor: number;
}


// ── Main Matching Engine ────────────────────────────────────────────────────────
//
// Pipeline pass order:
//   Pass 0 — UTR Deterministic Match   (utr_exact)
//   Pass 1 — Exact Match               (exact)
//   Pass 2 — Subset Match 2A+2B        (one_to_many / many_to_one)
//   Pass 3 — Processor Fee Match       (fee_adjustment, incl. TDS)
//   Pass 4 — Partial / Overpayment     (partial_payment)
//   Pass 5 — Tolerance / FX            (tolerance / fx_difference)
//   Pass 6 — Unmatched Bank + Ledger   (none / unmatched_ledger)
//
// Subset (Pass 2) runs before Fee (Pass 3) so that deterministic sum-based
// combinations are evaluated before approximate fee-ratio approximations.
// This prevents a fee match from consuming a transaction that belongs to a
// more accurate multi-ledger reconciliation.

export function matchTransactions(
  banks: BankTransaction[],
  ledgers: LedgerEntry[]
): MatchResult[] {
  const results: (Omit<MatchResult, "classification"> & { classification?: ClassificationResult })[] = [];

  // State initialization
  const bankStates = new Map<string, TransactionState<BankTransaction>>();
  for (const b of banks) {
    const amt = getEffectiveAmountMinor(b);
    bankStates.set(b.id, {
      id: b.id,
      txn: b,
      status: "UNMATCHED",
      matchedAmountMinor: 0,
      remainingAmountMinor: amt
    });
  }

  const bookStates = new Map<string, TransactionState<LedgerEntry>>();
  for (const b of ledgers) {
    const amt = getEffectiveAmountMinor(b);
    bookStates.set(b.id, {
      id: b.id,
      txn: b,
      status: "UNMATCHED",
      matchedAmountMinor: 0,
      remainingAmountMinor: amt
    });
  }

  const getAvailableBooks = () =>
    Array.from(bookStates.values())
      .filter((state) => state.status !== "MATCHED")
      .map((state) => state.txn);

  // ==========================================
  // PASS 0: UTR DETERMINISTIC MATCH
  // ==========================================
  // UTR (Unique Transaction Reference) is mandated by RBI as a universally
  // unique identifier across NEFT and RTGS transactions in India.
  // A UTR match is treated as ground-truth regardless of settlement date lag.
  //
  // Amount tolerance: max(500 paise, 0.1% of the larger amount).
  // Purpose: guard against corrupt data only — the UTR itself is authoritative.
  // No date gate is applied.
  for (const bankState of bankStates.values()) {
    if (bankState.status === "MATCHED") continue;

    const bankTxn = bankState.txn;
    const bankUtr: string | undefined = bankTxn.matchingSignals?.utr;
    if (!bankUtr) continue; // no UTR on this bank transaction

    const bankEffective = getEffectiveAmountMinor(bankTxn);

    let utrBookState: TransactionState<LedgerEntry> | null = null;

    for (const bookState of bookStates.values()) {
      if (bookState.status === "MATCHED") continue;
      const bookUtr: string | undefined = bookState.txn.matchingSignals?.utr;
      if (!bookUtr || bookUtr !== bankUtr) continue;
      if (!directionMatches(bankTxn, bookState.txn)) continue;

      // Amount guard: catches corrupt UTR data (collision with very different amounts).
      // Not a business-logic gate — the UTR is the authoritative identifier.
      const bookEffective = getEffectiveAmountMinor(bookState.txn);
      const amtDiff = Math.abs(bankEffective - bookEffective);
      const amtTolerance = Math.max(500, Math.round(Math.max(bankEffective, bookEffective) * 0.001));
      if (amtDiff > amtTolerance) continue;

      utrBookState = bookState;
      break; // UTR is unique; first match is the only valid match
    }

    if (utrBookState) {
      bankState.status = "MATCHED";
      bankState.matchedAmountMinor = bankState.remainingAmountMinor;
      bankState.remainingAmountMinor = 0;

      utrBookState.status = "MATCHED";
      utrBookState.matchedAmountMinor = utrBookState.remainingAmountMinor;
      utrBookState.remainingAmountMinor = 0;

      // Score of 200 guarantees VERY_HIGH band (threshold: 150).
      const utrScore = 200;
      results.push({
        bankTransactionIds: [bankTxn.id],
        ledgerEntryIds: [utrBookState.id],
        confidenceScore: parseFloat((Math.min(100, utrScore) / 100).toFixed(2)),
        score: utrScore,
        confidenceBand: getConfidenceBand(utrScore),
        matchType: "utr_exact",
        reasons: [{ reason: "utr_deterministic_match", points: utrScore }],
        scoringBreakdown: {
          amountScore: 1.0,
          dateScore: 1.0,
          textScore: 1.0
        }
      });
    }
  }

  // ==========================================
  // PASS 1: EXACT MATCH (Layer 6A)
  // ==========================================
  for (const bankState of bankStates.values()) {
    if (bankState.status === "MATCHED") continue;

    const bankTxn = bankState.txn;
    const candidates = generateCandidates(bankTxn, getAvailableBooks());
    const exactMatches: { candidate: CandidateResult; score: number }[] = [];

    for (const cand of candidates) {
      const bookState = bookStates.get(cand.candidate.id)!;
      if (bookState.status === "MATCHED") continue;

      const bankAmt = bankState.remainingAmountMinor;
      const bookAmt = bookState.remainingAmountMinor;
      const dayDiff = Math.abs(differenceInDays(bankTxn.date, cand.candidate.date));
      if (dayDiff > 1) continue;  // not exact — let it fall to fuzzy pass
      const refMatch = referenceMatches(bankTxn.referenceId, cand.candidate.invoiceRef);
      const nameMatch = nameMatches(bankTxn.counterparty, cand.candidate.counterparty);
      const diffAmt = Math.abs(bankAmt - bookAmt);
      const currenciesDiffer = bankTxn.currency && cand.candidate.currency && bankTxn.currency !== cand.candidate.currency;

      if (!currenciesDiffer && diffAmt <= 100 && (refMatch || nameMatch)) {
        const finalScore = cand.score + 50;
        exactMatches.push({ candidate: cand, score: finalScore });
      }
    }

    if (exactMatches.length > 0) {
      exactMatches.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const dateDiffA = Math.abs(differenceInDays(bankTxn.date, a.candidate.candidate.date));
        const dateDiffB = Math.abs(differenceInDays(bankTxn.date, b.candidate.candidate.date));
        if (dateDiffA !== dateDiffB) return dateDiffA - dateDiffB;
        const refA = a.candidate.candidate.invoiceRef || "";
        const refB = b.candidate.candidate.invoiceRef || "";
        if (refA !== refB) return refA.localeCompare(refB);
        return a.candidate.candidate.id.localeCompare(b.candidate.candidate.id);
      });

      const best = exactMatches[0].candidate;
      const bookState = bookStates.get(best.candidate.id)!;

      bankState.status = "MATCHED";
      bankState.matchedAmountMinor = bankState.remainingAmountMinor;
      bankState.remainingAmountMinor = 0;

      bookState.status = "MATCHED";
      bookState.matchedAmountMinor = bookState.remainingAmountMinor;
      bookState.remainingAmountMinor = 0;

      const baseReasons = best.reasons.map((r) => ({ ...r }));
      baseReasons.push({ reason: "exact_match_validated", points: 50 });
      const finalScore = exactMatches[0].score;

      results.push({
        bankTransactionIds: [bankTxn.id],
        ledgerEntryIds: [best.candidate.id],
        confidenceScore: parseFloat((Math.min(100, finalScore) / 100).toFixed(2)),
        score: finalScore,
        confidenceBand: getConfidenceBand(finalScore),
        matchType: "exact",
        reasons: baseReasons,
        scoringBreakdown: {
          amountScore: 1.0,
          dateScore: 1.0,
          textScore: 1.0
        }
      });
    }
  }

  // ==========================================
  // PASS 2: SUBSET MATCH (Layer 6C)
  // ==========================================
  // Subset matching runs BEFORE fee matching (Issue 4).
  // Deterministic sum-based combinations are more reliable than fee approximations.
  // Evaluating subsets first prevents a fee-ratio match from consuming a transaction
  // that belongs to a precise many-ledger reconciliation.

  // Pass 2A: One-to-Many
  for (const bankState of bankStates.values()) {
    if (bankState.status === "MATCHED") continue;

    const bankTxn = bankState.txn;
    const bankAmt = bankState.remainingAmountMinor;

    const bookCandidates = Array.from(bookStates.values())
      .filter((bs) => {
        if (bs.status === "MATCHED") return false;
        const dayDiff = Math.abs(differenceInDays(bankTxn.date, bs.txn.date));
        if (dayDiff > 5.0) return false;
        if (!directionMatches(bankTxn, bs.txn)) return false;

        // Currency guard — always applies even for Stripe payouts
        const currenciesDiffer = bankTxn.currency && bs.txn.currency
          && bankTxn.currency !== bs.txn.currency;
        const sharesBase = (bankTxn.baseCurrency || bankTxn.currency)
          === (bs.txn.baseCurrency || bs.txn.currency);
        if (currenciesDiffer && !sharesBase) return false;

        // Stripe escape hatch: bypass counterparty/ref gate only.
        // Date, direction, and currency guards above still apply.
        if (isStripePayoutTransaction(bankTxn)) return true;

        // Standard counterparty/ref gate
        const sim = getCounterpartySimilarity(bankTxn.counterparty, bs.txn.counterparty);
        const hasRefOverlap = referenceMatches(bankTxn.referenceId, bs.txn.invoiceRef) ||
          (bankTxn.description && bs.txn.memo && getCounterpartySimilarity(bankTxn.description, bs.txn.memo) >= 0.4);
        return sim >= 0.4 || hasRefOverlap;
      });

    if (bookCandidates.length >= 2) {
      bookCandidates.sort((a, b) => {
        const dateDiffA = Math.abs(differenceInDays(bankTxn.date, a.txn.date));
        const dateDiffB = Math.abs(differenceInDays(bankTxn.date, b.txn.date));
        return dateDiffA - dateDiffB;
      });
      const topCandidates = bookCandidates.slice(0, 10);

      const combos = getCombinations(topCandidates, 2, 4);
      const validCombos: { combo: TransactionState<LedgerEntry>[]; score: number }[] = [];

      for (const combo of combos) {
        const sumAmt = combo.reduce((sum, bs) => sum + bs.remainingAmountMinor, 0);
        const diff = Math.abs(sumAmt - bankAmt);
        const isExactSum = diff <= 100;
        const isFeeSum = matchesProcessorFeeForCombo(bankAmt, combo);

        if (isExactSum || isFeeSum) {
          const baseScores = combo.map((bs) => {
            const candidatesResult = generateCandidates(bankTxn, [bs.txn], { skipAmountGate: true });
            return candidatesResult.length > 0 ? candidatesResult[0].score : 50;
          });
          let score = Math.max(...baseScores) + 15;

          const bankAmtBig = BigInt(getEffectiveAmountMinor(bankTxn));
          const comboSum = combo.reduce((acc, l) =>
            acc + BigInt(getEffectiveAmountMinor(l.txn)), 0n);
          const diffBig = bankAmtBig > comboSum ? bankAmtBig - comboSum : comboSum - bankAmtBig;
          const diffPct = Number(diffBig) / Number(bankAmtBig);

          if (diffBig === 0n) {
            score += 50;   // perfect sum → pushes into auto-approve (>=0.80)
          } else if (diffPct < 0.03) {
            score += 35;   // within 3% → covers Stripe fee deductions (~2.9%)
                           // lands in accountant review (0.50-0.79)
          } else if (diffPct < 0.05) {
            score += 20;   // within 5% → still a plausible bulk match
          }

          validCombos.push({ combo, score });
        }
      }

      if (validCombos.length > 0) {
        validCombos.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          const spreadA = Math.max(...a.combo.map((c) => c.txn.date.getTime())) - Math.min(...a.combo.map((c) => c.txn.date.getTime()));
          const spreadB = Math.max(...b.combo.map((c) => c.txn.date.getTime())) - Math.min(...b.combo.map((c) => c.txn.date.getTime()));
          if (spreadA !== spreadB) return spreadA - spreadB;
          const idsA = a.combo.map((c) => c.id).sort().join(",");
          const idsB = b.combo.map((c) => c.id).sort().join(",");
          return idsA.localeCompare(idsB);
        });

        const bestCombo = validCombos[0].combo;

        bankState.status = "MATCHED";
        bankState.matchedAmountMinor = bankAmt;
        bankState.remainingAmountMinor = 0;

        for (const bs of bestCombo) {
          bs.status = "MATCHED";
          bs.matchedAmountMinor = bs.remainingAmountMinor;
          bs.remainingAmountMinor = 0;
        }

        const finalScore = validCombos[0].score;
        results.push({
          bankTransactionIds: [bankTxn.id],
          ledgerEntryIds: bestCombo.map((bs) => bs.id),
          confidenceScore: parseFloat((Math.min(100, finalScore) / 100).toFixed(2)),
          score: finalScore,
          confidenceBand: getConfidenceBand(finalScore),
          matchType: "one_to_many",
          reasons: [{ reason: "subset_match_validated", points: 15 }],
          scoringBreakdown: {
            amountScore: 0.95,
            dateScore: 0.90,
            textScore: 0.85
          }
        });
      }
    }
  }

  // Pass 2B: Many-to-One
  for (const bookState of bookStates.values()) {
    if (bookState.status === "MATCHED") continue;

    const bookTxn = bookState.txn;
    const bookAmt = bookState.remainingAmountMinor;

    const bankCandidates = Array.from(bankStates.values())
      .filter((bs) => {
        if (bs.status === "MATCHED") return false;
        const dayDiff = Math.abs(differenceInDays(bookTxn.date, bs.txn.date));
        if (dayDiff > 5.0) return false;
        if (!directionMatches(bookTxn, bs.txn)) return false;

        const sim = getCounterpartySimilarity(bookTxn.counterparty, bs.txn.counterparty);
        const hasRefOverlap = referenceMatches(bookTxn.invoiceRef, bs.txn.referenceId) ||
          (bookTxn.memo && bs.txn.description && getCounterpartySimilarity(bookTxn.memo, bs.txn.description) >= 0.4);
        return sim >= 0.4 || hasRefOverlap;
      });

    if (bankCandidates.length >= 2) {
      bankCandidates.sort((a, b) => {
        const dateDiffA = Math.abs(differenceInDays(bookTxn.date, a.txn.date));
        const dateDiffB = Math.abs(differenceInDays(bookTxn.date, b.txn.date));
        return dateDiffA - dateDiffB;
      });
      const topCandidates = bankCandidates.slice(0, 10);

      const combos = getCombinations(topCandidates, 2, 4);
      const validCombos: { combo: TransactionState<BankTransaction>[]; score: number }[] = [];

      for (const combo of combos) {
        const sumAmt = combo.reduce((sum, bs) => sum + bs.remainingAmountMinor, 0);
        if (Math.abs(sumAmt - bookAmt) <= 100) {
          const baseScores = combo.map((bs) => {
            const candidatesResult = generateCandidates(bs.txn, [bookTxn], { skipAmountGate: true });
            return candidatesResult.length > 0 ? candidatesResult[0].score : 50;
          });
          const finalScore = Math.max(...baseScores) + 15;
          validCombos.push({ combo, score: finalScore });
        }
      }

      if (validCombos.length > 0) {
        validCombos.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          const spreadA = Math.max(...a.combo.map((c) => c.txn.date.getTime())) - Math.min(...a.combo.map((c) => c.txn.date.getTime()));
          const spreadB = Math.max(...b.combo.map((c) => c.txn.date.getTime())) - Math.min(...b.combo.map((c) => c.txn.date.getTime()));
          if (spreadA !== spreadB) return spreadA - spreadB;
          const idsA = a.combo.map((c) => c.id).sort().join(",");
          const idsB = b.combo.map((c) => c.id).sort().join(",");
          return idsA.localeCompare(idsB);
        });

        const bestCombo = validCombos[0].combo;

        bookState.status = "MATCHED";
        bookState.matchedAmountMinor = bookAmt;
        bookState.remainingAmountMinor = 0;

        for (const bs of bestCombo) {
          bs.status = "MATCHED";
          bs.matchedAmountMinor = bs.remainingAmountMinor;
          bs.remainingAmountMinor = 0;
        }

        const finalScore = validCombos[0].score;
        results.push({
          bankTransactionIds: bestCombo.map(bs => bs.id),
          ledgerEntryIds: [bookTxn.id],
          confidenceScore: parseFloat((Math.min(100, finalScore) / 100).toFixed(2)),
          score: finalScore,
          confidenceBand: getConfidenceBand(finalScore),
          matchType: "many_to_one",
          reasons: [{ reason: "subset_match_validated", points: 15 }],
          scoringBreakdown: {
            amountScore: 0.95,
            dateScore: 0.90,
            textScore: 0.85
          }
        });
      }
    }
  }

  // ==========================================
  // PASS 3: PROCESSOR FEE MATCH (Layer 6E)
  // ==========================================
  // Runs after Subset Match (Issue 4). Fee matching is an approximation;
  // subset matching is deterministic. This order prevents a fee-ratio
  // approximation from consuming a transaction that has a precise subset match.
  for (const bankState of bankStates.values()) {
    if (bankState.status === "MATCHED") continue;

    const bankTxn = bankState.txn;
    const candidates = generateCandidates(bankTxn, getAvailableBooks(), { skipAmountGate: true });
    const feeMatches: { candidate: CandidateResult; score: number }[] = [];

    for (const cand of candidates) {
      const bookState = bookStates.get(cand.candidate.id)!;
      if (bookState.status === "MATCHED") continue;

      const bankAmt = bankState.remainingAmountMinor;
      const bookAmt = bookState.remainingAmountMinor;
      const dayDiff = Math.abs(differenceInDays(bankTxn.date, cand.candidate.date));
      const refMatch = referenceMatches(bankTxn.referenceId, cand.candidate.invoiceRef);
      const nameMatch = nameMatches(bankTxn.counterparty, cand.candidate.counterparty);

      if (dayDiff <= 7.0 && (refMatch || nameMatch)) {
        if (matchesProcessorFee(bankAmt, bookAmt)) {
          const finalScore = cand.score + 20;
          feeMatches.push({ candidate: cand, score: finalScore });
        }
      }
    }

    if (feeMatches.length > 0) {
      feeMatches.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const dateDiffA = Math.abs(differenceInDays(bankTxn.date, a.candidate.candidate.date));
        const dateDiffB = Math.abs(differenceInDays(bankTxn.date, b.candidate.candidate.date));
        if (dateDiffA !== dateDiffB) return dateDiffA - dateDiffB;
        return a.candidate.candidate.id.localeCompare(b.candidate.candidate.id);
      });

      const best = feeMatches[0].candidate;
      const bookState = bookStates.get(best.candidate.id)!;

      bankState.status = "MATCHED";
      bankState.matchedAmountMinor = bankState.remainingAmountMinor;
      bankState.remainingAmountMinor = 0;

      bookState.status = "MATCHED";
      bookState.matchedAmountMinor = bookState.remainingAmountMinor;
      bookState.remainingAmountMinor = 0;

      const baseReasons = best.reasons.map((r) => ({ ...r }));
      baseReasons.push({ reason: "fee_match_validated", points: 20 });
      const finalScore = feeMatches[0].score;

      results.push({
        bankTransactionIds: [bankTxn.id],
        ledgerEntryIds: [best.candidate.id],
        confidenceScore: parseFloat((Math.min(100, finalScore) / 100).toFixed(2)),
        score: finalScore,
        confidenceBand: getConfidenceBand(finalScore),
        matchType: "fee_adjustment",
        reasons: baseReasons,
        scoringBreakdown: {
          amountScore: 0.90,
          dateScore: 0.85,
          textScore: 0.90
        }
      });
    }
  }

  // ==========================================
  // PASS 4: PARTIAL PAYMENT (Layer 6D)
  // ==========================================
  // Handles both underpayments (bank < book) and overpayments (bank > book).
  // Overpayments and advance payments are valid accounting scenarios; they are
  // matched and routed to accountant review via classification discrepancy types
  // (OVERPAYMENT, ADVANCE_PAYMENT) rather than being silently rejected (Issue 9).
  //
  // The 20% gap guard remains in place for both directions to prevent
  // pathological false positives on very different amounts.
  for (const bankState of bankStates.values()) {
    if (bankState.status === "MATCHED") continue;

    const bankTxn = bankState.txn;
    const bankAmt = bankState.remainingAmountMinor;

    const candidates = generateCandidates(bankTxn, getAvailableBooks(), { skipAmountGate: true });

    interface PartialMatchEntry {
      candidate: CandidateResult;
      score: number;
      isOverpayment: boolean;
      isAdvancePayment: boolean;
    }
    const partialMatches: PartialMatchEntry[] = [];

    for (const cand of candidates) {
      const bookState = bookStates.get(cand.candidate.id)!;
      if (bookState.status === "MATCHED") continue;

      const bankAmtNum = Number(getEffectiveAmountMinor(bankTxn));
      const bookAmtNum = Number(getEffectiveAmountMinor(cand.candidate));
      const gapPct = Math.abs(bankAmtNum - bookAmtNum) / Math.max(bankAmtNum, bookAmtNum);

      if (gapPct > 0.20) continue;  // gap too large → reject, goes to exceptions

      // Skip exact-amount matches here — they belong in Pass 5 (timing/tolerance).
      // Without this guard, Pass 4 would incorrectly tag timing-difference entries
      // (F1, F8) as "partial_payment" simply because bankAmt <= bookAmt is trivially true.
      if (gapPct < 0.001) continue;

      const refMatch = referenceMatches(bankTxn.referenceId, cand.candidate.invoiceRef);
      const nameMatch = nameMatches(bankTxn.counterparty, cand.candidate.counterparty);
      const currenciesDiffer = bankTxn.currency && cand.candidate.currency && bankTxn.currency !== cand.candidate.currency;

      if (!currenciesDiffer && (refMatch || nameMatch)) {
        const isOverpayment = bankAmt > bookState.remainingAmountMinor;
        // Advance payment: bank pays more than the ENTIRE invoice (no prior payments)
        const isAdvancePayment = isOverpayment && bookState.matchedAmountMinor === 0;

        const finalScore = cand.score + 5;
        partialMatches.push({ candidate: cand, score: finalScore, isOverpayment, isAdvancePayment });
      }
    }

    if (partialMatches.length > 0) {
      partialMatches.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const dateDiffA = Math.abs(differenceInDays(bankTxn.date, a.candidate.candidate.date));
        const dateDiffB = Math.abs(differenceInDays(bankTxn.date, b.candidate.candidate.date));
        if (dateDiffA !== dateDiffB) return dateDiffA - dateDiffB;
        return a.candidate.candidate.id.localeCompare(b.candidate.candidate.id);
      });

      const bestEntry = partialMatches[0];
      const best = bestEntry.candidate;
      const bookState = bookStates.get(best.candidate.id)!;

      bankState.status = "MATCHED";
      bankState.matchedAmountMinor = bankAmt;
      bankState.remainingAmountMinor = 0;

      const baseReasons = best.reasons.map((r) => ({ ...r }));
      const finalScore = bestEntry.score;

      if (bestEntry.isOverpayment) {
        // Both sides are fully consumed; the excess amount goes to accountant review.
        const bookRemainingBefore = bookState.remainingAmountMinor;
        bookState.matchedAmountMinor += bookRemainingBefore;
        bookState.remainingAmountMinor = 0;
        bookState.status = "MATCHED";

        const overpaymentAmount = bankAmt - bookRemainingBefore;
        const reasonLabel = bestEntry.isAdvancePayment ? "advance_payment_detected" : "overpayment_detected";
        baseReasons.push({ reason: "partial_payment_validated", points: 5 });
        baseReasons.push({ reason: reasonLabel, points: 0 });
        baseReasons.push({ reason: `overpayment_amount:${overpaymentAmount}`, points: 0 });
      } else {
        // Standard underpayment path
        baseReasons.push({ reason: "partial_payment_validated", points: 5 });
        bookState.matchedAmountMinor += bankAmt;
        bookState.remainingAmountMinor -= bankAmt;
        bookState.status = bookState.remainingAmountMinor === 0 ? "MATCHED" : "PARTIALLY_MATCHED";
      }

      results.push({
        bankTransactionIds: [bankTxn.id],
        ledgerEntryIds: [best.candidate.id],
        confidenceScore: parseFloat((Math.min(100, finalScore) / 100).toFixed(2)),
        score: finalScore,
        confidenceBand: getConfidenceBand(finalScore),
        matchType: "partial_payment",
        reasons: baseReasons,
        scoringBreakdown: {
          amountScore: 0.60,
          dateScore: 0.85,
          textScore: 0.90
        }
      });
    }
  }

  // ==========================================
  // PASS 5: TOLERANCE / NEAR / FX (Layers 6B & 6F)
  // ==========================================
  for (const bankState of bankStates.values()) {
    if (bankState.status === "MATCHED") continue;

    const bankTxn = bankState.txn;
    const candidates = generateCandidates(bankTxn, getAvailableBooks(), { skipAmountGate: true });
    const toleranceMatches: { candidate: CandidateResult; score: number; matchType: MatchType; reasons: CandidateReason[] }[] = [];

    for (const cand of candidates) {
      const bookState = bookStates.get(cand.candidate.id)!;
      if (bookState.status === "MATCHED") continue;

      const bankAmt = bankState.remainingAmountMinor;
      const bookAmt = bookState.remainingAmountMinor;
      const dayDiff = Math.abs(differenceInDays(bankTxn.date, cand.candidate.date));
      const refMatch = referenceMatches(bankTxn.referenceId, cand.candidate.invoiceRef);
      const nameMatch = nameMatches(bankTxn.counterparty, cand.candidate.counterparty);

      const currenciesDiffer = bankTxn.currency && cand.candidate.currency && bankTxn.currency !== cand.candidate.currency;
      const sharesBaseCurrency = bankTxn.baseCurrency && cand.candidate.baseCurrency && bankTxn.baseCurrency === cand.candidate.baseCurrency;

      if (currenciesDiffer && sharesBaseCurrency) {
        const convertedBank = bankTxn.convertedAmountMinor !== undefined && bankTxn.convertedAmountMinor !== null
          ? bankTxn.convertedAmountMinor
          : bankTxn.amount;
        const convertedBook = cand.candidate.convertedAmountMinor !== undefined && cand.candidate.convertedAmountMinor !== null
          ? cand.candidate.convertedAmountMinor
          : cand.candidate.amount;
        if (convertedBank !== undefined && convertedBook !== undefined && convertedBank !== null && convertedBook !== null) {
          const diffConverted = Math.abs(convertedBank - convertedBook);
          const comparisonAmount = Math.max(convertedBank, convertedBook);
          const allowedTolerance = Math.max(500, Math.round(comparisonAmount * 0.20));

          if (diffConverted <= allowedTolerance && dayDiff <= 7.0 && (refMatch || nameMatch)) {
            const finalScore = cand.score + 15;
            const reasons = cand.reasons.map((r) => ({ ...r }));
            reasons.push({ reason: "fx_difference_validated", points: 15 });
            toleranceMatches.push({
              candidate: cand,
              score: finalScore,
              matchType: "fx_difference",
              reasons
            });
            continue;
          }
        }
      }

      if (dayDiff <= 7.0 && (refMatch || nameMatch)) {
        const diffAmt = Math.abs(bankAmt - bookAmt);
        const comparisonAmount = Math.max(bankAmt, bookAmt);
        const allowedTolerance = Math.max(500, Math.round(comparisonAmount * 0.20));

        if (diffAmt <= allowedTolerance) {
          const finalScore = cand.score + 10;
          const reasons = cand.reasons.map((r) => ({ ...r }));
          reasons.push({ reason: "tolerance_match_validated", points: 10 });
          toleranceMatches.push({
            candidate: cand,
            score: finalScore,
            matchType: "tolerance",
            reasons
            });
        }
      }
    }

    if (toleranceMatches.length > 0) {
      toleranceMatches.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const dateDiffA = Math.abs(differenceInDays(bankTxn.date, a.candidate.candidate.date));
        const dateDiffB = Math.abs(differenceInDays(bankTxn.date, b.candidate.candidate.date));
        if (dateDiffA !== dateDiffB) return dateDiffA - dateDiffB;
        return a.candidate.candidate.id.localeCompare(b.candidate.candidate.id);
      });

      const best = toleranceMatches[0];
      const bookState = bookStates.get(best.candidate.candidate.id)!;

      bankState.status = "MATCHED";
      bankState.matchedAmountMinor = bankState.remainingAmountMinor;
      bankState.remainingAmountMinor = 0;

      bookState.status = "MATCHED";
      bookState.matchedAmountMinor = bookState.remainingAmountMinor;
      bookState.remainingAmountMinor = 0;

      results.push({
        bankTransactionIds: [bankTxn.id],
        ledgerEntryIds: [best.candidate.candidate.id],
        confidenceScore: parseFloat((Math.min(100, best.score) / 100).toFixed(2)),
        score: best.score,
        confidenceBand: getConfidenceBand(best.score),
        matchType: best.matchType,
        reasons: best.reasons,
        scoringBreakdown: {
          amountScore: 0.80,
          dateScore: 0.85,
          textScore: 0.80
        }
      });
    }
  }

  // ==========================================
  // PASS 6: UNMATCHED — Bank & Ledger (Issue 7)
  // ==========================================
  // 6A: Unmatched bank transactions
  for (const bankState of bankStates.values()) {
    if (bankState.status !== "MATCHED") {
      results.push({
        bankTransactionIds: [bankState.id],
        ledgerEntryIds: [],
        confidenceScore: 0,
        score: 0,
        confidenceBand: "NONE",
        matchType: "none",
        scoringBreakdown: { amountScore: 0, dateScore: 0, textScore: 0 }
      });
    }
  }

  // 6B: Unmatched ledger entries — surfaced so accountants can see unpaid invoices,
  //     ghost entries, or missing bank deposits alongside unmatched bank transactions.
  for (const bookState of bookStates.values()) {
    if (bookState.status !== "MATCHED") {
      results.push({
        bankTransactionIds: [],
        ledgerEntryIds: [bookState.id],
        confidenceScore: 0,
        score: 0,
        confidenceBand: "NONE",
        matchType: "unmatched_ledger",
        scoringBreakdown: { amountScore: 0, dateScore: 0, textScore: 0 }
      });
    }
  }

  const allBanksForDuplicate = banks.map(b => ({
    amount: b.amount,
    date: b.date,
    description: b.description,
    referenceId: b.referenceId,
    counterparty: b.counterparty
  }));

  for (const res of results) {
    const matchedBankTxns = banks.filter(b => res.bankTransactionIds.includes(b.id));
    const primaryBankTxn = matchedBankTxns[0];
    
    // For unmatched_ledger records, there is no bank transaction — use a synthetic
    // placeholder so the classifier can route to the UNMATCHED path cleanly.
    const classifierBankTxn = primaryBankTxn ?? {
      amount: 0,
      date: new Date(),
      description: "",
      referenceId: "",
      counterparty: undefined,
      currency: undefined,
      baseCurrency: undefined,
      convertedAmountMinor: undefined,
      matchingSignals: undefined
    };

    // Create an aggregate bank txn for classifier (multi-bank matches)
    const aggregateBankTxn = primaryBankTxn ? {
      ...primaryBankTxn,
      amount: matchedBankTxns.reduce((sum, b) => sum + b.amount, 0),
      convertedAmountMinor: matchedBankTxns.reduce((sum, b) => sum + (b.convertedAmountMinor || b.amount), 0)
    } : classifierBankTxn;

    const matchedLedgerEntries = ledgers.filter(l => res.ledgerEntryIds.includes(l.id));
    res.classification = classifyMatch(
      aggregateBankTxn,
      matchedLedgerEntries,
      res.matchType,
      res.reasons || [],
      allBanksForDuplicate,
      res.score
    );
  }

  // Sort: UTR first, then high confidence, exceptions last
  const typeOrder: Record<MatchType, number> = {
    utr_exact: 0,
    exact: 1,
    one_to_many: 2,
    many_to_one: 2,
    bulk: 2,
    fee_adjustment: 3,
    fx_difference: 4,
    tolerance: 5,
    fuzzy: 5,
    partial_payment: 6,
    unmatched_ledger: 7,
    none: 8
  };

  results.sort((a, b) => {
    const typeDiff = (typeOrder[a.matchType] ?? 9) - (typeOrder[b.matchType] ?? 9);
    if (typeDiff !== 0) return typeDiff;
    return b.score - a.score;
  });

  return results as MatchResult[];
}