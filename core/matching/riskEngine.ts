// core/matching/riskEngine.ts
//
// Phase 8 — Risk Scoring Engine
//
// Pure, side-effect-free module. No DB access. Fully unit-testable.
// Production guardrails baked in:
//   1. compositeScore is Math.round()ed before returning — safe for integer DB columns.
//   2. Empty frequency key (blank description + counterparty) forces occurrences = 1,
//      so all-empty CSV rows are flagged as anomalous rather than silently recurring.
//   3. Age calculation uses Math.floor() after normalising both timestamps to
//      midnight UTC, preventing timezone drift from bumping transactions into
//      the next age band prematurely.
//   4. amountMinor is Math.abs()ed before use — debit transactions may carry negative
//      values; without this guard Math.log10 returns -Infinity and the composite
//      score becomes NaN, which corrupts the integer DB column.
//   5. allBankDescriptions and allBankCounterparties must be the same length when
//      both are non-empty. A length mismatch emits a console.warn and falls back
//      to descriptions-only to prevent silent undefined coercions.

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface RiskScoreBreakdown {
  amountScore: number;           // 0 – 100
  ageScore: number;              // 0 – 100
  confidenceRiskScore: number;   // 0 – 100  = (1 - matchingConfidence) × 100
  frequencyScore: number;        // 0 – 100
  classificationScore: number;   // 0 – 100
  compositeScore: number;        // 0 – 100  integer (Math.round applied)
}

