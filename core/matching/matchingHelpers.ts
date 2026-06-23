// core/matching/matchingHelpers.ts
//
// Shared domain predicates used by both engine.ts (core) and
// candidateGenerator.ts / runMatcher.ts (TestingFolder).
//
// Keep this file free of side-effects and engine-specific imports.
// All functions are pure and synchronous.

/**
 * Returns true when a bank transaction narration indicates a Stripe
 * payout or transfer settlement.
 *
 * Used in Pass 3A of both engine implementations to bypass the
 * counterparty/ref similarity gate and let the combo fee formula
 * validate the match instead.
 *
 * Checks (in priority order):
 *   1. matchingSignals.source === "stripe"   (most reliable — set by ingestion)
 *   2. matchingSignals.channel === "STRIPE"  (channel tag)
 *   3. description contains "stripe payout" or "stripe transfer" (narration keyword)
 */
export function isStripePayoutTransaction(txn: {
  description?: string;
  matchingSignals?: { channel?: string; source?: string };
}): boolean {
  // 1. Most reliable — set by ingestion pipeline
  const source = (txn.matchingSignals?.source || "").toLowerCase();
  if (source === "stripe") return true;

  // 2. Channel tag
  const channel = (txn.matchingSignals?.channel || "").toUpperCase();
  if (channel === "STRIPE") return true;

  // 3. Description — must include "stripe" qualifier to avoid false positives
  const desc = (txn.description || "").toLowerCase();
  return desc.includes("stripe payout") || desc.includes("stripe transfer");
}

/**
 * Returns true when both sides carry a non-empty reference and the
 * references do not match each other.
 *
 * When this returns true, name-only matching is insufficient to
 * disambiguate candidates — a score penalty should be applied so the
 * candidate falls through to later, more permissive passes rather than
 * winning Pass 1 on counterparty alone.
 *
 * @param bankRef   - The bank transaction's reference ID / narration ref
 * @param bookRef   - The ledger entry's invoice reference
 * @param refMatches - Result of referenceMatches(bankRef, bookRef) —
 *                     pass it in rather than recomputing to stay consistent
 *                     with the caller's normalization logic.
 */
export function hasReferenceConflict(
  bankRef: string | undefined,
  bookRef: string | undefined,
  refMatches: boolean
): boolean {
  const bankPresent = !!(bankRef || "").trim();
  const bookPresent = !!(bookRef || "").trim();
  return bankPresent && bookPresent && !refMatches;
}

export function getConfidenceBand(score: number): "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW" | "NONE" {
  if (score >= 150) return "VERY_HIGH";
  if (score >= 100) return "HIGH";
  if (score >= 60) return "MEDIUM";
  if (score > 0) return "LOW";
  return "NONE";
}

/**
 * Canonical inverse of getConfidenceBand.
 * Maps a confidence band back to a representative 0.0–1.0 confidence float.
 * Use this wherever a numeric confidence is derived from a raw score to avoid
 * each phase re-encoding its own ternary chain.
 */
export function bandToConfidence(
  band: "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW" | "NONE"
): number {
  switch (band) {
    case "VERY_HIGH": return 0.99;
    case "HIGH":      return 0.85;
    case "MEDIUM":    return 0.70;
    case "LOW":       return 0.40;
    default:          return 0.0; // NONE / unmatched
  }
}

export function getEditDistance(a: string, b: string): number {
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

export function isDigitTransposition(s1: string, s2: string): boolean {
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
