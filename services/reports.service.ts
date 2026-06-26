import { db } from "@/core/db";
import { matches, canonicalTransactions, organizations, dailyMetrics, auditEvents } from "@/core/db/schema";
import { eq, and, ne, sql, inArray } from "drizzle-orm";
import { toMetricDate } from "@/core/utils/dateUtils";
import { getOrCreateUserOrganization } from "@/core/db/org-helper";
import { desc, asc, gte, lte } from "drizzle-orm";

export const REPORT_VERSION = "v1" as const;

export const HIGH_RISK_CONFIDENCE_THRESHOLD = 0.5;
export const HIGH_RISK_AMOUNT_DISCREPANCY_THRESHOLD = 0.05;

export interface ReportMetadata {
  reportVersion: typeof REPORT_VERSION;
  generatedAt: string;
  generatedBy: string;
  periodStart: string;
  periodEnd: string;
  reportType: string;
  organizationName: string;
}

export async function getReconciliationSummaryReport(
  userId: string,
  start: string,
  end: string
) {
  const orgId = await getOrCreateUserOrganization(userId);
  const metrics = await db
    .select({
      totalCount: sql<number>`SUM(${dailyMetrics.totalCount})`,
      matchedCount: sql<number>`SUM(${dailyMetrics.matchedCount})`,
      pendingCount: sql<number>`SUM(${dailyMetrics.pendingCount})`,
      unmatchedCount: sql<number>`SUM(${dailyMetrics.unmatchedCount})`,
      highRiskCount: sql<number>`SUM(${dailyMetrics.highRiskCount})`,
      totalVolumeMinor: sql<bigint>`SUM(${dailyMetrics.totalVolumeMinor})`,
      feeVolumeMinor: sql<bigint>`SUM(${dailyMetrics.feeVolumeMinor})`,
      fxVolumeMinor: sql<bigint>`SUM(${dailyMetrics.fxVolumeMinor})`,
    })
    .from(dailyMetrics)
    .where(
      and(
        eq(dailyMetrics.organizationId, orgId),
        gte(dailyMetrics.metricDate, toMetricDate(new Date(start))),
        lte(dailyMetrics.metricDate, toMetricDate(new Date(end)))
      )
    );

  return metrics[0] || {
    totalCount: 0,
    matchedCount: 0,
    pendingCount: 0,
    unmatchedCount: 0,
    highRiskCount: 0,
    totalVolumeMinor: 0n,
    feeVolumeMinor: 0n,
    fxVolumeMinor: 0n,
  };
}

export async function getExceptionReport(userId: string, start: string, end: string, page: number, limit: number) {
  const orgId = await getOrCreateUserOrganization(userId);
  const offset = (page - 1) * limit;

  // The total exception count is available from daily_metrics without scanning transactions
  const totalRes = await db
    .select({ exceptionsCount: sql<number>`SUM(${dailyMetrics.unmatchedCount} + ${dailyMetrics.pendingCount})` })
    .from(dailyMetrics)
    .where(and(eq(dailyMetrics.organizationId, orgId), gte(dailyMetrics.metricDate, toMetricDate(new Date(start))), lte(dailyMetrics.metricDate, toMetricDate(new Date(end)))));
  
  const totalCount = Number(totalRes[0]?.exceptionsCount || 0);

  // Paginated drill-down query
  const data = await db
    .select({
      id: matches.id,
      bankTxId: canonicalTransactions.id,
      amountMinor: canonicalTransactions.amountMinor,
      date: canonicalTransactions.transactionDate,
      source: canonicalTransactions.sourceSystem,
      status: matches.status,
      evidence: matches.evidence,
      reasonText: matches.reasonText
    })
    .from(matches)
    .innerJoin(canonicalTransactions, eq(matches.bankTransactionId, canonicalTransactions.id))
    .where(
      and(
        eq(canonicalTransactions.organizationId, orgId),
        gte(canonicalTransactions.transactionDate, new Date(start)),
        lte(canonicalTransactions.transactionDate, new Date(end)),
        ne(matches.status, "superseded"),
        sql`(${matches.matchType} = 'none' OR ${matches.status} IN ('rejected', 'pending'))`
      )
    )
    .orderBy(desc(canonicalTransactions.transactionDate), desc(canonicalTransactions.id))
    .limit(limit)
    .offset(offset);

  return { data, totalCount, page, limit };
}

