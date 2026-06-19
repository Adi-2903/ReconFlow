import { db } from "@/core/db";
import { matches, canonicalTransactions, auditEvents } from "@/core/db/schema";
import { eq, and, ne, inArray } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MatchListItem {
  id: string;
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
  reasonText: string;
  scoringBreakdown: { amountScore: number; dateScore: number; textScore: number };
  status: string | null;
}

export interface ApproveRejectResult {
  success: boolean;
  matchId: string;
  status: string;
}

export interface BulkApproveResult {
  approvedCount: number;
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
      bankRow: {
        amount: Number(bankTx.amountMinor) / 100,
        date: bankTx.transactionDate instanceof Date ? bankTx.transactionDate.toISOString().split("T")[0] : String(bankTx.transactionDate),
        description: bankTx.description || "",
        referenceId: bankTx.referenceNumber || "",
        source: bankTx.sourceSystem || "unknown",
      },
      ledgerRows: matchLedgers.map((l: any) => ({
        amount: Number(l.amountMinor) / 100,
        date: l.transactionDate instanceof Date ? l.transactionDate.toISOString().split("T")[0] : String(l.transactionDate),
        memo: l.description || "",
        invoiceRef: l.referenceNumber || "",
      })),
      ledgerRow:
        matchLedgers.length === 1
          ? {
              amount: Number(matchLedgers[0].amountMinor) / 100,
              date: matchLedgers[0].transactionDate instanceof Date ? matchLedgers[0].transactionDate.toISOString().split("T")[0] : String(matchLedgers[0].transactionDate),
              memo: matchLedgers[0].description || "",
              invoiceRef: matchLedgers[0].referenceNumber || "",
            }
          : null,
      confidenceScore: Number(match.confidenceScore || 0),
      matchType: match.matchType,
      reasonText: match.reasonText || "",
      scoringBreakdown: { amountScore: 0, dateScore: 0, textScore: 0 },
      status: match.status,
    };
  });

  results.sort((a, b) => {
    if (a.matchType === "none" && b.matchType !== "none") return -1;
    if (b.matchType === "none" && a.matchType !== "none") return 1;
    return a.confidenceScore - b.confidenceScore;
  });

  return results;
}

export async function approveMatch(
  userId: string,
  matchId: string,
  actorEmail: string
): Promise<ApproveRejectResult> {
  const matchResult = await db
    .select()
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);

  if (!matchResult.length) {
    throw Object.assign(new Error("Match not found"), { statusCode: 404 });
  }
  const match = matchResult[0];

  if (match.userId !== userId) {
    throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
  }
  if (match.status !== "pending") {
    throw Object.assign(new Error("Match is already processed"), { statusCode: 409 });
  }

  await db.transaction(async (tx) => {
    await tx
      .update(matches)
      .set({ status: "approved", approvedBy: actorEmail, approvedAt: new Date() })
      .where(eq(matches.id, matchId));

    await tx.insert(auditEvents).values({
      userId,
      matchId,
      action: "approved",
      actorEmail,
    });

    if (match.bankTransactionId) {
      await tx
        .update(canonicalTransactions)
        .set({ status: "LOCKED_APPROVED" })
        .where(eq(canonicalTransactions.id, match.bankTransactionId));
    }

    if (match.ledgerEntryIds && match.ledgerEntryIds.length > 0) {
      await tx
        .update(canonicalTransactions)
        .set({ status: "LOCKED_APPROVED" })
        .where(inArray(canonicalTransactions.id, match.ledgerEntryIds));
    }
  });

  return { success: true, matchId, status: "approved" };
}

export async function rejectMatch(
  userId: string,
  matchId: string,
  actorEmail: string
): Promise<ApproveRejectResult> {
  const matchResult = await db
    .select()
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);

  if (!matchResult.length) {
    throw Object.assign(new Error("Match not found"), { statusCode: 404 });
  }
  const match = matchResult[0];

  if (match.userId !== userId) {
    throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
  }
  if (match.status !== "pending") {
    throw Object.assign(new Error("Match is already processed"), { statusCode: 409 });
  }

  await db.transaction(async (tx) => {
    await tx
      .update(matches)
      .set({ status: "rejected" })
      .where(eq(matches.id, matchId));

    await tx.insert(auditEvents).values({
      userId,
      matchId,
      action: "rejected",
      actorEmail,
    });

    if (match.bankTransactionId) {
      await tx
        .update(canonicalTransactions)
        .set({ status: "AVAILABLE" })
        .where(eq(canonicalTransactions.id, match.bankTransactionId));
    }

    if (match.ledgerEntryIds && match.ledgerEntryIds.length > 0) {
      await tx
        .update(canonicalTransactions)
        .set({ status: "AVAILABLE" })
        .where(inArray(canonicalTransactions.id, match.ledgerEntryIds));
    }
  });

  return { success: true, matchId, status: "rejected" };
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

  const toApprove = pendingMatches.filter(
    (m) => Number(m.confidenceScore) >= threshold
  );

  if (toApprove.length === 0) return { approvedCount: 0 };

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
      });

      if (match.bankTransactionId) {
        await tx
          .update(canonicalTransactions)
          .set({ status: "LOCKED_APPROVED" })
          .where(eq(canonicalTransactions.id, match.bankTransactionId));
      }

      if (match.ledgerEntryIds && match.ledgerEntryIds.length > 0) {
        await tx
          .update(canonicalTransactions)
          .set({ status: "LOCKED_APPROVED" })
          .where(inArray(canonicalTransactions.id, match.ledgerEntryIds));
      }
    }
  });

  return { approvedCount: toApprove.length };
}
