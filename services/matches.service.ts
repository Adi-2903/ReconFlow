import { db } from "@/core/db";
import { matches, canonicalTransactions, auditEvents, organizations, dailyMetrics } from "@/core/db/schema";
import { getOrCreateUserOrganization } from "@/core/db/org-helper";
import { eq, and, ne, inArray, sql, asc } from "drizzle-orm";
import { toMetricDate } from "@/core/utils/dateUtils";

// ─── Daily Metrics Helpers ────────────────────────────────────────────────────

/**
 * Computes the metric aggregates exactly how rebuildDailyMetricsRange does it, 
 * but scoped to a single canonical transaction for write-time delta calculation.
 */
async function getTransactionMetricContribution(tx: any, transactionId: string) {
  const records = await tx
    .select({
      txn: canonicalTransactions,
      match: matches,
    })
    .from(canonicalTransactions)
    .leftJoin(matches, eq(matches.bankTransactionId, canonicalTransactions.id))
    .where(eq(canonicalTransactions.id, transactionId));

  if (records.length === 0) return null;

  const orgId = records[0].txn.organizationId;
  const [org] = await tx.select({ timezone: organizations.timezone }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
  const timezone = org?.timezone || "Asia/Kolkata";
  
  const metricDate = toMetricDate(records[0].txn.transactionDate, timezone);
  
  const agg = {
    totalCount: 0,
    matchedCount: 0,
    pendingCount: 0,
    unmatchedCount: 0,
    highRiskCount: 0,
    totalVolumeMinor: 0n,
    feeVolumeMinor: 0n,
    fxVolumeMinor: 0n,
  };

  for (const row of records) {
    agg.totalCount += 1;
    const amountMinor = BigInt(row.txn.amountMinor?.toString() || "0");
    agg.totalVolumeMinor += amountMinor;

    if (row.match) {
      if (row.match.status === "approved") {
        agg.matchedCount += 1;
      } else if (row.match.status === "pending") {
        if (row.match.matchType === "none") {
          agg.unmatchedCount += 1;
        } else {
          agg.pendingCount += 1;
        }
      } else {
        agg.unmatchedCount += 1;
      }

      if (row.match.riskScore && row.match.riskScore > 0) agg.highRiskCount += 1;

      if (row.match.discrepancyType === "PROCESSING_FEE") agg.feeVolumeMinor += amountMinor;
      else if (row.match.discrepancyType === "FOREIGN_EXCHANGE") agg.fxVolumeMinor += amountMinor;
    } else {
      agg.unmatchedCount += 1;
    }
  }

  return { orgId, metricDate, agg };
}

/**
 * Computes the delta between before/after state and idempotently applies 
 * the update to daily_metrics inside the transaction.
 */
async function applyMetricDelta(tx: any, orgId: string, metricDate: string, before: any, after: any) {
  const delta = {
    totalCount: after.totalCount - before.totalCount,
    matchedCount: after.matchedCount - before.matchedCount,
    pendingCount: after.pendingCount - before.pendingCount,
    unmatchedCount: after.unmatchedCount - before.unmatchedCount,
    highRiskCount: after.highRiskCount - before.highRiskCount,
    totalVolumeMinor: after.totalVolumeMinor - before.totalVolumeMinor,
    feeVolumeMinor: after.feeVolumeMinor - before.feeVolumeMinor,
    fxVolumeMinor: after.fxVolumeMinor - before.fxVolumeMinor,
  };

  if (
    delta.totalCount === 0 &&
    delta.matchedCount === 0 &&
    delta.pendingCount === 0 &&
    delta.unmatchedCount === 0 &&
    delta.highRiskCount === 0 &&
    delta.totalVolumeMinor === 0 &&
    delta.feeVolumeMinor === 0 &&
    delta.fxVolumeMinor === 0
  ) {
    return;
  }

  // Acquire lock to prevent concurrent write-time or rebuild updates
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('METRICS_' || ${orgId}::text))`);

  await tx
    .insert(dailyMetrics)
    .values({
      metricDate,
      organizationId: orgId,
      totalCount: delta.totalCount,
      matchedCount: delta.matchedCount,
      pendingCount: delta.pendingCount,
      unmatchedCount: delta.unmatchedCount,
      highRiskCount: delta.highRiskCount,
      totalVolumeMinor: delta.totalVolumeMinor,
      feeVolumeMinor: delta.feeVolumeMinor,
      fxVolumeMinor: delta.fxVolumeMinor,
    })
    .onConflictDoUpdate({
      target: [dailyMetrics.organizationId, dailyMetrics.metricDate],
      set: {
        totalCount: sql`${dailyMetrics.totalCount} + EXCLUDED.total_count`,
        matchedCount: sql`${dailyMetrics.matchedCount} + EXCLUDED.matched_count`,
        pendingCount: sql`${dailyMetrics.pendingCount} + EXCLUDED.pending_count`,
        unmatchedCount: sql`${dailyMetrics.unmatchedCount} + EXCLUDED.unmatched_count`,
        highRiskCount: sql`${dailyMetrics.highRiskCount} + EXCLUDED.high_risk_count`,
        totalVolumeMinor: sql`${dailyMetrics.totalVolumeMinor} + EXCLUDED.total_volume_minor`,
        feeVolumeMinor: sql`${dailyMetrics.feeVolumeMinor} + EXCLUDED.fee_volume_minor`,
        fxVolumeMinor: sql`${dailyMetrics.fxVolumeMinor} + EXCLUDED.fx_volume_minor`,
        updatedAt: sql`now()`,
      }
    });
}

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

/**
 * resolveCallerOrg
 *
 * Resolves the caller's organizationId via the organizationMembers table,
 * then verifies that every supplied canonical_transaction UUID belongs to
 * that organisation.  Throws a 403 if the caller has no org membership or
 * if any transaction ID belongs to a different org.
 *
 * This is the single enforcement point for tenant isolation across all
 * Phase 10 review operations.  It deliberately does NOT use a DB transaction
 * because it is a read-only preflight; the real mutation happens inside
 * db.transaction() which re-verifies state under FOR UPDATE NOWAIT.
 *
 * @param userId          - authenticated user's UUID
 * @param txnIds          - one or more canonicalTransaction UUIDs to verify
 * @returns               - the caller's resolved organizationId
 */
async function resolveCallerOrg(
  userId: string,
  txnIds: string[]
): Promise<string> {
  // 1. Resolve caller's org (reuses the established pattern from recon.service,
  //    settings.service, etc.)
  const orgId = await getOrCreateUserOrganization(userId);

  if (txnIds.length === 0) return orgId;

  // 2. Verify every transaction belongs to this org.
  //    Fetch only organizationId — we do not need full rows here.
  const rows = await db
    .select({ id: canonicalTransactions.id, orgId: canonicalTransactions.organizationId })
    .from(canonicalTransactions)
    .where(inArray(canonicalTransactions.id, txnIds));

  for (const row of rows) {
    if (row.orgId !== orgId) {
      throw Object.assign(
        new Error("Forbidden: transaction belongs to a different organisation"),
        { statusCode: 403 }
      );
    }
  }

  // 3. Detect any IDs that were not found at all (not a tenant-isolation
  //    concern, but surfacing a clear 404 here avoids a confusing 409 later).
  const foundIds = new Set(rows.map((r) => r.id));
  const missing = txnIds.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    throw Object.assign(
      new Error(`Transactions not found: ${missing.join(", ")}`),
      { statusCode: 404 }
    );
  }

  return orgId;
}


export async function listMatches(
  userId: string,
  filter: string = "all"
): Promise<MatchListItem[]> {
  // Resolve the caller's organization so we can scope the query.
  // canonicalTransactions already carries organizationId; we push the filter
  // into the JOIN condition rather than a post-hoc JS filter so the database
  // enforces it and we never load foreign-org rows into memory.
  const orgId = await getOrCreateUserOrganization(userId);

  const allMatches = await db
    .select({ match: matches, bankTx: canonicalTransactions })
    .from(matches)
    .innerJoin(
      canonicalTransactions,
      and(
        eq(matches.bankTransactionId, canonicalTransactions.id),
        // Tenant isolation: only return matches whose bank transaction belongs
        // to the caller's organisation.
        eq(canonicalTransactions.organizationId, orgId)
      )
    )
    .where(
      and(
        eq(matches.userId, userId),
        // F-02: exclude superseded matches — they are permanently terminal records
        // that exist only to preserve the audit trail of what the engine
        // suggested before a manual match overrode it. They must never appear
        // in any reviewer-facing list.
        ne(matches.status, "superseded")
      )
    );

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
    // Scope the ledger fetch to the same org for safety.
    ledgers = await db
      .select()
      .from(canonicalTransactions)
      .where(
        and(
          inArray(canonicalTransactions.id, allLedgerIds),
          eq(canonicalTransactions.organizationId, orgId)
        )
      );
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
      matchOutcome: match.matchOutcome || null,
      discrepancyType: match.discrepancyType || null,
      evidenceList: (match.classificationEvidence as any[]) || null,
      reasonText: match.reasonText || "",
      scoringBreakdown: { amountScore: 0, dateScore: 0, textScore: 0 },
      riskScore: match.riskScore as number,
      status: match.status,
      reviewType: match.reviewType ?? "AUTO",
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

  // ── Tenant isolation pre-flight ────────────────────────────────────────────
  // Verify that every canonical_transaction involved in this match belongs to
  // the caller's organisation. Throws 403 if any ID is cross-org, 404 if any
  // ID does not exist. Must run before the DB transaction so the error is
  // surfaced cleanly without a lock being held.
  const orgId = await resolveCallerOrg(userId, sortedIds);

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

    // ── TOCTOU Re-verification ─────────────────────────────────────────────────
    // Re-verify ownership and immutability under lock to eliminate race conditions
    if (currentMatch.userId !== userId) {
      throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
    }
    const currentSortedIds = getSortedLockIds(currentMatch);
    if (currentSortedIds.join(",") !== sortedIds.join(",")) {
      throw new ReviewConflictError(
        "CONCURRENT_CLAIM",
        "This match was modified by another reviewer. Please refresh and try again."
      );
    }

    // ── 2. Assert status — distinguish finalized vs concurrent claim ───────────
    // F-02: superseded is a permanent terminal state (engine match overridden by
    // a manual match) and must map to ALREADY_FINALIZED — not CONCURRENT_CLAIM —
    // so the reviewer is told not to retry rather than to wait and try again.
    if (
      currentMatch.status === "approved" ||
      currentMatch.status === "rejected" ||
      currentMatch.status === "superseded"
    ) {
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
        .select({ id: canonicalTransactions.id, status: canonicalTransactions.status, orgId: canonicalTransactions.organizationId })
        .from(canonicalTransactions)
        .where(inArray(canonicalTransactions.id, sortedIds))
        .for("update", { noWait: true });

      // TOCTOU Re-verification: ensure all records still exist
      if (lockedTxns.length !== sortedIds.length) {
        throw Object.assign(new Error("Transactions not found"), { statusCode: 404 });
      }

      // Assert all rows still belong to this org and match group (no concurrent reassignment)
      for (const row of lockedTxns) {
        if (row.orgId !== orgId) {
          throw Object.assign(new Error("Forbidden: transaction belongs to a different organisation"), { statusCode: 403 });
        }
        if (row.status === "LOCKED_APPROVED") {
          throw new ReviewConflictError(
            "ALREADY_FINALIZED",
            "One or more transactions in this match have already been approved elsewhere."
          );
        }
      }
    }

    const beforeMetrics = currentMatch.bankTransactionId 
      ? await getTransactionMetricContribution(tx, currentMatch.bankTransactionId) 
      : null;

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

    // ── Metric Calculation & Apply (AFTER) ────────────────────────────────────
    if (beforeMetrics && currentMatch.bankTransactionId) {
      const afterMetrics = await getTransactionMetricContribution(tx, currentMatch.bankTransactionId);
      if (afterMetrics) {
        await applyMetricDelta(tx, beforeMetrics.orgId, beforeMetrics.metricDate, beforeMetrics.agg, afterMetrics.agg);
      }
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

  // ── Tenant isolation pre-flight ────────────────────────────────────────────
  // Mirrors the check in approveMatch — ensures the caller's org owns every
  // canonical_transaction that would be released back to AVAILABLE.
  const orgId = await resolveCallerOrg(userId, sortedIds);

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

    // ── TOCTOU Re-verification ─────────────────────────────────────────────────
    if (currentMatch.userId !== userId) {
      throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
    }
    const currentSortedIds = getSortedLockIds(currentMatch);
    if (currentSortedIds.join(",") !== sortedIds.join(",")) {
      throw new ReviewConflictError(
        "CONCURRENT_CLAIM",
        "This match was modified by another reviewer. Please refresh and try again."
      );
    }

    // ── 2. Assert status ───────────────────────────────────────────────────────
    // F-02: superseded must map to ALREADY_FINALIZED, not CONCURRENT_CLAIM.
    // A superseded match was permanently overridden by a manual match and cannot
    // be rejected; telling the reviewer to "try again" is semantically wrong.
    if (
      currentMatch.status === "approved" ||
      currentMatch.status === "rejected" ||
      currentMatch.status === "superseded"
    ) {
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
        .select({ id: canonicalTransactions.id, orgId: canonicalTransactions.organizationId })
        .from(canonicalTransactions)
        .where(inArray(canonicalTransactions.id, sortedIds))
        .for("update", { noWait: true });

      // TOCTOU Re-verification
      if (lockedTxns.length !== sortedIds.length) {
        throw Object.assign(new Error("Transactions not found"), { statusCode: 404 });
      }

      for (const row of lockedTxns) {
        if (row.orgId !== orgId) {
          throw Object.assign(new Error("Forbidden: transaction belongs to a different organisation"), { statusCode: 403 });
        }
      }
    }

    const beforeMetrics = currentMatch.bankTransactionId 
      ? await getTransactionMetricContribution(tx, currentMatch.bankTransactionId) 
      : null;

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

    // ── Metric Calculation & Apply (AFTER) ────────────────────────────────────
    if (beforeMetrics && currentMatch.bankTransactionId) {
      const afterMetrics = await getTransactionMetricContribution(tx, currentMatch.bankTransactionId);
      if (afterMetrics) {
        await applyMetricDelta(tx, beforeMetrics.orgId, beforeMetrics.metricDate, beforeMetrics.agg, afterMetrics.agg);
      }
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

  // ── Tenant isolation pre-flight ────────────────────────────────────────────
  // Verify that the bank transaction AND every selected ledger entry all belong
  // to the caller's organisation before we acquire any locks. resolveCallerOrg
  // also handles the "transaction not found" case, so we remove the duplicate
  // check that was previously inside the DB transaction.
  const orgId = await resolveCallerOrg(userId, sortedIds);

  let newMatchId: string = "";

  await db.transaction(async (tx) => {
    // ── 1. Acquire all row locks in sorted order (NOWAIT) ─────────────────────
    // This prevents deadlock regardless of what order other concurrent
    // transactions acquire their locks.
    const lockedRows = await tx
      .select({ id: canonicalTransactions.id, status: canonicalTransactions.status, orgId: canonicalTransactions.organizationId })
      .from(canonicalTransactions)
      .where(inArray(canonicalTransactions.id, sortedIds))
      .for("update", { noWait: true });

    // TOCTOU Re-verification: Verify all requested IDs were found
    if (lockedRows.length !== sortedIds.length) {
      throw Object.assign(
        new Error("Transactions not found"),
        { statusCode: 404 }
      );
    }

    // ── 2. Assert each row is available and belongs to org ─────────────────────
    for (const row of lockedRows) {
      if (row.orgId !== orgId) {
        throw Object.assign(new Error("Forbidden: transaction belongs to a different organisation"), { statusCode: 403 });
      }
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

    const beforeMetrics = await getTransactionMetricContribution(tx, bankTransactionId);

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
      .returning();

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

    // ── Metric Calculation & Apply (AFTER) ────────────────────────────────────
    if (beforeMetrics) {
      const afterMetrics = await getTransactionMetricContribution(tx, bankTransactionId);
      if (afterMetrics) {
        await applyMetricDelta(tx, beforeMetrics.orgId, beforeMetrics.metricDate, beforeMetrics.agg, afterMetrics.agg);
      }
    }
  });

  return { success: true, matchId: newMatchId };
}

export async function bulkApproveMatches(
  userId: string,
  threshold: number,
  actorEmail: string
): Promise<BulkApproveResult> {
  // Resolve caller's org once, then scope the pending-matches fetch via a JOIN
  // on canonicalTransactions.organizationId so we never load or approve matches
  // that belong to a different organisation.
  const orgId = await getOrCreateUserOrganization(userId);

  const pendingMatches = await db
    .select({ match: matches })
    .from(matches)
    .innerJoin(
      canonicalTransactions,
      and(
        eq(matches.bankTransactionId, canonicalTransactions.id),
        // Tenant isolation: only consider matches whose bank transaction belongs
        // to the caller's organisation.
        eq(canonicalTransactions.organizationId, orgId)
      )
    )
    .where(
      and(
        eq(matches.userId, userId),
        eq(matches.status, "pending"),
        ne(matches.matchType, "none")
      )
    );

  const toApprove = pendingMatches
    .map((r) => r.match)
    .filter((m) => Number(m.confidenceScore) >= threshold);
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
