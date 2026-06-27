/**
 * core/matching/candidateGenerator.ts
 *
 * Responsible for scoring and ranking ledger entries against a single bank
 * transaction. Extracted from engine.ts so that:
 *   - The matching engine can continue to consume it internally.
 *   - The manual-match available-transactions API can import it directly
 *     WITHOUT pulling in the entire multi-pass engine pipeline.
 *
 * Layering contract:
 *   candidateGenerator.ts  ← pure scoring, no DB, no side-effects
 *   engine.ts              ← imports and orchestrates candidates into passes
 *   available/route.ts     ← imports candidateGenerator directly for ranked UX
 */

import { differenceInDays } from "date-fns";
import {
  isStripePayoutTransaction,
  hasReferenceConflict,
  isDigitTransposition,
  getConfidenceBand,
} from "./matchingHelpers";
import type { BankTransaction, LedgerEntry, CandidateReason } from "./engine";

// ── Public types ───────────────────────────────────────────────────────────────

export interface CandidateResult {
  candidate: LedgerEntry;
  score: number;
  confidenceBand: "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW";
  reasons: CandidateReason[];
}

// ── Private helpers ────────────────────────────────────────────────────────────

export function normalizeReference(ref?: string): string {
  if (!ref) return "";
  return ref.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function normalizeName(name?: string): string {
  if (!name) return "";
  return name
    .toUpperCase()
    .replace(/\b(CORPORATION|CORP|PVT|PRIVATE|LTD|LIMITED|SOLUTIONS|SOLUTION)\b/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

export function referenceMatches(bankRef?: string, bookRef?: string): boolean {
  const a = normalizeReference(bankRef);
  const b = normalizeReference(bookRef);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

export function nameMatches(bank?: string, book?: string): boolean {
  const a = normalizeName(bank);
  const b = normalizeName(book);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

export function directionMatches(
  a: BankTransaction | LedgerEntry,
  b: BankTransaction | LedgerEntry
): boolean {
  if (!a.direction || !b.direction) return true;
  const getDir = (d: string) => {
    const norm = d.toLowerCase();
    if (norm === "credit" || norm === "inflow") return "in";
    return "out";
  };
  return getDir(a.direction) === getDir(b.direction);
}

export function getCounterpartySimilarity(a?: string, b?: string): number {
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

export function getEffectiveAmountMinor(txn: BankTransaction | LedgerEntry): number {
  return txn.convertedAmountMinor !== undefined && txn.convertedAmountMinor !== null
    ? txn.convertedAmountMinor
    : txn.amount;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Scores and ranks ledger entries as match candidates for a given bank
 * transaction. Returns up to 50 results sorted by score descending.
 *
 * Used by:
 *   1. engine.ts — internally during multi-pass matching
 *   2. available/route.ts — to surface ranked suggestions in the manual-match UI
 */
export function generateCandidates(
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
    const currenciesDiffer =
      bankTxn.currency && bookTxn.currency && bankTxn.currency !== bookTxn.currency;
    if (currenciesDiffer && bankTxn.fxStatus === "MISSING_RATE") continue;

    const reportCurrencyBank = bankTxn.baseCurrency || bankTxn.currency;
    const reportCurrencyBook = bookTxn.baseCurrency || bookTxn.currency;
    const currencyMatch =
      !bankTxn.currency ||
      !bookTxn.currency ||
      bankTxn.currency === bookTxn.currency ||
      (reportCurrencyBank && reportCurrencyBook && reportCurrencyBank === reportCurrencyBook);

    // FX bypass: when currencies differ and no convertedAmountMinor is available,
    // accept the candidate if the implied rate is within realistic INR/FX bounds.
    let isFxCandidate = false;
    if (!currencyMatch && currenciesDiffer) {
      const bankRaw = BigInt(bankTxn.amount);
      const bookRaw = BigInt(bookTxn.amount);
      const inrRaw = bankTxn.currency === "INR" ? bankRaw : bookRaw;
      const fxRaw = bankTxn.currency === "INR" ? bookRaw : bankRaw;
      if (fxRaw === 0n) continue;
      const impliedRate = Number(inrRaw) / Number(fxRaw);
      if (impliedRate < 30 || impliedRate > 200) continue;
      isFxCandidate = true;
    } else if (!currencyMatch) {
      continue;
    }

    const bankAmtMinor = BigInt(getEffectiveAmountMinor(bankTxn));
    const bookAmtMinor = BigInt(getEffectiveAmountMinor(bookTxn));
    const diff =
      bankAmtMinor > bookAmtMinor ? bankAmtMinor - bookAmtMinor : bookAmtMinor - bankAmtMinor;
    const comparisonAmount = bankAmtMinor > bookAmtMinor ? bankAmtMinor : bookAmtMinor;
    const calculatedTolerance = (comparisonAmount * TOLERANCE_BPS) / 10000n;
    const allowedTolerance =
      calculatedTolerance > MIN_AMOUNT_TOLERANCE ? calculatedTolerance : MIN_AMOUNT_TOLERANCE;

    if (!isFxCandidate && !options?.skipAmountGate && diff > allowedTolerance) continue;

    const dayDiff = Math.abs(differenceInDays(bankTxn.date, bookTxn.date));
    let maxDateDifference = 7;
    const channel = bankTxn.matchingSignals?.channel || "";
    if (channel === "STRIPE" || (bankTxn.description || "").toLowerCase().includes("stripe"))
      maxDateDifference = 7;
    else if (channel === "NEFT" || channel === "RTGS") maxDateDifference = 4;
    else if (channel === "UPI") maxDateDifference = 2;
    else if (channel === "WIRE") maxDateDifference = 15;

    if (Math.floor(dayDiff) > maxDateDifference) continue;

    // ── Scoring ───────────────────────────────────────────────────────────────
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
    // UTR match (+100)
    if (
      bankSignals.utr &&
      bookSignals.utr &&
      normalizeReference(bankSignals.utr) === normalizeReference(bookSignals.utr)
    ) {
      scoreVal += 100;
      reasons.push({ reason: "utr_match", points: 100 });
    }

    // Related ID match (+80)
    if (
      bankSignals.relatedTransactionId &&
      bookSignals.relatedTransactionId &&
      normalizeReference(bankSignals.relatedTransactionId) === normalizeReference(bookSignals.relatedTransactionId)
    ) {
      scoreVal += 80;
      reasons.push({ reason: "related_id_match", points: 80 });
    }

    // Invoice match (+80)
    if (
      bankSignals.invoiceNumber &&
      bookSignals.invoiceNumber &&
      normalizeReference(bankSignals.invoiceNumber) === normalizeReference(bookSignals.invoiceNumber)
    ) {
      scoreVal += 80;
      reasons.push({ reason: "invoice_match", points: 80 });
    }

    // Voucher match (+80)
    if (
      bankSignals.voucherNumber &&
      bookSignals.voucherNumber &&
      normalizeReference(bankSignals.voucherNumber) === normalizeReference(bookSignals.voucherNumber)
    ) {
      scoreVal += 80;
      reasons.push({ reason: "voucher_match", points: 80 });
    }

    // Customer name match (+15)
    if (bankSignals.customerName && bookSignals.customerName && nameMatches(bankSignals.customerName, bookSignals.customerName)) {
      scoreVal += 15;
      reasons.push({ reason: "customer_name_match", points: 15 });
    }

    // Vendor name match (+15)
    if (bankSignals.vendorName && bookSignals.vendorName && nameMatches(bankSignals.vendorName, bookSignals.vendorName)) {
      scoreVal += 15;
      reasons.push({ reason: "vendor_name_match", points: 15 });
    }

    // Merchant name match (+15)
    if (bankSignals.merchantName && bookSignals.merchantName && nameMatches(bankSignals.merchantName, bookSignals.merchantName)) {
      scoreVal += 15;
      reasons.push({ reason: "merchant_name_match", points: 15 });
    }

    // Payment channel match (+10)
    if (
      bankSignals.channel &&
      bookSignals.channel &&
      bankSignals.channel.trim().toUpperCase() === bookSignals.channel.trim().toUpperCase()
    ) {
      scoreVal += 10;
      reasons.push({ reason: "channel_match", points: 10 });
    }

    const bankRef = (bankTxn.referenceId || "").trim().toLowerCase();
    const bookRef = (bookTxn.invoiceRef || "").trim().toLowerCase();

    if (bankRef && bookRef) {
      if (bankRef.includes(bookRef) || bookRef.includes(bankRef)) {
        scoreVal += 30;
        reasons.push({ reason: "reference_match", points: 30 });
      } else {
        const bankInv = bankSignals.invoiceNumber || "";
        const bookInv = bookSignals.invoiceNumber || "";
        if (
          isDigitTransposition(bankRef, bookRef) ||
          (bankInv && bookInv && isDigitTransposition(bankInv, bookInv))
        ) {
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

    const bankSource = bankTxn.description.toLowerCase().includes("stripe")
      ? "stripe"
      : bankSignals.merchantName;
    const bookSource = (bookTxn.memo ?? "").toLowerCase().includes("stripe") ? "stripe" : undefined;
    if (bankSource && bookSource && bankSource.toLowerCase() === bookSource.toLowerCase()) {
      scoreVal += 15;
      reasons.push({ reason: "source_alignment", points: 15 });
    }

    // Reference conflict penalty
    const refAlreadyMatched = reasons.some((r) => r.reason === "reference_match");
    const refConflict = hasReferenceConflict(bankTxn.referenceId, bookTxn.invoiceRef, refAlreadyMatched);
    const signalMatch = reasons.some(
      (r) => r.reason === "utr_match" || r.reason === "invoice_match" || r.reason === "voucher_match"
    );
    if (refConflict && !signalMatch) {
      scoreVal -= 50;
      reasons.push({ reason: "reference_conflict_penalty", points: -50 });
    }

    const rawBand = getConfidenceBand(scoreVal);
    const confidenceBand: "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW" =
      rawBand === "NONE" ? "LOW" : rawBand;

    results.push({ candidate: bookTxn, score: scoreVal, confidenceBand, reasons });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 50);
}
