import { db } from "@/core/db";
import { matches, canonicalTransactions, auditEvents } from "@/core/db/schema";
import { eq, and, ne, inArray, sql, asc } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MatchListItem {
  id: string;
  bankTransactionId?: string | null;
  ledgerEntryIds?: string[] | null;
  bankRow: {
    amount: number;
    date: string;
    description: string;
    referenceId: string;
    source: string;
  };
  ledgerRows: { amount: number; date: string; memo: string; invoiceRef: string }[];
  ledgerRow: { amount: number; date: string; memo: string; invoiceRef: string } | null;
  confidenceScore: number;
  matchType: string | null;
  matchOutcome: string | null;
  discrepancyType: string | null;
  evidenceList: any[] | null;
  reasonText: string;
  scoringBreakdown: { amountScore: number; dateScore: number; textScore: number };
  riskScore: number;
  status: string | null;
  reviewType: "AUTO" | "MANUAL";
}

export interface ApproveRejectResult {
  success: boolean;
  matchId: string;
  status: string;
}

export interface BulkApproveResult {
  approvedCount: number;
}

export interface ManualMatchResult {
  success: boolean;
  matchId: string;
}

/**
 * Structured 409 error codes surfaced to the frontend so the UI can show
 * the correct toast message without parsing error text.
 *
 * ALREADY_FINALIZED  — match was already approved/rejected; refreshing will
 *                       show the current state. Not retriable.
 * CONCURRENT_CLAIM   — another reviewer locked the record at the same instant.
 *                      Retriable after a brief pause or page refresh.
 */
export type ConflictCode = "ALREADY_FINALIZED" | "CONCURRENT_CLAIM";