export async function getFeeReport(userId: string, start: string, end: string, page: number, limit: number) {
  const orgId = await getOrCreateUserOrganization(userId);
  const offset = (page - 1) * limit;

  const countRes = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(matches)
    .innerJoin(canonicalTransactions, eq(matches.bankTransactionId, canonicalTransactions.id))
    .where(
      and(
        eq(canonicalTransactions.organizationId, orgId),
        gte(canonicalTransactions.transactionDate, new Date(start)),
        lte(canonicalTransactions.transactionDate, new Date(end)),
        eq(matches.discrepancyType, "PROCESSING_FEE")
      )
    );
  const totalCount = Number(countRes[0]?.count || 0);

  const data = await db
    .select({
      id: matches.id,
      amountMinor: canonicalTransactions.amountMinor,
      date: canonicalTransactions.transactionDate,
      reasonText: matches.reasonText
    })
    .from(matches)
    .innerJoin(canonicalTransactions, eq(matches.bankTransactionId, canonicalTransactions.id))
    .where(
      and(
        eq(canonicalTransactions.organizationId, orgId),
        gte(canonicalTransactions.transactionDate, new Date(start)),
        lte(canonicalTransactions.transactionDate, new Date(end)),
        eq(matches.discrepancyType, "PROCESSING_FEE")
      )
    )
    .orderBy(desc(canonicalTransactions.transactionDate), desc(canonicalTransactions.id))
    .limit(limit)
    .offset(offset);

  return { data, totalCount, page, limit };
}

export async function getFXReport(userId: string, start: string, end: string, page: number, limit: number) {
  const orgId = await getOrCreateUserOrganization(userId);
  const offset = (page - 1) * limit;

  const countRes = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(matches)
    .innerJoin(canonicalTransactions, eq(matches.bankTransactionId, canonicalTransactions.id))
    .where(
      and(
        eq(canonicalTransactions.organizationId, orgId),
        gte(canonicalTransactions.transactionDate, new Date(start)),
        lte(canonicalTransactions.transactionDate, new Date(end)),
        eq(matches.discrepancyType, "FOREIGN_EXCHANGE")
      )
    );
  const totalCount = Number(countRes[0]?.count || 0);

  const data = await db
    .select({
      id: matches.id,
      amountMinor: canonicalTransactions.amountMinor,
      date: canonicalTransactions.transactionDate,
      reasonText: matches.reasonText
    })
    .from(matches)
    .innerJoin(canonicalTransactions, eq(matches.bankTransactionId, canonicalTransactions.id))
    .where(
      and(
        eq(canonicalTransactions.organizationId, orgId),
        gte(canonicalTransactions.transactionDate, new Date(start)),
        lte(canonicalTransactions.transactionDate, new Date(end)),
        eq(matches.discrepancyType, "FOREIGN_EXCHANGE")
      )
    )
    .orderBy(desc(canonicalTransactions.transactionDate), desc(canonicalTransactions.id))
    .limit(limit)
    .offset(offset);

  return { data, totalCount, page, limit };
}

