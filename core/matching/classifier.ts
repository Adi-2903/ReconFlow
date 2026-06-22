// core/matching/classifier.ts

export type MatchOutcome = "MATCHED" | "PARTIALLY_MATCHED" | "UNMATCHED";

export type DiscrepancyType =
  | "NONE"
  | "TIMING_DIFFERENCE"
  | "PROCESSING_FEE"
  | "FOREIGN_EXCHANGE"
  | "TYPO"
  | "DUPLICATE"
  | "MISSING_ENTRY";

export type ClassificationEvidenceCode =
  | "STRIPE_FEE_FORMULA"
  | "RAZORPAY_FEE_FORMULA"
  | "FX_CONVERSION_STABLE"
  | "TIMING_LAG_DETECTED"
  | "REFERENCE_TRANSPOSITION"
  | "NAME_SPELLING_TYPO"
  | "DUPLICATE_PAYMENT_ROW"
  | "MISSING_INVOICE_REF"
  | "OPERATING_EXPENSE";

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

// ── Helpers for typo and similarity checks ──────────────────────────────────────

function getEditDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function isDigitTransposition(s1: string, s2: string): boolean {
  const d1 = s1.replace(/\D/g, "");
  const d2 = s2.replace(/\D/g, "");
  if (!d1 || !d2 || d1.length !== d2.length) return false;
  if (d1 === d2) return false;

  const diffIndices: number[] = [];
  for (let i = 0; i < d1.length; i++) {
    if (d1[i] !== d2[i]) {
      diffIndices.push(i);
    }
  }

  if (diffIndices.length === 2) {
    const [i, j] = diffIndices;
    if (j === i + 1) { // adjacent transposition
      return d1[i] === d2[j] && d1[j] === d2[i];
    }
  }
  return false;
}

function cleanNameForTypo(name?: string): string {
  if (!name) return "";
  return name
    .toUpperCase()
    .replace(/\b(CORPORATION|CORP|PVT|PRIVATE|LTD|LIMITED|SOLUTIONS|SOLUTION|INCORPORATED|INC)\b/g, "")
    .replace(/[^A-Z0-9]/g, "")
    .trim();
}

