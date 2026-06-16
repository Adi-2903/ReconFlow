import { db } from "@/core/db";
import { matches, bankTransactions } from "@/core/db/schema";
import { eq, and, or, sql, desc } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExceptionItem {
  id: string;
  amount: number;
  date: string;
  source: string;
  reference: string;
  reasonTag: string;
  reasonText: string;
  flags: string[];
}

export interface ExceptionsResult {
  exceptions: ExceptionItem[];
  count: number;
}

// ─── Reason tag mapping (backend engineer can extend this) ────────────────────

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

export async function listExceptions(userId: string): Promise<ExceptionsResult> {
  const exceptionsData = await db
    .select({
      id: matches.id,
      amount: bankTransactions.amount,
      date: bankTransactions.date,
      referenceId: bankTransactions.referenceId,
      source: bankTransactions.source,
      reasonText: matches.reasonText,
      evidence: matches.evidence,
      status: matches.status,
      createdAt: matches.createdAt,
    })
    .from(matches)
    .innerJoin(bankTransactions, eq(matches.bankTransactionId, bankTransactions.id))
    .where(
      and(
        eq(matches.userId, userId),
        or(
          eq(matches.matchType, "none"),
          eq(matches.status, "rejected"),
          sql`${matches.evidence}->>'requiresHumanReview' = 'true'`
        ),
        or(eq(matches.status, "pending"), eq(matches.status, "rejected"))
      )
    )
    .orderBy(desc(bankTransactions.amount));

  const formatted: ExceptionItem[] = exceptionsData.map((exc) => {
    const evidence = (exc.evidence as any) || {};

    let reasonTag = "No ledger match found";
    if (exc.status === "rejected") {
      reasonTag = "Manually rejected";
    } else if (evidence.likelyReason) {
      reasonTag = REASON_MAP[evidence.likelyReason] || reasonTag;
    }

    return {
      id: exc.id,
      amount: Math.round(Number(exc.amount) * 100),
      date: new Date(exc.date).toLocaleDateString("en-IN", {
        month: "short",
        day: "numeric",
      }),
      source: exc.source || "Bank",
      reference: exc.referenceId || "N/A",
      reasonTag,
      reasonText: exc.reasonText || "Manual review required.",
      flags: evidence.flags || [],
    };
  });

  return { exceptions: formatted, count: formatted.length };
}