export interface RiskInput {
  /** Bank transaction amount in paise (minor units). */
  amountMinor: number;
  /** Matching engine confidence: 0.0 – 1.0. */
  matchingConfidence: number;
  /** Match type produced by the engine (e.g. "exact", "none", "partial_payment"). */
  matchType: string;
  /** Phase 7 discrepancy classification. */
  discrepancyType: string;
  /** Date of the bank transaction. */
  bankDate: Date;
  /**
   * Dates of matched ledger entries.
   * Empty array for unmatched bank transactions — age is then measured against today.
   */
  ledgerDates: Date[];
  /**
   * All bank-side descriptions in the current reconciliation run.
   * Pass empty array during historical backfill (Option B — frequencyScore will be 0).
   */
  allBankDescriptions: string[];
  /**
   * All bank-side counterparty names in the current reconciliation run.
   * Pass empty array during historical backfill.
   */
  allBankCounterparties: string[];
  /** Description of the transaction being scored. */
  thisBankDescription: string;
  /** Counterparty of the transaction being scored. */
  thisBankCounterparty?: string;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Normalises a string to a stable lowercase token for frequency grouping.
 * Uses the full cleaned string (not just the first word) to avoid cross-
 * counterparty collisions such as "AXIS BANK" vs "AXIS FINANCE" collapsing
 * to the same key "axis".
 * Returns "" for fully blank input.
 */
function normalizeFrequencyKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Converts a Date to midnight UTC in milliseconds.
 * Guards against timezone drift in age calculations.
 */
function toMidnightUTC(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// ── Factor calculators ────────────────────────────────────────────────────────

/**
 * Factor 1 — Amount Score (25% weight). Logarithmic scale to prevent cliffs.
 * Guardrail: Math.abs() is applied first — debit transactions may carry negative
 * amountMinor values. Without this, Math.log10 would return -Infinity (or NaN
 * for amountMinor = -100), corrupting the composite score and the DB column.
 */
function computeAmountScore(amountMinor: number): number {
  const amountInRupees = Math.abs(amountMinor) / 100;
  return Math.min(100, Math.log10(amountInRupees + 1) * 20);
}

/**
 * Factor 2 — Age Score (20% weight).
 * For matched transactions: max lag between bankDate and any ledger date.
 * For unmatched transactions: today − bankDate.
 * Both sides are normalised to midnight UTC to prevent timezone bleed.
 */
function computeAgeScore(bankDate: Date, ledgerDates: Date[]): number {
  const bankMidnight = toMidnightUTC(bankDate);

  let maxDayDiff: number;
  if (ledgerDates.length > 0) {
    maxDayDiff = Math.max(
      ...ledgerDates.map((d) =>
        Math.floor(Math.abs(toMidnightUTC(d) - bankMidnight) / (1000 * 60 * 60 * 24))
      )
    );
  } else {
    // Unmatched — measure against today at midnight UTC
    const todayMidnight = Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate()
    );
    maxDayDiff = Math.floor(Math.abs(todayMidnight - bankMidnight) / (1000 * 60 * 60 * 24));
  }

  if (maxDayDiff <= 1)  return 0;
  if (maxDayDiff <= 7)  return 20;
  if (maxDayDiff <= 30) return 60;
  return 100;
}

/**
 * Factor 3 — Confidence Risk Score (25% weight).
 * Inverted: high matching confidence → low risk.
 */
function computeConfidenceRiskScore(matchingConfidence: number): number {
  return (1.0 - Math.max(0, Math.min(1, matchingConfidence))) * 100;
}

/**
 * Factor 4 — Frequency Score (10% weight).
 * Anomaly-based: compares this transaction's normalised counterparty/description
 * key against all keys in the current reconciliation run.
 *
 * Production guardrail: if the key normalises to "" (blank description AND
 * blank counterparty), force occurrences = 1 so empty CSV rows are flagged
 * as anomalous rather than silently grouped as "recurring".
 *
 * Backfill note: pass empty allBankDescriptions + allBankCounterparties to
 * force frequencyScore = 0 (Option B strategy) for historical rows.
 */
function computeFrequencyScore(
  thisBankDescription: string,
  thisBankCounterparty: string | undefined,
  allBankDescriptions: string[],
  allBankCounterparties: string[]
): number {
  // Backfill fast-path: no run population available — return 0 (neutral)
  if (allBankDescriptions.length === 0 && allBankCounterparties.length === 0) {
    return 0;
  }

  // Guardrail: warn on array length mismatch to prevent silent undefined coercions.
  // When both arrays are non-empty they must be parallel (same index = same transaction).
  if (
    allBankCounterparties.length > 0 &&
    allBankDescriptions.length > 0 &&
    allBankCounterparties.length !== allBankDescriptions.length
  ) {
    console.warn(
      `[riskEngine] allBankCounterparties.length (${allBankCounterparties.length}) ` +
      `!== allBankDescriptions.length (${allBankDescriptions.length}). ` +
      "Falling back to descriptions-only for frequency scoring."
    );
    // Fall back to descriptions-only to avoid undefined[i] coercions
    const fallbackKeys = allBankDescriptions.map((d) => normalizeFrequencyKey(d));
    const fallbackKey = normalizeFrequencyKey(thisBankDescription);
    if (fallbackKey === "") return 80;
    const fallbackOccurrences = fallbackKeys.filter((k) => k === fallbackKey).length;
    if (fallbackOccurrences >= 5) return 0;
    if (fallbackOccurrences >= 3) return 20;
    if (fallbackOccurrences >= 2) return 50;
    return 80;
  }

  const key = normalizeFrequencyKey(thisBankCounterparty || thisBankDescription);

  // Guardrail: blank rows are unique, not recurring
  if (key === "") {
    return 80;
  }

  // Build population keys. Prefer counterparty (more stable identifier) when available;
  // fall back to description for entries with no counterparty.
  const allKeys = allBankCounterparties.length > 0
    ? allBankCounterparties.map((cp, i) =>
        normalizeFrequencyKey((cp || allBankDescriptions[i]) ?? "")
      )
    : allBankDescriptions.map((d) => normalizeFrequencyKey(d));

  const occurrences = allKeys.filter((k) => k === key).length;

  if (occurrences >= 5) return 0;   // Recurring — low risk
  if (occurrences >= 3) return 20;
  if (occurrences >= 2) return 50;
  return 80;                         // Unique — anomalous
}

/**
 * Factor 5 — Classification Score (20% weight).
 * Directly consumes Phase 7 discrepancyType output.
 *
 * All DiscrepancyType variants emitted by classifier.ts are explicitly mapped.
 * No variant falls to the default — prevents silently under-scoring high-risk
 * matches such as MANUAL_REVIEW or DUPLICATE_INVOICE.
 *
 * Risk semantics:
 *   NONE / low-risk clean matches                    →  0
 *   PROCESSING_FEE  (known, explainable deduction)   → 20
 *   TIMING_DIFFERENCE (structural bank lag)          → 30
 *   FOREIGN_EXCHANGE (rate slippage)                 → 40
 *   AMOUNT_DIFFERENCE (unexplained shortfall)        → 50
 *   TYPO (data quality issue)                        → 50
 *   REFERENCE_DIFFERENCE (ref mismatch)              → 55
 *   COUNTERPARTY_DIFFERENCE (name mismatch)          → 60
 *   MANUAL_REVIEW (low confidence, human needed)     → 70
 *   DUPLICATE_INVOICE (invoice collision in ledger)  → 75
 *   DUPLICATE (double payment on bank side)          → 80
 *   MISSING_ENTRY (no ledger counterpart at all)     → 100
 */
function computeClassificationScore(discrepancyType: string): number {
  switch (discrepancyType) {
    case "NONE":                     return 0;
    case "PROCESSING_FEE":           return 20;
    case "TIMING_DIFFERENCE":        return 30;
    case "FOREIGN_EXCHANGE":         return 40;
    case "AMOUNT_DIFFERENCE":        return 50;
    case "TYPO":                     return 50;
    case "REFERENCE_DIFFERENCE":     return 55;
    case "COUNTERPARTY_DIFFERENCE":  return 60;
    case "MANUAL_REVIEW":            return 70;
    case "DUPLICATE_INVOICE":        return 75;
    case "DUPLICATE":                return 80;
    case "MISSING_ENTRY":            return 100;
    default:
      // Unknown future type — emit a warning so it surfaces in logs rather than
      // silently scoring 0 and masking a potential integration gap.
      console.warn(`[riskEngine] Unknown discrepancyType "${discrepancyType}" — defaulting classification score to 50 (medium risk).`);
      return 50;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Computes the composite risk score (0 – 100) for a single match.
 *
 * Weights:
 *   Amount               25%
 *   Age                  20%
 *   Confidence Risk      25%
 *   Frequency Anomaly    10%
 *   Classification       20%
 *
 * compositeScore is always an integer (Math.round) — safe for integer DB columns.
 */
export function computeRiskScore(input: RiskInput): RiskScoreBreakdown {
  const amountScore         = computeAmountScore(input.amountMinor);
  const ageScore            = computeAgeScore(input.bankDate, input.ledgerDates);
  const confidenceRiskScore = computeConfidenceRiskScore(input.matchingConfidence);
  const frequencyScore      = computeFrequencyScore(
    input.thisBankDescription,
    input.thisBankCounterparty,
    input.allBankDescriptions,
    input.allBankCounterparties
  );
  const classificationScore = computeClassificationScore(input.discrepancyType);

  const raw =
    amountScore         * 0.25 +
    ageScore            * 0.20 +
    confidenceRiskScore * 0.25 +
    frequencyScore      * 0.10 +
    classificationScore * 0.20;

  const compositeScore = Math.round(Math.max(0, Math.min(100, raw)));

  return {
    amountScore,
    ageScore,
    confidenceRiskScore,
    frequencyScore,
    classificationScore,
    compositeScore,
  };
}