export async function getAuditActivityReport(userId: string, start: string, end: string, page: number, limit: number) {
  const orgId = await getOrCreateUserOrganization(userId);
  const offset = (page - 1) * limit;

  // Audit events are joined with matches and canonicalTransactions to scope them to the org
  // For events without a matchId (like DAILY_METRICS_REBUILD), we can't easily join, 
  // but to keep it simple and within the Phase 11 constraint of using what's available,
  // we join what we can or rely on userId. For safety and isolation, we'll join matches
  // and canonicalTransactions.
  const countRes = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(auditEvents)
    .leftJoin(matches, eq(auditEvents.matchId, matches.id))
    .leftJoin(canonicalTransactions, eq(matches.bankTransactionId, canonicalTransactions.id))
    .where(
      and(
        // Either it's tied to this org's transactions OR it's a global org action performed by this user
        sql`(${canonicalTransactions.organizationId} = ${orgId} OR (${auditEvents.matchId} IS NULL AND ${auditEvents.userId} = ${userId}))`,
        gte(auditEvents.timestamp, new Date(start)),
        lte(auditEvents.timestamp, new Date(end))
      )
    );
  
  const totalCount = Number(countRes[0]?.count || 0);

  const data = await db
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      actorEmail: auditEvents.actorEmail,
      timestamp: auditEvents.timestamp,
      reason: auditEvents.reason,
      metadata: auditEvents.metadata
    })
    .from(auditEvents)
    .leftJoin(matches, eq(auditEvents.matchId, matches.id))
    .leftJoin(canonicalTransactions, eq(matches.bankTransactionId, canonicalTransactions.id))
    .where(
      and(
        sql`(${canonicalTransactions.organizationId} = ${orgId} OR (${auditEvents.matchId} IS NULL AND ${auditEvents.userId} = ${userId}))`,
        gte(auditEvents.timestamp, new Date(start)),
        lte(auditEvents.timestamp, new Date(end))
      )
    )
    .orderBy(desc(auditEvents.timestamp), desc(auditEvents.id))
    .limit(limit)
    .offset(offset);

  return { data, totalCount, page, limit };
}

export async function getRiskReport(userId: string, start: string, end: string, page: number, limit: number) {
  const orgId = await getOrCreateUserOrganization(userId);
  const offset = (page - 1) * limit;

  const totalRes = await db
    .select({ count: sql<number>`SUM(${dailyMetrics.highRiskCount})` })
    .from(dailyMetrics)
    .where(and(eq(dailyMetrics.organizationId, orgId), gte(dailyMetrics.metricDate, toMetricDate(new Date(start))), lte(dailyMetrics.metricDate, toMetricDate(new Date(end)))));
  
  const totalCount = Number(totalRes[0]?.count || 0);

  const data = await db
    .select({
      id: matches.id,
      amountMinor: canonicalTransactions.amountMinor,
      date: canonicalTransactions.transactionDate,
      riskScore: matches.riskScore,
      confidenceScore: matches.confidenceScore
    })
    .from(matches)
    .innerJoin(canonicalTransactions, eq(matches.bankTransactionId, canonicalTransactions.id))
    .where(
      and(
        eq(canonicalTransactions.organizationId, orgId),
        gte(canonicalTransactions.transactionDate, new Date(start)),
        lte(canonicalTransactions.transactionDate, new Date(end)),
        sql`(${matches.confidenceScore} < ${HIGH_RISK_CONFIDENCE_THRESHOLD} OR ${matches.matchType} IN ('unmatched_bank', 'unmatched_ledger'))`
      )
    )
    .orderBy(desc(canonicalTransactions.transactionDate), desc(canonicalTransactions.id))
    .limit(limit)
    .offset(offset);

  return { data, totalCount, page, limit };
}

/**
 * Rebuilds daily metrics for a given organization and date range.
 * Uses monthly chunking to avoid loading massive history into memory.
 * Idempotently upserts metrics per day per org.
 */