function matchesFeeFormula(bankAmt: number, ledgerAmt: number): boolean {
  const diff = ledgerAmt - bankAmt;
  if (diff <= 0) return false;

  // 1. Stripe INR: 2.9% + 2500 paise (Rs. 25)
  const expectedStripeINR = Math.round(ledgerAmt * 0.029) + 2500;
  if (Math.abs(diff - expectedStripeINR) <= 100) return true;

  // 2. Stripe USD: 2.9% + 3000 cents/paise ($0.30)
  const expectedStripeUSD = Math.round(ledgerAmt * 0.029) + 3000;
  if (Math.abs(diff - expectedStripeUSD) <= 100) return true;

  // 3. Razorpay / generic percentages (2%, 3%, 1.18%, 2.36%, 3.776%, 4.72%)
  const commonRates = [0.0118, 0.0236, 0.03776, 0.0472, 0.02, 0.029, 0.03];
  for (const rate of commonRates) {
    const expectedFee = Math.round(ledgerAmt * rate);
    if (Math.abs(diff - expectedFee) <= 100) return true;
  }

  return false;
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
  allBankTxns?: { amount: number; date: Date; description: string; referenceId: string; counterparty?: string }[]
): ClassificationResult {
  // Determine Outcome
  let matchOutcome: MatchOutcome = "MATCHED";
  if (ledgerEntries.length === 0 || matchType === "none" || matchType === "unmatched") {
    matchOutcome = "UNMATCHED";
  } else if (matchType === "partial_payment") {
    matchOutcome = "PARTIALLY_MATCHED";
  }

  // Mapped confidence and band
  let confidenceBand: "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW" | "NONE" = "NONE";
  let confidence = 0.0;

  if (matchOutcome !== "UNMATCHED") {
    const totalScore = reasons.reduce((sum, r) => sum + r.points, 0);
    if (totalScore >= 120) {
      confidenceBand = "VERY_HIGH";
      confidence = 0.99;
    } else if (totalScore >= 80) {
      confidenceBand = "HIGH";
      confidence = 0.85;
    } else if (totalScore >= 50) {
      confidenceBand = "MEDIUM";
      confidence = 0.70;
    } else {
      confidenceBand = "LOW";
      confidence = 0.40;
    }
  }

  const evidence: ClassificationEvidence[] = [];

  // 1. UNMATCHED CASES
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
        // If there are duplicates, check if one of the siblings is matched
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

  // 2. MATCHED OR PARTIALLY_MATCHED CASES

  const bankAmt = bankTxn.amount;
  const ledgerSum = ledgerEntries.reduce((sum, l) => sum + l.amount, 0);

  // Check FOREIGN_EXCHANGE (Currencies differ, check converted amounts)
  const currenciesDiffer = bankTxn.currency && ledgerEntries[0]?.currency && bankTxn.currency !== ledgerEntries[0].currency;
  if (currenciesDiffer) {
    const convBank = bankTxn.convertedAmountMinor ?? bankTxn.amount;
    const convLedgerSum = ledgerEntries.reduce((sum, l) => sum + (l.convertedAmountMinor ?? l.amount), 0);
    const absDiff = Math.abs(convBank - convLedgerSum);

    if (absDiff <= 100) {
      evidence.push({
        code: "FX_CONVERSION_STABLE",
        message: `Base currency conversion matches exactly (difference of ${absDiff} paise <= 100 paise limit).`,
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

  // Check PROCESSING_FEE
  if (matchType === "fee_adjustment" || matchesFeeFormula(bankAmt, ledgerSum)) {
    const feeDiff = ledgerSum - bankAmt;
    const ratePct = ((feeDiff / ledgerSum) * 100).toFixed(2);
    evidence.push({
      code: bankTxn.description.toUpperCase().includes("STRIPE") ? "STRIPE_FEE_FORMULA" : "RAZORPAY_FEE_FORMULA",
      message: `Discrepancy of ${feeDiff} paise (${ratePct}%) matches standard payment processor fee formula.`,
    });
    return {
      matchOutcome,
      discrepancyType: "PROCESSING_FEE",
      confidenceBand,
      confidence,
      evidence,
    };
  }

  // Check PARTIALLY_MATCHED
  if (matchOutcome === "PARTIALLY_MATCHED") {
    evidence.push({
      code: "MISSING_INVOICE_REF", // Reuse/suitable fallback
      message: `Bank payment satisfies only a portion of the ledger invoice (paid ${bankAmt / 100} of ${ledgerSum / 100}).`,
    });
    return {
      matchOutcome: "PARTIALLY_MATCHED",
      discrepancyType: "NONE", // User requested outcome PARTIALLY_MATCHED, discrepancyType: NONE (unless other applies)
      confidenceBand,
      confidence,
      evidence,
    };
  }

  // Check TYPO
  if (matchType !== "exact") {
    let isTypo = false;

    // Check ref digit transpositions
    const bankRef = bankTxn.referenceId || "";
    const bookRef = ledgerEntries[0]?.invoiceRef || "";
    if (bankRef && bookRef && isDigitTransposition(bankRef, bookRef)) {
      isTypo = true;
      evidence.push({
        code: "REFERENCE_TRANSPOSITION",
        message: `Reference digit transposition typo detected: bank shows '${bankRef}', book shows '${bookRef}'.`,
      });
    }

    // Check name spelling edit distance
    const bankName = bankTxn.counterparty || "";
    const bookName = ledgerEntries[0]?.counterparty || "";
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
  }

  // Check TIMING_DIFFERENCE
  // Compute max date difference
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

  // Default clean exact match
  evidence.push({
    code: "FX_CONVERSION_STABLE", // Fallback code representing stable clean match
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
