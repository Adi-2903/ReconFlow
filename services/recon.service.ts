import { db } from "@/core/db";
import {
  users,
  bankTransactions,
  ledgerEntries,
  reconRuns,
  matches,
} from "@/core/db/schema";
import { eq, and, gte, lte, count } from "drizzle-orm";
import { matchTransactions } from "@/core/matching/engine";
import { generateMatchReason, DEFAULT_FEE_PATTERNS } from "@/lib/ai-reason";

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

  // Fetch unmatched transactions in period
  const bankRows = await db
    .select()
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.userId, userId),
        eq(bankTransactions.status, "unmatched"),
        gte(bankTransactions.date, periodStart),
        lte(bankTransactions.date, periodEnd)
      )
    );

  const ledgerRows = await db
    .select()
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.userId, userId),
        eq(ledgerEntries.status, "unmatched"),
        gte(ledgerEntries.date, periodStart),
        lte(ledgerEntries.date, periodEnd)
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
      amount: Math.round(Number(b.amount) * 100),
      date: new Date(b.date),
      description: b.description ?? "",
      referenceId: b.referenceId ?? "",
    }));

    const engineLedgers = ledgerRows.map((l) => ({
      id: l.id,
      amount: Math.round(Number(l.amount) * 100),
      date: new Date(l.date),
      memo: l.memo ?? "",
      invoiceRef: l.invoiceRef ?? "",
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

        const bankStatus = match.matchType === "none" ? "exception" : "matched";
        await tx
          .update(bankTransactions)
          .set({ status: bankStatus })
          .where(eq(bankTransactions.id, match.bankTransactionId));

        for (const ledgerId of match.ledgerEntryIds) {
          await tx
            .update(ledgerEntries)
            .set({ status: "matched" })
            .where(eq(ledgerEntries.id, ledgerId));
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
  const [stripeCount] = await db
    .select({ count: count() })
    .from(bankTransactions)
    .where(
      and(eq(bankTransactions.userId, userId), eq(bankTransactions.source, "Stripe"))
    );

  const [totalBankCount] = await db
    .select({ count: count() })
    .from(bankTransactions)
    .where(eq(bankTransactions.userId, userId));

  const [ledgerCount] = await db
    .select({ count: count() })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.userId, userId));

  const [user] = await db
    .select({
      qboAccessToken: users.qboAccessToken,
      stripeAccessToken: users.stripeAccessToken,
      qboLastSync: users.qboLastSync,
      stripeLastSync: users.stripeLastSync,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return {
    bankTransactions: Number(totalBankCount?.count ?? 0),
    stripeTransactions: Number(stripeCount?.count ?? 0),
    ledgerEntries: Number(ledgerCount?.count ?? 0),
    qboConnected: !!user?.qboAccessToken,
    stripeConnected: !!user?.stripeAccessToken,
    qboLastSync: user?.qboLastSync ?? null,
    stripeLastSync: user?.stripeLastSync ?? null,
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function fallbackReason(matchType: string): string {
  switch (matchType) {
    case "exact":  return "Exact match on amount and date.";
    case "bulk":   return "Multiple ledger entries sum precisely to this bank transaction.";
    case "fuzzy":  return "Partial match based on similar amount, date, or text references.";
    default:       return "No matching ledger entries found.";
  }
}
