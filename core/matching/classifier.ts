// core/matching/classifier.ts

import { getConfidenceBand, isDigitTransposition, getEditDistance } from "./matchingHelpers";
import { matchesProcessorFee, detectTdsDeduction } from "./feeFormulas";

export type MatchOutcome = "MATCHED" | "PARTIALLY_MATCHED" | "UNMATCHED";

export type DiscrepancyType =
  | "NONE"
  | "TIMING_DIFFERENCE"
  | "PROCESSING_FEE"
  | "FOREIGN_EXCHANGE"
  | "TYPO"
  | "DUPLICATE"
  | "MISSING_ENTRY"
  | "AMOUNT_DIFFERENCE"
  | "COUNTERPARTY_DIFFERENCE"
  | "REFERENCE_DIFFERENCE"
  | "DUPLICATE_INVOICE"
  | "MANUAL_REVIEW";

export type ClassificationEvidenceCode =
  | "STRIPE_FEE_FORMULA"
  | "RAZORPAY_FEE_FORMULA"
  | "GENERIC_PROCESSING_FEE"
  | "TDS_DEDUCTION"
  | "FX_CONVERSION_STABLE"
  | "TIMING_LAG_DETECTED"
  | "REFERENCE_TRANSPOSITION"
  | "NAME_SPELLING_TYPO"
  | "DUPLICATE_PAYMENT_ROW"
  | "MISSING_INVOICE_REF"
  | "OPERATING_EXPENSE"
  | "MATCHED_EXACT_CLEAN"
  | "PARTIAL_PAYMENT_CONFIRMED"
  | "ADVANCE_PAYMENT_DETECTED"
  | "OVERPAYMENT_DETECTED"
  | "UTR_EXACT_MATCH"
  | "AMOUNT_SHORTFALL"
  | "COUNTERPARTY_MISMATCH"
  | "REFERENCE_MISMATCH"
  | "DUPLICATE_INVOICE_DETECTED"
  | "MANUAL_REVIEW_REQUIRED";

export interface ClassificationEvidence {
  code: ClassificationEvidenceCode;
  message: string;
}

export interface ClassificationResult {
  matchOutcome: MatchOutcome;
  discrepancyType: DiscrepancyType;
  confidenceBand: "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW" | "NONE";
  confidence: number;
  evidence: ClassificationEvidence[];
}

function cleanNameForTypo(name?: string): string {
  if (!name) return "";
  return name
    .toUpperCase()
    .replace(/\b(CORPORATION|CORP|PVT|PRIVATE|LTD|LIMITED|SOLUTIONS|SOLUTION|INCORPORATED|INC)\b/g, "")
    .replace(/[^A-Z0-9]/g, "")
    .trim();
}

// ── Classification Engine ───────────────────────────────────────────────────────

