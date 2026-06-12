import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { db } from "@/core/db";
import { bankTransactions, matches } from "@/core/db/schema";
import { eq, and, or, sql, desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Query matches joined with bank transactions for exceptions
    // An exception is: matchType = 'none' OR status = 'rejected' OR evidence->>'requiresHumanReview' = 'true'
    const exceptionsData = await db
      .select({
        id: matches.id,
        amount: bankTransactions.amount,
        date: bankTransactions.date,
        rawNarration: bankTransactions.description,
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
          or(
            eq(matches.status, "pending"),
            eq(matches.status, "rejected")
          ) // Only show unresolved exceptions
        )
      )
      .orderBy(desc(bankTransactions.amount));

    const formattedExceptions = exceptionsData.map(exc => {
      const evidence = (exc.evidence as any) || {};
      
      // Determine the best reason tag
      let reasonTag = "No ledger match found";
      if (exc.status === "rejected") {
        reasonTag = "Manually rejected";
      } else if (evidence.likelyReason) {
        // Map the raw reason to a human readable tag
        const reasonMap: Record<string, string> = {
          "stripe_fee": "Stripe fee deduction",
          "neft_charge": "Bank processing charge",
          "fx_conversion": "Currency conversion",
          "partial_payment": "Partial payment",
          "bulk_payment": "Bulk payment mismatch",
          "duplicate_risk": "Duplicate detected",
          "large_delta": "Amount mismatch > ₹1,000",
          "unknown_counterparty": "Unknown counterparty",
          "no_match": "No ledger match found"
        };
        reasonTag = reasonMap[evidence.likelyReason] || reasonTag;
      }

      return {
        id: exc.id,
        amount: Math.round(Number(exc.amount) * 100), // convert to paise if stored as decimal rupees, or keep if already paise
        date: new Date(exc.date).toLocaleDateString("en-IN", { month: "short", day: "numeric" }),
        source: exc.source || "Bank",
        reference: exc.referenceId || "N/A",
        reasonTag,
        reasonText: exc.reasonText || "Manual review required.",
        flags: evidence.flags || []
      };
    });

    return Response.json({
      exceptions: formattedExceptions,
      count: formattedExceptions.length
    });
  } catch (error) {
    console.error("Error fetching exceptions:", error);
    return Response.json({ error: "Failed to fetch exceptions" }, { status: 500 });
  }
}