export async function rebuildDailyMetricsRange(
  organizationId: string,
  startDate: Date,
  endDate: Date
): Promise<void> {
  await db.transaction(async (tx) => {
    // 1. Advisory Lock: tenant-scoped transaction lock
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('METRICS_' || ${organizationId}::text))`
    );

    // Fetch org timezone
    const [org] = await tx
      .select({ timezone: organizations.timezone })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    
    const timezone = org?.timezone || "Asia/Kolkata";

    // 2. Monthly Chunking
    let currentChunkStart = new Date(startDate);
    while (currentChunkStart <= endDate) {
      let currentChunkEnd = new Date(currentChunkStart.getFullYear(), currentChunkStart.getMonth() + 1, 0, 23, 59, 59, 999);
      if (currentChunkEnd > endDate) currentChunkEnd = endDate;

      // 3. Read Historical Data (Reconciliation is driven from the bank side only)
      const records = await tx
        .select({
          txn: canonicalTransactions,
          match: matches,
        })
        .from(canonicalTransactions)
        .leftJoin(matches, eq(matches.bankTransactionId, canonicalTransactions.id))
        .where(
          and(
            eq(canonicalTransactions.organizationId, organizationId),
            eq(canonicalTransactions.side, "money"),
            sql`${canonicalTransactions.transactionDate} >= ${currentChunkStart.toISOString()}`,
            sql`${canonicalTransactions.transactionDate} <= ${currentChunkEnd.toISOString()}`
          )
        );

      // 4. Aggregation using Metric Date
      const dailyAggregates = new Map<string, any>();

      for (const row of records) {
        // Must use the single source of truth for date normalization
        const metricDateStr = toMetricDate(row.txn.transactionDate, timezone);
        
        if (!dailyAggregates.has(metricDateStr)) {
          dailyAggregates.set(metricDateStr, {
            totalCount: 0,
            matchedCount: 0,
            pendingCount: 0,
            unmatchedCount: 0,
            highRiskCount: 0,
            totalVolumeMinor: 0n,
            feeVolumeMinor: 0n,
            fxVolumeMinor: 0n,
          });
        }
        
        const agg = dailyAggregates.get(metricDateStr)!;
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
            agg.unmatchedCount += 1; // rejected/superseded fall back to unmatched in context of resolution
          }
          
          if (row.match.riskScore && row.match.riskScore > 0) {
            agg.highRiskCount += 1;
          }
          
          if (row.match.discrepancyType === "PROCESSING_FEE") {
             agg.feeVolumeMinor += amountMinor; 
          } else if (row.match.discrepancyType === "FOREIGN_EXCHANGE") {
             agg.fxVolumeMinor += amountMinor;
          }
        } else {
          agg.unmatchedCount += 1;
        }
      }

      // 5. Upsert
      if (dailyAggregates.size > 0) {
        const insertData = Array.from(dailyAggregates.entries()).map(([dateStr, agg]) => ({
          metricDate: dateStr,
          organizationId,
          totalCount: agg.totalCount,
          matchedCount: agg.matchedCount,
          pendingCount: agg.pendingCount,
          unmatchedCount: agg.unmatchedCount,
          highRiskCount: agg.highRiskCount,
          totalVolumeMinor: agg.totalVolumeMinor,
          feeVolumeMinor: agg.feeVolumeMinor,
          fxVolumeMinor: agg.fxVolumeMinor,
        }));

        await tx
          .insert(dailyMetrics)
          .values(insertData)
          .onConflictDoUpdate({
            target: [dailyMetrics.organizationId, dailyMetrics.metricDate],
            set: {
              totalCount: sql`EXCLUDED.total_count`,
              matchedCount: sql`EXCLUDED.matched_count`,
              pendingCount: sql`EXCLUDED.pending_count`,
              unmatchedCount: sql`EXCLUDED.unmatched_count`,
              highRiskCount: sql`EXCLUDED.high_risk_count`,
              totalVolumeMinor: sql`EXCLUDED.total_volume_minor`,
              feeVolumeMinor: sql`EXCLUDED.fee_volume_minor`,
              fxVolumeMinor: sql`EXCLUDED.fx_volume_minor`,
              updatedAt: sql`now()`,
            }
          });
      }

      // Advance to the 1st of the next month
      currentChunkStart = new Date(currentChunkStart.getFullYear(), currentChunkStart.getMonth() + 1, 1);
    }
  });
}