export function classifyMatch(
  bankTxn: {
    amount: number;
    date: Date;
    description: string;
    referenceId: string;
    counterparty?: string;
    currency?: string;
    baseCurrency?: string;
    convertedAmountMinor?: number;
    matchingSignals?: any;
  },
  ledgerEntries: {
    amount: number;
    date: Date;
    memo: string;
    invoiceRef: string;
    counterparty?: string;
    currency?: string;
    baseCurrency?: string;
    convertedAmountMinor?: number;
    matchingSignals?: any;
  }[],
  matchType: string,
  reasons: { reason: string; points: number }[] = [],
  allBankTxns?: { amount: number; date: Date; description: string; referenceId: string; counterparty?: string }[],
  totalScore?: number
): ClassificationResult {
  // ── Determine Outcome ──────────────────────────────────────────────────────
  // "unmatched_ledger" represents a ledger entry with no corresponding bank
  // transaction. Route it to the UNMATCHED path alongside "none".
  let matchOutcome: MatchOutcome = "MATCHED";
  if (ledgerEntries.length === 0 || matchType === "none" || matchType === "unmatched" || matchType === "unmatched_ledger") {
    matchOutcome = "UNMATCHED";
  } else if (matchType === "partial_payment") {
    // Overpayment and advance payment both result in both sides being fully
    // consumed; only a genuine underpayment remains PARTIALLY_MATCHED.
    const hasOverpayment = reasons.some(r => r.reason === "overpayment_detected" || r.reason === "advance_payment_detected");
    matchOutcome = hasOverpayment ? "MATCHED" : "PARTIALLY_MATCHED";
  }

  // ── Confidence band ────────────────────────────────────────────────────────
  let confidenceBand: "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW" | "NONE" = "NONE";
  let confidence = 0.0;

  if (matchOutcome !== "UNMATCHED") {
    const finalTotalScore = totalScore !== undefined ? totalScore : reasons.reduce((sum, r) => sum + r.points, 0);
    confidenceBand = getConfidenceBand(finalTotalScore);
    if (confidenceBand === "VERY_HIGH") confidence = 0.99;
    else if (confidenceBand === "HIGH") confidence = 0.85;
    else if (confidenceBand === "MEDIUM") confidence = 0.70;
    else confidence = 0.40;
  }

  const evidence: ClassificationEvidence[] = [];

  // ── 1. UNMATCHED CASES ─────────────────────────────────────────────────────
  if (matchOutcome === "UNMATCHED") {
    const fullText = `${bankTxn.description} ${bankTxn.referenceId}`.toLowerCase();

    // DUPLICATE Exception
    let isDuplicate = false;
    if (fullText.includes("duplicate") || fullText.includes("dup payment") || fullText.includes("paid twice")) {
      isDuplicate = true;
      evidence.push({
        code: "DUPLICATE_PAYMENT_ROW",
        message: "Narration explicitly flags transaction as duplicate payment.",
      });
    } else if (allBankTxns) {
      // Find other bank transactions with same date, amount, and desc/ref
      const matchesSiblings = allBankTxns.filter(
        (t) =>
          t.amount === bankTxn.amount &&
          Math.abs(t.date.getTime() - bankTxn.date.getTime()) < 1000 * 60 * 60 && // within same hour
          t.description === bankTxn.description &&
          t.referenceId === bankTxn.referenceId
      );
      if (matchesSiblings.length > 1) {
        isDuplicate = true;
        evidence.push({
          code: "DUPLICATE_PAYMENT_ROW",
          message: `Identical duplicate bank transaction detected in the statement for amount ${bankTxn.amount / 100}.`,
        });
      }
    }

    if (isDuplicate) {
      return {
        matchOutcome: "UNMATCHED",
        discrepancyType: "DUPLICATE",
        confidenceBand: "VERY_HIGH",
        confidence: 1.0,
        evidence,
      };
    }

    // DUPLICATE INVOICE EXCEPTION
    if (ledgerEntries && ledgerEntries.length > 1) {
      const uniqueInvoices = new Set(ledgerEntries.map(l => l.invoiceRef));
      if (uniqueInvoices.size < ledgerEntries.length && ledgerEntries.some(l => l.invoiceRef)) {
          evidence.push({
            code: "DUPLICATE_INVOICE_DETECTED",
            message: "Multiple identical invoices found in ledger for the same bank transaction."
          });
          return {
            matchOutcome: "UNMATCHED",
            discrepancyType: "DUPLICATE_INVOICE",
            confidenceBand: "HIGH",
            confidence: 0.90,
            evidence
          };
      }
    }

    // MISSING ENTRY Exception
    const invoiceRegex = /\b(INV|BILL|JE)-\d+\b/i;
    const refMatch = fullText.match(invoiceRegex);
    if (refMatch || fullText.includes("missing book") || fullText.includes("outstanding invoice")) {
      evidence.push({
        code: "MISSING_INVOICE_REF",
        message: `References missing ledger invoice number: ${refMatch ? refMatch[0].toUpperCase() : "N/A"}.`,
      });
      return {
        matchOutcome: "UNMATCHED",
        discrepancyType: "MISSING_ENTRY",
        confidenceBand: "HIGH",
        confidence: 1.0,
        evidence,
      };
    }

    // Default Unmatched operating expense
    evidence.push({
      code: "OPERATING_EXPENSE",
      message: "Operating transaction or interest payment with no invoice counterpart.",
    });
    return {
      matchOutcome: "UNMATCHED",
      discrepancyType: "NONE",
      confidenceBand: "NONE",
      confidence: 0.0,
      evidence,
    };
  }

  // ── 2. MATCHED OR PARTIALLY_MATCHED CASES ─────────────────────────────────
  if (ledgerEntries.length === 0) {
      // Defensive guard
      return {
          matchOutcome: "UNMATCHED",
          discrepancyType: "NONE",
          confidenceBand: "NONE",
          confidence: 0,
          evidence: []
      };
  }

  // UTR EXACT MATCH — deterministic, no further discrepancy checks needed
  if (matchType === "utr_exact") {
    evidence.push({
      code: "UTR_EXACT_MATCH",
      message: "UTR (Unique Transaction Reference) matched exactly — RBI-mandated unique identifier confirms ground-truth reconciliation.",
    });
    return {
      matchOutcome: "MATCHED",
      discrepancyType: "NONE",
      confidenceBand,
      confidence,
      evidence,
    };
  }

  const bankAmt = bankTxn.amount;
  const ledgerSum = ledgerEntries.reduce((sum, l) => sum + l.amount, 0);

  // Check FOREIGN_EXCHANGE (Currencies differ, check converted amounts)
  const currenciesDiffer = bankTxn.currency && ledgerEntries[0]?.currency && bankTxn.currency !== ledgerEntries[0].currency;
  if (matchType === "fx_difference" || currenciesDiffer) {
    const convBank = bankTxn.convertedAmountMinor ?? bankTxn.amount;
    const convLedgerSum = ledgerEntries.reduce((sum, l) => sum + (l.convertedAmountMinor ?? l.amount), 0);
    const absDiff = Math.abs(convBank - convLedgerSum);

    if (matchType === "fx_difference" || absDiff <= 100) {
      evidence.push({
        code: "FX_CONVERSION_STABLE",
        message: `Foreign exchange discrepancy handled (difference of ${absDiff} paise).`,
      });
      return {
        matchOutcome,
        discrepancyType: "FOREIGN_EXCHANGE",
        confidenceBand,
        confidence,
        evidence,
      };
    }
  }

  // Check PROCESSING_FEE (incl. TDS)
  if (matchType === "fee_adjustment" || matchesProcessorFee(bankAmt, ledgerSum)) {
    const feeDiff = ledgerSum - bankAmt;
    const ratePct = ((feeDiff / ledgerSum) * 100).toFixed(2);
    const isStripe = bankTxn.description.toUpperCase().includes("STRIPE");
    const isRazorpay = bankTxn.description.toUpperCase().includes("RAZORPAY");

    if (isStripe) {
      evidence.push({
        code: "STRIPE_FEE_FORMULA",
        message: `Discrepancy of ${feeDiff} paise (${ratePct}%) matches standard payment processor fee formula.`,
      });
    } else if (isRazorpay) {
      evidence.push({
        code: "RAZORPAY_FEE_FORMULA",
        message: `Discrepancy of ${feeDiff} paise (${ratePct}%) matches standard payment processor fee formula.`,
      });
    } else {
      const tdsRule = detectTdsDeduction(bankAmt, ledgerSum);
      if (tdsRule) {
        evidence.push({
          code: "TDS_DEDUCTION",
          message: `${tdsRule.description}: deduction of ${feeDiff} paise (${ratePct}%) on gross amount of ${ledgerSum / 100}.`,
        });
      } else {
        evidence.push({
          code: "GENERIC_PROCESSING_FEE",
          message: `Discrepancy of ${feeDiff} paise (${ratePct}%) matches standard payment processor fee formula.`,
        });
      }
    }
    return {
      matchOutcome,
      discrepancyType: "PROCESSING_FEE",
      confidenceBand,
      confidence,
      evidence,
    };
  }

  // Check OVERPAYMENT / ADVANCE_PAYMENT
  // Signalled by the engine via reasons when bank > book remaining amount.
  if (reasons.some(r => r.reason === "overpayment_detected")) {
    const excess = bankAmt - ledgerSum;
    evidence.push({
      code: "OVERPAYMENT_DETECTED",
      message: `Bank payment of ${bankAmt / 100} exceeds invoice balance of ${ledgerSum / 100} by ${excess / 100}. Excess amount requires accountant review.`,
    });
    return {
      matchOutcome: "MATCHED",
      discrepancyType: "AMOUNT_DIFFERENCE",
      confidenceBand,
      confidence,
      evidence,
    };
  }

  if (reasons.some(r => r.reason === "advance_payment_detected")) {
    const excess = bankAmt - ledgerSum;
    evidence.push({
      code: "ADVANCE_PAYMENT_DETECTED",
      message: `Bank payment of ${bankAmt / 100} exceeds the full invoice amount of ${ledgerSum / 100} by ${excess / 100}. Likely an advance or prepayment — requires accountant review.`,
    });
    return {
      matchOutcome: "MATCHED",
      discrepancyType: "AMOUNT_DIFFERENCE",
      confidenceBand,
      confidence,
      evidence,
    };
  }

  // Check PARTIALLY_MATCHED (genuine underpayment, bank < book)
  if (matchOutcome === "PARTIALLY_MATCHED") {
    evidence.push({
      code: "PARTIAL_PAYMENT_CONFIRMED",
      message: `Bank payment satisfies only a portion of the ledger invoice (paid ${bankAmt / 100} of ${ledgerSum / 100}).`,
    });
    return {
      matchOutcome: "PARTIALLY_MATCHED",
      discrepancyType: "AMOUNT_DIFFERENCE",
      confidenceBand,
      confidence,
      evidence,
    };
  }

  // ── Issue 6: TIMING_DIFFERENCE check runs BEFORE TYPO check ───────────────
  // Timing differences are structural realities of bank settlement; typos are
  // metadata quality issues. When both exist, the timing difference is the
  // primary accounting discrepancy.

  // Check TIMING_DIFFERENCE first
  if (matchType !== "exact") {
    const dateDiff = Math.abs(bankTxn.date.getTime() - ledgerEntries[0].date.getTime()) / (1000 * 60 * 60 * 24);
    if (dateDiff > 1.0 && Math.abs(bankAmt - ledgerSum) <= 100) {
      evidence.push({
        code: "TIMING_LAG_DETECTED",
        message: `Amount matches exactly, but transaction date is delayed by ${Math.floor(dateDiff)} days.`,
      });
      return {
        matchOutcome,
        discrepancyType: "TIMING_DIFFERENCE",
        confidenceBand,
        confidence,
        evidence,
      };
    }
  }

  // Check TYPO & REFERENCE/COUNTERPARTY MISMATCH (after timing)
  if (matchType !== "exact") {
    let isTypo = false;

    // Check ref digit transpositions
    const bankRef = bankTxn.referenceId || "";
    const bookRef = ledgerEntries[0]?.invoiceRef || "";
    const bankSignals = bankTxn.matchingSignals || {};
    const bookSignals = ledgerEntries[0]?.matchingSignals || {};
    const bankInv = bankSignals.invoiceNumber || "";
    const bookInv = bookSignals.invoiceNumber || "";

    if ((bankRef && bookRef && isDigitTransposition(bankRef, bookRef)) ||
        (bankInv && bookInv && isDigitTransposition(bankInv, bookInv))) {
      isTypo = true;
      const displayBank = bankInv || bankRef;
      const displayBook = bookInv || bookRef;
      evidence.push({
        code: "REFERENCE_TRANSPOSITION",
        message: `Reference digit transposition typo detected: bank shows '${displayBank}', book shows '${displayBook}'.`,
      });
    }

    // Check name spelling edit distance
    const bankName = bankTxn.counterparty || "";
    const bookName = ledgerEntries[0]?.counterparty || "";
    let isCounterpartyMismatch = false;

    if (bankName && bookName) {
      const cn1 = cleanNameForTypo(bankName);
      const cn2 = cleanNameForTypo(bookName);
      if (cn1 && cn2 && cn1 !== cn2) {
        const distance = getEditDistance(cn1, cn2);
        if (distance <= 2) {
          isTypo = true;
          evidence.push({
            code: "NAME_SPELLING_TYPO",
            message: `Slight spelling typo detected in counterparty name: '${bankName}' vs '${bookName}'.`,
          });
        } else {
          isCounterpartyMismatch = true;
        }
      }
    }

    if (isTypo) {
      return {
        matchOutcome,
        discrepancyType: "TYPO",
        confidenceBand,
        confidence,
        evidence,
      };
    }

    if (isCounterpartyMismatch) {
        evidence.push({
            code: "COUNTERPARTY_MISMATCH",
            message: `Counterparty mismatch beyond typo: '${bankName}' vs '${bookName}'.`,
        });
        return {
            matchOutcome,
            discrepancyType: "COUNTERPARTY_DIFFERENCE",
            confidenceBand,
            confidence,
            evidence
        };
    }

    if (bankRef && bookRef && bankRef !== bookRef && !bankRef.includes(bookRef) && !bookRef.includes(bankRef)) {
         evidence.push({
            code: "REFERENCE_MISMATCH",
            message: `Invoice references differ completely: '${bankRef}' vs '${bookRef}'.`,
        });
        return {
            matchOutcome,
            discrepancyType: "REFERENCE_DIFFERENCE",
            confidenceBand,
            confidence,
            evidence
        };
    }
  }

  // Check AMOUNT_DIFFERENCE for non-fee, non-FX matches that aren't partial payments
  if (Math.abs(bankAmt - ledgerSum) > 100) {
      evidence.push({
          code: "AMOUNT_SHORTFALL",
          message: `Amount discrepancy of ${Math.abs(bankAmt - ledgerSum)} paise not explained by fee or FX.`,
      });
      return {
          matchOutcome,
          discrepancyType: "AMOUNT_DIFFERENCE",
          confidenceBand,
          confidence,
          evidence
      };
  }

  // Check LOW CONFIDENCE / MANUAL REVIEW
  if (confidenceBand === "LOW") {
      evidence.push({
          code: "MANUAL_REVIEW_REQUIRED",
          message: "Match confidence is low. Requires manual accountant review.",
      });
      return {
          matchOutcome,
          discrepancyType: "MANUAL_REVIEW",
          confidenceBand,
          confidence,
          evidence
      };
  }

  // Default clean exact match
  evidence.push({
    code: "MATCHED_EXACT_CLEAN",
    message: "Amount, date, and reference match exactly with no discrepancies.",
  });
  return {
    matchOutcome: "MATCHED",
    discrepancyType: "NONE",
    confidenceBand,
    confidence,
    evidence,
  };
}
