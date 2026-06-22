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
  const source = (txn.matchingSignals?.source || "").toLowerCase();
  if (source === "stripe") return true;

  const channel = (txn.matchingSignals?.channel || "").toUpperCase();
  if (channel === "STRIPE") return true;

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
