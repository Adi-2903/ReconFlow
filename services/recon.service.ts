import { db } from "@/core/db";
import {
  users,
  canonicalTransactions,
  financialAccounts,
  reconRuns,
  matches,
  connectors,
} from "@/core/db/schema";
import { eq, and, gte, lte, count, inArray } from "drizzle-orm";
import { matchTransactions } from "@/core/matching/engine";
import { generateMatchReason, DEFAULT_FEE_PATTERNS } from "@/lib/ai-reason";
import { getOrCreateUserOrganization } from "@/core/db/org-helper";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReconStats {
  total: number;
  autoMatched: number;
  needsReview: number;
  exceptions: number;
}

export interface ReconRunResult {
  runId: string | null;
  stats: ReconStats;
  message?: string;
}

export interface ReconCounts {
  bankTransactions: number;
  stripeTransactions: number;
  ledgerEntries: number;
  qboConnected: boolean;
  stripeConnected: boolean;
  qboLastSync: Date | null;
  stripeLastSync: Date | null;
}

// ─── Service functions ────────────────────────────────────────────────────────

export async function runReconciliation(
  userId: string,
  periodStart: string,
  periodEnd: string
): Promise<ReconRunResult> {
  const startDate = new Date(periodStart);
  const endDate = new Date(periodEnd);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    throw Object.assign(new Error("Invalid date format for periodStart or periodEnd"), {
      statusCode: 400,
    });
  }
  if (startDate > endDate) {
    throw Object.assign(new Error("periodStart must be before periodEnd"), {
      statusCode: 400,
    });
  }

  const orgId = await getOrCreateUserOrganization(userId);

  // Fetch unmatched transactions in period
  const bankRows = await db
    .select()
    .from(canonicalTransactions)
    .where(
      and(
        eq(canonicalTransactions.organizationId, orgId),
        eq(canonicalTransactions.side, "money"),
        eq(canonicalTransactions.status, "AVAILABLE"),
        gte(canonicalTransactions.transactionDate, periodStart),
        lte(canonicalTransactions.transactionDate, periodEnd)
      )
    );

  const ledgerRows = await db
    .select()
    .from(canonicalTransactions)
    .where(
      and(
        eq(canonicalTransactions.organizationId, orgId),
        eq(canonicalTransactions.side, "books"),
        eq(canonicalTransactions.status, "AVAILABLE"),
        gte(canonicalTransactions.transactionDate, periodStart),
        lte(canonicalTransactions.transactionDate, periodEnd)
      )
    );

  if (bankRows.length === 0) {
    return {
      runId: null,
      stats: { total: 0, autoMatched: 0, needsReview: 0, exceptions: 0 },
      message: "No unmatched bank transactions found for this period.",
    };
  }

  // Create run record
  const [run] = await db
    .insert(reconRuns)
    .values({ userId, periodStart, periodEnd, totalTransactions: bankRows.length, status: "running" })
    .returning();

  try {
    // Map to engine types
    const engineBanks = bankRows.map((b) => ({
      id: b.id,
      amount: Number(b.amountMinor),
      date: new Date(b.transactionDate),
      description: b.description ?? "",
      referenceId: b.referenceNumber ?? "",
    }));

    const engineLedgers = ledgerRows.map((l) => ({
      id: l.id,
      amount: Number(l.amountMinor),
      date: new Date(l.transactionDate),
      memo: l.description ?? "",
      invoiceRef: l.referenceNumber ?? "",
    }));

    // Run 4-pass matching engine
    const matchResults = matchTransactions(engineBanks, engineLedgers);

    // AI Reasoning (skipped for exact/none — saves tokens)
    const aiTasks = matchResults.map(async (match) => {
      const skipAI =
        (match.matchType === "exact" && match.confidenceScore >= 0.95) ||
        match.matchType === "none";

      if (skipAI) return { ...match, aiResult: null };

      const bankTxn = engineBanks.find((b) => b.id === match.bankTransactionId)!;
      const candidates = engineLedgers.filter((l) =>
        match.ledgerEntryIds.includes(l.id)
      );
      const aiResult = await generateMatchReason(bankTxn, candidates, DEFAULT_FEE_PATTERNS);
      return { ...match, aiResult };
    });

    const aiResults = await Promise.allSettled(aiTasks);
    const enhancedMatches = aiResults.map((result, i) => {
      if (result.status === "fulfilled") return result.value;
      console.error("AI call failed for match index", i, matchResults[i]);
      return { ...matchResults[i], aiResult: null };
    });

    // Persist in a single DB transaction
    let autoMatched = 0;
    let needsReview = 0;
    let exceptions = 0;

    await db.transaction(async (tx) => {
      for (const match of enhancedMatches) {
        const isAutoApprove = match.matchType === "exact" && match.confidenceScore >= 0.95;
        const status = isAutoApprove ? "approved" : "pending";

        if (isAutoApprove) autoMatched++;
        else if (match.matchType === "none") exceptions++;
        else needsReview++;

        const reasonText = match.aiResult?.explanation ?? fallbackReason(match.matchType);
        const evidence = match.aiResult ?? null;

        await tx.insert(matches).values({
          userId,
          bankTransactionId: match.bankTransactionId,
          ledgerEntryIds: match.ledgerEntryIds,
          confidenceScore: match.confidenceScore.toString(),
          matchType: match.matchType,
          reasonText,
          evidence,
          status,
        });

        // Set status in canonicalTransactions
        if (match.matchType !== "none") {
          const newStatus = isAutoApprove ? "LOCKED_APPROVED" : "MATCHED_PENDING";
          await tx
            .update(canonicalTransactions)
            .set({ status: newStatus })
            .where(eq(canonicalTransactions.id, match.bankTransactionId));

          if (match.ledgerEntryIds.length > 0) {
            await tx
              .update(canonicalTransactions)
              .set({ status: newStatus })
              .where(inArray(canonicalTransactions.id, match.ledgerEntryIds));
          }
        }
      }

      await tx
        .update(reconRuns)
        .set({ status: "complete", autoMatched, needsReview, exceptions })
        .where(eq(reconRuns.id, run.id));
    });

    return { runId: run.id, stats: { total: bankRows.length, autoMatched, needsReview, exceptions } };
  } catch (engineError) {
    await db.update(reconRuns).set({ status: "failed" }).where(eq(reconRuns.id, run.id));
    throw engineError;
  }
}

