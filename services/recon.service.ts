import { db } from "@/core/db";
import {
  users,
  canonicalTransactions,
  financialAccounts,
  reconRuns,
  matches,
  connectors,
  aiExplanations,
  rawRecords,
} from "@/core/db/schema";
import { eq, and, gte, lte, count, inArray } from "drizzle-orm";
import { matchTransactions } from "@/core/matching/engine";
import { generateMatchReasoning, RunTracker } from "@/lib/ai-reason";
import { renderExplanation } from "@/lib/render-explanation";
import { getOrCreateUserOrganization } from "@/core/db/org-helper";
import { PROMPT_VERSION } from "@/types";
import { rebuildDailyMetricsRange } from "@/services/reports.service";

// ── Inline concurrency limiter (no p-limit dependency) ────────────────────────
// Caps concurrent LLM calls at MAX_CONCURRENT to prevent flooding Gemini
// during a large batch. Uses a simple semaphore pattern.
const MAX_CONCURRENT_AI = 5;

async function limitConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const i = nextIndex++;
      results[i] = await tasks[i]();
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, () => worker())
  );
  return results;
}

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
  periodEnd: string,
  importIds?: string[]
): Promise<ReconRunResult> {
  let startDate: Date;
  let endDate: Date;

  const parsedStart = new Date(periodStart);
  if (!isNaN(parsedStart.getTime()) && periodStart.includes("T")) {
    startDate = parsedStart;
  } else {
    const dateStr = periodStart.split("T")[0];
    startDate = new Date(dateStr + "T00:00:00.000+05:30");
  }

  const parsedEnd = new Date(periodEnd);
  if (!isNaN(parsedEnd.getTime()) && periodEnd.includes("T")) {
    endDate = parsedEnd;
  } else {
    const dateStr = periodEnd.split("T")[0];
    endDate = new Date(dateStr + "T23:59:59.999+05:30");
  }

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

  const columns = {
    id: canonicalTransactions.id,
    organizationId: canonicalTransactions.organizationId,
    accountId: canonicalTransactions.accountId,
    rawRecordId: canonicalTransactions.rawRecordId,
    sourceSystem: canonicalTransactions.sourceSystem,
    externalId: canonicalTransactions.externalId,
    side: canonicalTransactions.side,
    direction: canonicalTransactions.direction,
    status: canonicalTransactions.status,
    transactionDate: canonicalTransactions.transactionDate,
    amountMinor: canonicalTransactions.amountMinor,
    currency: canonicalTransactions.currency,
    referenceNumber: canonicalTransactions.referenceNumber,
    counterpartyName: canonicalTransactions.counterpartyName,
    counterpartyNormalized: canonicalTransactions.counterpartyNormalized,
    description: canonicalTransactions.description,
    transactionType: canonicalTransactions.transactionType,
    sourceTransactionId: canonicalTransactions.sourceTransactionId,
    lockedAt: canonicalTransactions.lockedAt,
    lockedByMatchGroupId: canonicalTransactions.lockedByMatchGroupId,
    activeRunId: canonicalTransactions.activeRunId,
    baseCurrency: canonicalTransactions.baseCurrency,
    convertedAmountMinor: canonicalTransactions.convertedAmountMinor,
    exchangeRate: canonicalTransactions.exchangeRate,
    exchangeRateSource: canonicalTransactions.exchangeRateSource,
    fxRateProvider: canonicalTransactions.fxRateProvider,
    exchangeRateDate: canonicalTransactions.exchangeRateDate,
    fxStatus: canonicalTransactions.fxStatus,
    metadata: canonicalTransactions.metadata,
    createdAt: canonicalTransactions.createdAt,
    updatedAt: canonicalTransactions.updatedAt,
  };

  // Fetch unmatched transactions in period
  let bankRows;
  let ledgerRows;

  if (importIds && importIds.length > 0) {
    bankRows = await db
      .select(columns)
      .from(canonicalTransactions)
      .innerJoin(rawRecords, eq(canonicalTransactions.rawRecordId, rawRecords.id))
      .where(
        and(
          eq(canonicalTransactions.organizationId, orgId),
          eq(canonicalTransactions.side, "money"),
          eq(canonicalTransactions.status, "AVAILABLE"),
          gte(canonicalTransactions.transactionDate, startDate),
          lte(canonicalTransactions.transactionDate, endDate),
          inArray(rawRecords.importId, importIds)
        )
      );

    ledgerRows = await db
      .select(columns)
      .from(canonicalTransactions)
      .innerJoin(rawRecords, eq(canonicalTransactions.rawRecordId, rawRecords.id))
      .where(
        and(
          eq(canonicalTransactions.organizationId, orgId),
          eq(canonicalTransactions.side, "books"),
          eq(canonicalTransactions.status, "AVAILABLE"),
          gte(canonicalTransactions.transactionDate, startDate),
          lte(canonicalTransactions.transactionDate, endDate),
          inArray(rawRecords.importId, importIds)
        )
      );
  } else {
    bankRows = await db
      .select()
      .from(canonicalTransactions)
      .where(
        and(
          eq(canonicalTransactions.organizationId, orgId),
          eq(canonicalTransactions.side, "money"),
          eq(canonicalTransactions.status, "AVAILABLE"),
          gte(canonicalTransactions.transactionDate, startDate),
          lte(canonicalTransactions.transactionDate, endDate)
        )
      );

    ledgerRows = await db
      .select()
      .from(canonicalTransactions)
      .where(
        and(
          eq(canonicalTransactions.organizationId, orgId),
          eq(canonicalTransactions.side, "books"),
          eq(canonicalTransactions.status, "AVAILABLE"),
          gte(canonicalTransactions.transactionDate, startDate),
          lte(canonicalTransactions.transactionDate, endDate)
        )
      );
  }

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
    .values({ userId, organizationId: orgId, periodStart, periodEnd, totalTransactions: bankRows.length, status: "running" })
    .returning();

  try {
    // Map to engine types
    const engineBanks = bankRows.map((b) => ({
      id: b.id,
      amount: Number(b.amountMinor),
      date: new Date(b.transactionDate),
      description: b.description ?? "",
      referenceId: b.referenceNumber ?? "",
      direction: b.direction,
      currency: b.currency,
      baseCurrency: b.baseCurrency ?? undefined,
      convertedAmountMinor: b.convertedAmountMinor ? Number(b.convertedAmountMinor) : undefined,
      fxStatus: b.fxStatus,
      counterparty: b.counterpartyName ?? undefined,
      matchingSignals: b.metadata?.matchingSignals,
    }));

    const engineLedgers = ledgerRows.map((l) => ({
      id: l.id,
      amount: Number(l.amountMinor),
      date: new Date(l.transactionDate),
      memo: l.description ?? "",
      invoiceRef: l.referenceNumber ?? "",
      direction: l.direction,
      currency: l.currency,
      baseCurrency: l.baseCurrency ?? undefined,
      convertedAmountMinor: l.convertedAmountMinor ? Number(l.convertedAmountMinor) : undefined,
      fxStatus: l.fxStatus,
      counterparty: l.counterpartyName ?? undefined,
      matchingSignals: l.metadata?.matchingSignals,
    }));

    // Run 4-pass matching engine
    const matchResults = matchTransactions(engineBanks, engineLedgers);

    // AI Reasoning Phase 9
    // Uses a shared RunTracker (circuit breaker) so one bad Gemini response
    // doesn't poison the entire run. Concurrency is capped at MAX_CONCURRENT_AI.
    const tracker = new RunTracker();

    const aiTaskFns = matchResults.map((match) => async () => {
      // Skip trivially exact matches and fully unmatched ledger entries
      const skipAI =
        (match.matchType === "exact" && match.confidenceScore >= 0.95) ||
        match.matchType === "unmatched_ledger";

      if (skipAI) return { ...match, aiResult: null as null };

      const bankTxn = engineBanks.find((b) => match.bankTransactionIds.includes(b.id))!;
      const candidates = engineLedgers.filter((l) => match.ledgerEntryIds.includes(l.id));

      try {
        const { reasoning, renderedExplanation } = await generateMatchReasoning(
          bankTxn.id,
          orgId,
          bankTxn,
          candidates,
          match,
          tracker
        );
        return { ...match, aiResult: reasoning, renderedExplanation };
      } catch {
        return { ...match, aiResult: null as null, renderedExplanation: undefined };
      }
    });

    const enhancedMatches = await limitConcurrency(aiTaskFns, MAX_CONCURRENT_AI);

    // Persist in a single DB transaction
    let autoMatched = 0;
    let needsReview = 0;
    let exceptions = 0;

    await db.transaction(async (tx) => {
      for (const match of enhancedMatches) {
        // unmatched_ledger: a ledger entry with no corresponding bank transaction.
        // Persisted as an exception and updates the canonical status.
        if (match.matchType === "unmatched_ledger") {
          exceptions++;
          for (const lId of match.ledgerEntryIds) {
            await tx.insert(matches).values({
              userId,
              ledgerEntryIds: [lId],
              confidenceScore: "0",
              matchType: "unmatched_ledger",
              status: "pending",
              reasonText: "Unmatched ledger entry.",
              riskScore: match.riskScore || 0,
            });
            await tx
              .update(canonicalTransactions)
              .set({ status: "MATCHED_PENDING" })
              .where(eq(canonicalTransactions.id, lId));
          }
          continue;
        }

        const isAutoApprove =
          match.matchType === "utr_exact" ||
          (match.matchType === "exact" && match.confidenceBand === "VERY_HIGH");
        const status = isAutoApprove ? "approved" : "pending";

        if (isAutoApprove) {
          autoMatched++;
        } else if (match.matchType === "none" && match.classification.discrepancyType !== "NONE") {
          // Classified exception (duplicate, missing entry) — genuinely unresolvable
          exceptions++;
        } else if (match.matchType === "none") {
          // No match found but no specific exception type — needs human review
          needsReview++;
        } else {
          needsReview++;
        }

        const reasoning = (match as any).aiResult ?? null;
        const renderedExplanation = (match as any).renderedExplanation;
        const reasonText = renderedExplanation ?? fallbackReason(match.matchType);

        // Backward-compatible evidence shape for legacy services
        // (exceptions.service.ts and reports.service.ts read .likelyReason, .requiresHumanReview, .flags)
        const evidence = reasoning
          ? {
              likelyReason: reasoning.likelyReason ?? "no_match",
              requiresHumanReview: reasoning.requiresHumanReview,
              flags: reasoning.flags ?? [],
              explanation: reasonText,
            }
          : null;

        for (const bId of match.bankTransactionIds) {
          await tx.insert(matches).values({
            userId,
            bankTransactionId: bId,
            ledgerEntryIds: match.ledgerEntryIds,
            confidenceScore: match.confidenceScore.toString(),
            matchType: match.matchType,
            matchOutcome: match.classification.matchOutcome,
            discrepancyType: match.classification.discrepancyType,
            classificationEvidence: match.classification.evidence,
            reasonText,
            evidence,
            riskScore: match.riskScore,
            status,
          });
        }

        // Set status in canonicalTransactions
        if (match.matchType !== "none") {
          const newStatus = isAutoApprove ? "LOCKED_APPROVED" : "MATCHED_PENDING";
          await tx
            .update(canonicalTransactions)
            .set({ status: newStatus })
            .where(inArray(canonicalTransactions.id, match.bankTransactionIds));

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

    // Rebuild metrics so the dashboard updates immediately
    await rebuildDailyMetricsRange(orgId, startDate, endDate);

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
    default: return "No matching ledger entries found.";
  }
}
