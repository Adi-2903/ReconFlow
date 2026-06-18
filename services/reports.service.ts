import { db } from "@/core/db";
import { matches, canonicalTransactions } from "@/core/db/schema";
import { eq } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReportStats {
  total: string;
  autoMatched: string;
  manualReview: string;
  exceptions: string;
  percentage: string;
}

export interface ReportException {
  id: string;
  amount: number;
  date: string;
  source: string;
  reasonTag: string;
  status: string;
  statusColor: string;
}

export interface ReportSummaryResult {
  stats: ReportStats;
  topExceptions: ReportException[];
}

// ─── Reason tag mapping ───────────────────────────────────────────────────────

const REASON_MAP: Record<string, string> = {
  stripe_fee: "Stripe fee deduction",
  neft_charge: "Bank processing charge",
  fx_conversion: "Currency conversion",
  partial_payment: "Partial payment",
  bulk_payment: "Bulk payment mismatch",
  duplicate_risk: "Duplicate detected",
  large_delta: "Amount mismatch > ₹1,000",
  unknown_counterparty: "Unknown counterparty",
  no_match: "No ledger match found",
};

// ─── Service functions ────────────────────────────────────────────────────────

export async function getReportSummary(
  userId: string,
  periodStart: string,
  periodEnd: string
): Promise<ReportSummaryResult> {
  const startDate = new Date(periodStart);
  const endDate = new Date(periodEnd);

  const allMatches = await db
    .select({
      id: matches.id,
      matchType: matches.matchType,
      status: matches.status,
      confidenceScore: matches.confidenceScore,
      evidence: matches.evidence,
      amountMinor: canonicalTransactions.amountMinor,
      date: canonicalTransactions.transactionDate,
      metadata: canonicalTransactions.metadata,
      reasonText: matches.reasonText,
    })
    .from(matches)
    .innerJoin(canonicalTransactions, eq(matches.bankTransactionId, canonicalTransactions.id))
    .where(eq(matches.userId, userId));

  // Filter to period in JS (handles both ISO string and Date column formats)
  const filteredMatches = allMatches.filter((m) => {
    const d = new Date(m.date);
    return d >= startDate && d <= endDate;
  });

  let totalTransactions = 0;
  let autoMatched = 0;
  let manualReview = 0;
  let exceptionsCount = 0;
  const exceptionsList: ReportException[] = [];

  for (const m of filteredMatches) {
    totalTransactions++;

    const evidence = (m.evidence as any) || {};
    const isAuto = m.matchType === "exact" && m.status === "approved" && Number(m.confidenceScore) >= 0.95;
    const isManual = m.matchType !== "none" && m.status === "approved" && !isAuto;
    const isException =
      m.matchType === "none" || m.status === "rejected" || evidence.requiresHumanReview === true;

    if (isAuto) autoMatched++;
    else if (isManual) manualReview++;

    if (isException) {
      let reasonTag = "No ledger match found";
      if (m.status === "rejected") reasonTag = "Manually rejected";
      else if (evidence.likelyReason) reasonTag = REASON_MAP[evidence.likelyReason] || reasonTag;

      const isUnresolved = m.status === "pending" || m.status === "rejected";
      if (isUnresolved) exceptionsCount++;

      const metadata = (m.metadata as any) || {};

      exceptionsList.push({
        id: m.id,
        amount: Number(m.amountMinor),
        date: new Date(m.date).toLocaleDateString("en-IN", { month: "short", day: "numeric" }),
        source: metadata.source || "Bank",
        reasonTag,
        status: isUnresolved ? "Pending" : "Resolved",
        statusColor: isUnresolved ? "text-red-700 bg-red-100" : "text-green-700 bg-green-100",
      });
    }
  }

  exceptionsList.sort((a, b) => {
    if (a.status === "Pending" && b.status !== "Pending") return -1;
    if (a.status !== "Pending" && b.status === "Pending") return 1;
    return Math.abs(b.amount) - Math.abs(a.amount);
  });

  const percentage =
    totalTransactions > 0 ? ((autoMatched / totalTransactions) * 100).toFixed(1) : "0.0";

  return {
    stats: {
      total: totalTransactions.toString(),
      autoMatched: autoMatched.toString(),
      manualReview: manualReview.toString(),
      exceptions: exceptionsCount.toString(),
      percentage,
    },
    topExceptions: exceptionsList.slice(0, 5),
  };
}