export async function getReconCounts(userId: string): Promise<ReconCounts> {
  let qboConnected = false;
  let stripeConnected = false;
  let qboLastSync: Date | null = null;
  let stripeLastSync: Date | null = null;

  let totalBankCountVal = 0;
  let stripeCountVal = 0;
  let ledgerCountVal = 0;

  try {
    const orgId = await getOrCreateUserOrganization(userId);

    const [totalBankCount] = await db
      .select({ count: count() })
      .from(canonicalTransactions)
      .where(
        and(
          eq(canonicalTransactions.organizationId, orgId),
          eq(canonicalTransactions.side, "money")
        )
      );
    totalBankCountVal = totalBankCount?.count ?? 0;

    const [stripeCount] = await db
      .select({ count: count() })
      .from(canonicalTransactions)
      .innerJoin(financialAccounts, eq(canonicalTransactions.accountId, financialAccounts.id))
      .where(
        and(
          eq(canonicalTransactions.organizationId, orgId),
          eq(canonicalTransactions.side, "money"),
          eq(financialAccounts.accountType, "stripe")
        )
      );
    stripeCountVal = stripeCount?.count ?? 0;

    const [ledgerCount] = await db
      .select({ count: count() })
      .from(canonicalTransactions)
      .where(
        and(
          eq(canonicalTransactions.organizationId, orgId),
          eq(canonicalTransactions.side, "books")
        )
      );
    ledgerCountVal = ledgerCount?.count ?? 0;

    const userConnectors = await db
      .select()
      .from(connectors)
      .where(
        and(
          eq(connectors.organizationId, orgId),
          eq(connectors.status, "connected")
        )
      );

    for (const conn of userConnectors) {
      if (conn.connectorType === "quickbooks" && conn.accessToken) {
        qboConnected = true;
      }
      if (conn.connectorType === "stripe" && conn.accessToken) {
        stripeConnected = true;
      }
    }
  } catch (err) {
    console.error("Error fetching connector states / counts:", err);
  }

  return {
    bankTransactions: Number(totalBankCountVal),
    stripeTransactions: Number(stripeCountVal),
    ledgerEntries: Number(ledgerCountVal),
    qboConnected,
    stripeConnected,
    qboLastSync,
    stripeLastSync,
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function fallbackReason(matchType: string): string {
  switch (matchType) {
    case "exact": return "Exact match on amount and date.";
    case "bulk": return "Multiple ledger entries sum precisely to this bank transaction.";
    case "fuzzy": return "Partial match based on similar amount, date, or text references.";
    default: return "No matching ledger entries found.";
  }
}