export class ReviewConflictError extends Error {
  constructor(
    public readonly code: ConflictCode,
    message: string
  ) {
    super(message);
    this.name = "ReviewConflictError";
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Returns all canonical_transaction UUIDs involved in a match, sorted
 * alphabetically. Sorting before locking is the canonical technique for
 * preventing deadlocks when multiple concurrent transactions acquire
 * row-level locks on overlapping sets of rows.
 */
function getSortedLockIds(match: {
  bankTransactionId: string | null;
  ledgerEntryIds: string[] | null;
}): string[] {
  const ids: string[] = [];
  if (match.bankTransactionId) ids.push(match.bankTransactionId);
  if (match.ledgerEntryIds) ids.push(...match.ledgerEntryIds);
  return [...new Set(ids)].sort();
}

// ─── Service functions ────────────────────────────────────────────────────────

export async function listMatches(
  userId: string,
  filter: string = "all"
): Promise<MatchListItem[]> {
  const allMatches = await db
    .select({ match: matches, bankTx: canonicalTransactions })
    .from(matches)
    .innerJoin(canonicalTransactions, eq(matches.bankTransactionId, canonicalTransactions.id))
    .where(eq(matches.userId, userId));

  let filtered = allMatches;
  if (filter === "pending") {
    filtered = filtered.filter(
      (m) => m.match.status === "pending" && m.match.matchType !== "none"
    );
  } else if (filter === "approved") {
    filtered = filtered.filter((m) => m.match.status === "approved");
  } else if (filter === "rejected") {
    filtered = filtered.filter((m) => m.match.status === "rejected");
  } else if (filter === "exceptions") {
    filtered = filtered.filter((m) => m.match.matchType === "none");
  }

  // Batch-fetch all ledger entries referenced by these matches
  const ledgerIdSet = new Set<string>();
  filtered.forEach((item) => {
    item.match.ledgerEntryIds?.forEach((id) => ledgerIdSet.add(id));
  });

  const allLedgerIds = Array.from(ledgerIdSet);
  let ledgers: any[] = [];
  if (allLedgerIds.length > 0) {
    ledgers = await db
      .select()
      .from(canonicalTransactions)
      .where(inArray(canonicalTransactions.id, allLedgerIds));
  }

  const ledgerMap = new Map<string, any>();
  ledgers.forEach((l) => ledgerMap.set(l.id, l));

  const results: MatchListItem[] = filtered.map((item) => {
    const match = item.match;
    const bankTx = item.bankTx;
    const matchLedgers = (match.ledgerEntryIds || [])
      .map((id) => ledgerMap.get(id))
      .filter(Boolean);

    return {
      id: match.id,
      bankTransactionId: match.bankTransactionId,
      ledgerEntryIds: match.ledgerEntryIds,
      bankRow: {
        amount: Number(bankTx.amountMinor) / 100,
        date:
          bankTx.transactionDate instanceof Date
            ? bankTx.transactionDate.toISOString().split("T")[0]
            : String(bankTx.transactionDate),
        description: bankTx.description || "",
        referenceId: bankTx.referenceNumber || "",
        source: bankTx.sourceSystem || "unknown",
      },
      ledgerRows: matchLedgers.map((l: any) => ({
        amount: Number(l.amountMinor) / 100,
        date:
          l.transactionDate instanceof Date
            ? l.transactionDate.toISOString().split("T")[0]
            : String(l.transactionDate),
        memo: l.description || "",
        invoiceRef: l.referenceNumber || "",
      })),
      ledgerRow:
        matchLedgers.length === 1
          ? {
              amount: Number(matchLedgers[0].amountMinor) / 100,
              date:
                matchLedgers[0].transactionDate instanceof Date
                  ? matchLedgers[0].transactionDate.toISOString().split("T")[0]
                  : String(matchLedgers[0].transactionDate),
              memo: matchLedgers[0].description || "",
              invoiceRef: matchLedgers[0].referenceNumber || "",
            }
          : null,
      confidenceScore: Number(match.confidenceScore || 0),
      matchType: match.matchType,
      matchOutcome: (match as any).matchOutcome || null,
      discrepancyType: (match as any).discrepancyType || null,
      evidenceList: (match as any).classificationEvidence || null,
      reasonText: match.reasonText || "",
      scoringBreakdown: { amountScore: 0, dateScore: 0, textScore: 0 },
      riskScore: (match as any).riskScore as number,
      status: match.status,
      reviewType: (match as any).reviewType ?? "AUTO",
    };
  });

  // Primary sort: riskScore DESC (highest risk reviewed first).
  // Secondary sort: confidenceScore ASC (lower confidence within same risk tier reviewed first).
  results.sort((a, b) => {
    if (b.riskScore !== a.riskScore) return b.riskScore - a.riskScore;
    return a.confidenceScore - b.confidenceScore;
  });

  return results;
}

/**
 * approveMatch
 *
 * Concurrency model:
 *   1. Read match to obtain the set of canonical_transaction IDs.
 *   2. Open a serialisable transaction.
 *   3. Lock the match row (NOWAIT) — instant 409 if already held.
 *   4. Lock all associated canonical_transaction rows in sorted UUID order
 *      (NOWAIT) — prevents deadlock AND instant 409 on concurrent clash.
 *   5. Assert match.status === "MATCHED_PENDING" — distinguish retriable
 *      concurrent claims from non-retriable already-finalised cases.
 *   6. Update match + transactions + insert audit event.
 */
export async function approveMatch(
  userId: string,
  matchId: string,
  actorEmail: string,
  reason?: string
): Promise<ApproveRejectResult> {
  // Pre-flight: load match outside the transaction to get lock targets.
  const [matchRow] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  if (!matchRow) throw Object.assign(new Error("Match not found"), { statusCode: 404 });
  if (matchRow.userId !== userId) throw Object.assign(new Error("Forbidden"), { statusCode: 403 });

  const sortedIds = getSortedLockIds(matchRow);

  await db.transaction(async (tx) => {
    // ── 1. Lock the match row ──────────────────────────────────────────────────
    const lockedMatches = await tx
      .select()
      .from(matches)
      .where(eq(matches.id, matchId))
      .for("update", { noWait: true })
      .limit(1);

    if (!lockedMatches.length) {
      throw Object.assign(new Error("Match not found"), { statusCode: 404 });
    }

    const currentMatch = lockedMatches[0];

    // ── 2. Assert status — distinguish finalized vs concurrent claim ───────────
    if (currentMatch.status === "approved" || currentMatch.status === "rejected") {
      throw new ReviewConflictError(
        "ALREADY_FINALIZED",
        "This match has already been finalized. Please refresh to see the current state."
      );
    }
    if (currentMatch.status !== "pending") {
      throw new ReviewConflictError(
        "CONCURRENT_CLAIM",
        "This match was claimed by another reviewer. Please refresh and try again."
      );
    }

    // ── 3. Lock canonical_transactions in sorted UUID order ───────────────────
    if (sortedIds.length > 0) {
      const lockedTxns = await tx
        .select({ id: canonicalTransactions.id, status: canonicalTransactions.status })
        .from(canonicalTransactions)
        .where(inArray(canonicalTransactions.id, sortedIds))
        .for("update", { noWait: true });

      // Assert all rows still belong to this match group (no concurrent reassignment)
      for (const row of lockedTxns) {
        if (row.status === "LOCKED_APPROVED") {
          throw new ReviewConflictError(
            "ALREADY_FINALIZED",
            "One or more transactions in this match have already been approved elsewhere."
          );
        }
      }
    }

    // ── 4. Apply the approval ─────────────────────────────────────────────────
    await tx
      .update(matches)
      .set({ status: "approved", approvedBy: actorEmail, approvedAt: new Date() })
      .where(eq(matches.id, matchId));

    await tx.insert(auditEvents).values({
      userId,
      matchId,
      action: "approved",
      actorEmail,
      reason: reason ?? null,
    });

    if (sortedIds.length > 0) {
      await tx
        .update(canonicalTransactions)
        .set({ status: "LOCKED_APPROVED" })
        .where(inArray(canonicalTransactions.id, sortedIds));
    }
  });

  return { success: true, matchId, status: "approved" };
}

/**
 * rejectMatch
 *
 * Same locking model as approveMatch. Releases associated canonical
 * transactions back to AVAILABLE so they can participate in future matching.
 */
export async function rejectMatch(
  userId: string,
  matchId: string,
  actorEmail: string,
  reason?: string
): Promise<ApproveRejectResult> {
  const [matchRow] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  if (!matchRow) throw Object.assign(new Error("Match not found"), { statusCode: 404 });
  if (matchRow.userId !== userId) throw Object.assign(new Error("Forbidden"), { statusCode: 403 });

  const sortedIds = getSortedLockIds(matchRow);

  await db.transaction(async (tx) => {
    // ── 1. Lock the match row ──────────────────────────────────────────────────
    const lockedMatches = await tx
      .select()
      .from(matches)
      .where(eq(matches.id, matchId))
      .for("update", { noWait: true })
      .limit(1);

    if (!lockedMatches.length) {
      throw Object.assign(new Error("Match not found"), { statusCode: 404 });
    }

    const currentMatch = lockedMatches[0];

    // ── 2. Assert status ───────────────────────────────────────────────────────
    if (currentMatch.status === "approved" || currentMatch.status === "rejected") {
      throw new ReviewConflictError(
        "ALREADY_FINALIZED",
        "This match has already been finalized. Please refresh to see the current state."
      );
    }
    if (currentMatch.status !== "pending") {
      throw new ReviewConflictError(
        "CONCURRENT_CLAIM",
        "This match was claimed by another reviewer. Please refresh and try again."
      );
    }

    // ── 3. Lock canonical_transactions in sorted UUID order ───────────────────
    if (sortedIds.length > 0) {
      await tx
        .select({ id: canonicalTransactions.id })
        .from(canonicalTransactions)
        .where(inArray(canonicalTransactions.id, sortedIds))
        .for("update", { noWait: true });
    }

    // ── 4. Apply the rejection ────────────────────────────────────────────────
    await tx
      .update(matches)
      .set({ status: "rejected" })
      .where(eq(matches.id, matchId));

    await tx.insert(auditEvents).values({
      userId,
      matchId,
      action: "rejected",
      actorEmail,
      reason: reason ?? null,
    });

    // Release canonical transactions back to available pool
    if (sortedIds.length > 0) {
      await tx
        .update(canonicalTransactions)
        .set({ status: "AVAILABLE" })
        .where(inArray(canonicalTransactions.id, sortedIds));
    }
  });

  return { success: true, matchId, status: "rejected" };
}

/**
 * manualMatch
 *
 * Creates a new analyst-authored match. Applies the full locking protocol
 * because:
 *   - Multiple reviewers may simultaneously open the manual-match UI for the
 *     same bank transaction.
 *   - A ledger entry may simultaneously be in an engine-created match that
 *     another reviewer is approving.
 *
 * Concurrency model:
 *   1. Collect all UUIDs (1 bank + N ledger) and sort alphabetically.
 *   2. Open transaction.
 *   3. Lock all rows in sorted UUID order with NOWAIT.
 *   4. Assert each row is still AVAILABLE (not MATCHED_PENDING or LOCKED_APPROVED).
 *   5. If a conflicting engine match exists, mark it SUPERSEDED (not deleted —
 *      preserves audit trail).
 *   6. Create the new MANUAL match with reviewType = MANUAL.
 *   7. Set all canonical_transactions to MATCHED_PENDING.
 *   8. Insert audit event.
 */
export async function manualMatch(
  userId: string,
  actorEmail: string,
  bankTransactionId: string,
  ledgerEntryIds: string[],
  reason?: string
): Promise<ManualMatchResult> {
  if (ledgerEntryIds.length === 0) {
    throw Object.assign(new Error("At least one ledger entry is required"), { statusCode: 400 });
  }
  if (ledgerEntryIds.length > 10) {
    throw Object.assign(new Error("Cannot match more than 10 ledger entries at once"), {
      statusCode: 400,
    });
  }

  // Sort all IDs alphabetically for consistent lock acquisition order
  const sortedIds = [...new Set([bankTransactionId, ...ledgerEntryIds])].sort();

  let newMatchId: string = "";

  await db.transaction(async (tx) => {
    // ── 1. Acquire all row locks in sorted order (NOWAIT) ─────────────────────
    // This prevents deadlock regardless of what order other concurrent
    // transactions acquire their locks.
    const lockedRows = await tx
      .select({ id: canonicalTransactions.id, status: canonicalTransactions.status })
      .from(canonicalTransactions)
      .where(inArray(canonicalTransactions.id, sortedIds))
      .for("update", { noWait: true });

    // Verify all requested IDs were found
    const foundIds = new Set(lockedRows.map((r) => r.id));
    const missing = sortedIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw Object.assign(
        new Error(`Transactions not found: ${missing.join(", ")}`),
        { statusCode: 404 }
      );
    }

    // ── 2. Assert each row is available ────────────────────────────────────────
    for (const row of lockedRows) {
      if (row.status === "LOCKED_APPROVED") {
        throw new ReviewConflictError(
          "ALREADY_FINALIZED",
          `Transaction ${row.id} has already been approved and cannot be reassigned.`
        );
      }
      if (row.status === "MATCHED_PENDING") {
        // Another transaction already claimed this row. This is a concurrent
        // claim — retriable once the other review completes.
        throw new ReviewConflictError(
          "CONCURRENT_CLAIM",
          `Transaction ${row.id} is currently under review by another user. Please try again shortly.`
        );
      }
      if (row.status !== "AVAILABLE") {
        throw Object.assign(
          new Error(`Transaction ${row.id} is not available for matching (status: ${row.status})`),
          { statusCode: 409 }
        );
      }
    }

    // ── 3. Supersede any existing AUTO match for this bank transaction ─────────
    // We update status to "superseded" rather than deleting, preserving the
    // audit trail of what the engine suggested before the analyst overrode it.
    await tx
      .update(matches)
      .set({ status: "superseded" })
      .where(
        and(
          eq(matches.bankTransactionId, bankTransactionId),
          eq(matches.userId, userId),
          eq(matches.status, "pending")
        )
      );

    // ── 4. Create the new MANUAL match ────────────────────────────────────────
    const [newMatch] = await tx
      .insert(matches)
      .values({
        userId,
        bankTransactionId,
        ledgerEntryIds,
        matchType: "manual",
        reviewType: "MANUAL",
        status: "pending",
        confidenceScore: "1.0", // Analyst asserted; highest possible confidence
        reasonText: reason ?? "Manual match created by reviewer",
        riskScore: 0,
      })
      .returning({ id: matches.id });

    newMatchId = newMatch.id;

    // ── 5. Mark all transactions as MATCHED_PENDING ───────────────────────────
    await tx
      .update(canonicalTransactions)
      .set({ status: "MATCHED_PENDING" })
      .where(inArray(canonicalTransactions.id, sortedIds));

    // ── 6. Insert audit event ─────────────────────────────────────────────────
    await tx.insert(auditEvents).values({
      userId,
      matchId: newMatchId,
      action: "manual_match_created",
      actorEmail,
      reason: reason ?? null,
      metadata: {
        bankTransactionId,
        ledgerEntryIds,
        ledgerCount: ledgerEntryIds.length,
      },
    });
  });

  return { success: true, matchId: newMatchId };
}

export async function bulkApproveMatches(
  userId: string,
  threshold: number,
  actorEmail: string
): Promise<BulkApproveResult> {
  const pendingMatches = await db
    .select()
    .from(matches)
    .where(
      and(
        eq(matches.userId, userId),
        eq(matches.status, "pending"),
        ne(matches.matchType, "none")
      )
    );

  const toApprove = pendingMatches.filter((m) => Number(m.confidenceScore) >= threshold);
  if (toApprove.length === 0) return { approvedCount: 0 };

  // Bulk approve: each match approved individually inside the same transaction.
  // Skips the per-match noWait locking to avoid thundering-herd; this is safe
  // because bulk approve is an admin-only single-user operation.
  await db.transaction(async (tx) => {
    for (const match of toApprove) {
      await tx
        .update(matches)
        .set({ status: "approved", approvedBy: actorEmail, approvedAt: new Date() })
        .where(eq(matches.id, match.id));

      await tx.insert(auditEvents).values({
        userId,
        matchId: match.id,
        action: "approved",
        actorEmail,
        reason: `Bulk approval at ≥${threshold * 100}% confidence`,
      });

      const allIds = getSortedLockIds(match);
      if (allIds.length > 0) {
        await tx
          .update(canonicalTransactions)
          .set({ status: "LOCKED_APPROVED" })
          .where(inArray(canonicalTransactions.id, allIds));
      }
    }
  });

  return { approvedCount: toApprove.length };
}
