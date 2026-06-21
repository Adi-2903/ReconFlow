import { differenceInDays } from "date-fns";

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
  | "tolerance"
  | "fuzzy"
  | "fee_adjustment"
  | "one_to_many"
  | "many_to_one"
  | "bulk"
  | "partial_payment"
  | "fx_difference"
  | "none";

export interface CandidateReason {
  reason: string;
  points: number;
}

export interface MatchResult {
  bankTransactionId: string;
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

function getConfidenceBand(score: number): "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW" | "NONE" {
  if (score >= 150) return "VERY_HIGH";
  if (score >= 100) return "HIGH";
  if (score >= 60) return "MEDIUM";
  if (score > 0) return "LOW";
  return "NONE";
}

function matchesProcessorFee(bankAmtMinor: number, bookAmtMinor: number): boolean {
  const diff = bookAmtMinor - bankAmtMinor;
  if (diff <= 0) return false;
  
  const commonRates = [0.0118, 0.0236, 0.03776, 0.0472, 0.029, 0.02, 0.03];
  for (const rate of commonRates) {
    const expectedFee = Math.round(bookAmtMinor * rate);
    if (Math.abs(diff - expectedFee) <= 100) { // allow 100 paise (Rs 1) rounding
      return true;
    }
  }
  const expectedStripeUSD = Math.round(bookAmtMinor * 0.029) + 3000;
  if (Math.abs(diff - expectedStripeUSD) <= 100) {
    return true;
  }
  return false;
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

    const currencyMatch =
      (!bankTxn.currency || !bookTxn.currency) ||
      (bankTxn.currency === bookTxn.currency) ||
      (bankTxn.convertedAmountMinor !== undefined && bankTxn.convertedAmountMinor !== null &&
       bookTxn.convertedAmountMinor !== undefined && bookTxn.convertedAmountMinor !== null &&
       bankTxn.baseCurrency && bookTxn.baseCurrency &&
       bankTxn.baseCurrency === bookTxn.baseCurrency);

    if (!currencyMatch) continue;

    const bankAmtMinor = BigInt(getEffectiveAmountMinor(bankTxn));
    const bookAmtMinor = BigInt(getEffectiveAmountMinor(bookTxn));

    const diff = bankAmtMinor > bookAmtMinor ? bankAmtMinor - bookAmtMinor : bookAmtMinor - bankAmtMinor;
    const comparisonAmount = bankAmtMinor > bookAmtMinor ? bankAmtMinor : bookAmtMinor;
    
    const calculatedTolerance = (comparisonAmount * TOLERANCE_BPS) / 10000n;
    const allowedTolerance = calculatedTolerance > MIN_AMOUNT_TOLERANCE ? calculatedTolerance : MIN_AMOUNT_TOLERANCE;

    if (!options?.skipAmountGate && diff > allowedTolerance) continue;

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

    if (referenceMatches(bankTxn.referenceId, bookTxn.invoiceRef)) {
      scoreVal += 30;
      reasons.push({ reason: "reference_match", points: 30 });
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

function matchesProcessorFeeForCombo(bankAmtMinor: number, combo: TransactionState<LedgerEntry>[]): boolean {
  const sumBookAmt = combo.reduce((sum, bs) => sum + bs.remainingAmountMinor, 0);
  const diff = sumBookAmt - bankAmtMinor;
  if (diff <= 0) return false;

  // 1. Stripe INR: 2.9% + Rs. 25 (2500 paise)
  const expectedStripeINR = combo.reduce((sum, bs) => {
    const amt = bs.remainingAmountMinor;
    return sum + Math.round(amt * 0.029) + 2500;
  }, 0);
  if (Math.abs(diff - expectedStripeINR) <= 100 * combo.length) {
    return true;
  }

  // 2. Stripe USD: 2.9% + $0.30 (3000 paise/cents)
  const expectedStripeUSD = combo.reduce((sum, bs) => {
    const amt = bs.remainingAmountMinor;
    return sum + Math.round(amt * 0.029) + 3000;
  }, 0);
  if (Math.abs(diff - expectedStripeUSD) <= 100 * combo.length) {
    return true;
  }

  // 3. Check simple rates
  const commonRates = [0.0118, 0.0236, 0.03776, 0.0472, 0.029, 0.02, 0.03];
  for (const rate of commonRates) {
    const expectedFee = combo.reduce((sum, bs) => {
      return sum + Math.round(bs.remainingAmountMinor * rate);
    }, 0);
    if (Math.abs(diff - expectedFee) <= 100 * combo.length) {
      return true;
    }
  }

  return false;
}

// ── Main Matching Engine ────────────────────────────────────────────────────────

export function matchTransactions(
  banks: BankTransaction[],
  ledgers: LedgerEntry[]
): MatchResult[] {
  const results: MatchResult[] = [];

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
      const refMatch = referenceMatches(bankTxn.referenceId, cand.candidate.invoiceRef);
      const nameMatch = nameMatches(bankTxn.counterparty, cand.candidate.counterparty);
      const diffAmt = Math.abs(bankAmt - bookAmt);
      const currenciesDiffer = bankTxn.currency && cand.candidate.currency && bankTxn.currency !== cand.candidate.currency;

      if (!currenciesDiffer && diffAmt <= 100 && dayDiff <= 1.0 && (refMatch || nameMatch)) {
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
        bankTransactionId: bankTxn.id,
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
  // PASS 2: PROCESSOR FEE MATCH (Layer 6E)
  // ==========================================
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
        bankTransactionId: bankTxn.id,
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
  // PASS 3: SUBSET MATCH (Layer 6C)
  // ==========================================
  // Pass 3A: One-to-Many
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
          bankTransactionId: bankTxn.id,
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

  // Pass 3B: Many-to-One
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
          bankTransactionId: bestCombo[0].id, // primary linked ID
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
  // PASS 4: PARTIAL PAYMENT (Layer 6D)
  // ==========================================
  for (const bankState of bankStates.values()) {
    if (bankState.status === "MATCHED") continue;

    const bankTxn = bankState.txn;
    const bankAmt = bankState.remainingAmountMinor;

    const candidates = generateCandidates(bankTxn, getAvailableBooks(), { skipAmountGate: true });
    const partialMatches: { candidate: CandidateResult; score: number }[] = [];

    for (const cand of candidates) {
      const bookState = bookStates.get(cand.candidate.id)!;
      if (bookState.status === "MATCHED") continue;

      const refMatch = referenceMatches(bankTxn.referenceId, cand.candidate.invoiceRef);
      const nameMatch = nameMatches(bankTxn.counterparty, cand.candidate.counterparty);
      const isPartialAmountValid = bankAmt <= bookState.remainingAmountMinor;
      const currenciesDiffer = bankTxn.currency && cand.candidate.currency && bankTxn.currency !== cand.candidate.currency;

      if (!currenciesDiffer && (refMatch || nameMatch) && isPartialAmountValid) {
        const finalScore = cand.score + 5;
        partialMatches.push({ candidate: cand, score: finalScore });
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

      const best = partialMatches[0].candidate;
      const bookState = bookStates.get(best.candidate.id)!;

      bankState.status = "MATCHED";
      bankState.matchedAmountMinor = bankAmt;
      bankState.remainingAmountMinor = 0;

      bookState.matchedAmountMinor += bankAmt;
      bookState.remainingAmountMinor -= bankAmt;
      bookState.status = bookState.remainingAmountMinor === 0 ? "MATCHED" : "PARTIALLY_MATCHED";

      const baseReasons = best.reasons.map((r) => ({ ...r }));
      baseReasons.push({ reason: "partial_payment_validated", points: 5 });
      const finalScore = partialMatches[0].score;

      results.push({
        bankTransactionId: bankTxn.id,
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
        bankTransactionId: bankTxn.id,
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

  // Pass 6: Unmatched
  for (const bankState of bankStates.values()) {
    if (bankState.status !== "MATCHED") {
      results.push({
        bankTransactionId: bankState.id,
        ledgerEntryIds: [],
        confidenceScore: 0,
        score: 0,
        confidenceBand: "NONE",
        matchType: "none",
        scoringBreakdown: { amountScore: 0, dateScore: 0, textScore: 0 }
      });
    }
  }

  // Sort: High confidence first, exceptions last
  const typeOrder: Record<MatchType, number> = {
    exact: 0,
    one_to_many: 1,
    many_to_one: 1,
    bulk: 1,
    fee_adjustment: 2,
    fx_difference: 3,
    tolerance: 4,
    fuzzy: 4,
    partial_payment: 5,
    none: 6
  };

  results.sort((a, b) => {
    const typeDiff = (typeOrder[a.matchType] ?? 9) - (typeOrder[b.matchType] ?? 9);
    if (typeDiff !== 0) return typeDiff;
    return b.score - a.score;
  });

  return results;
}