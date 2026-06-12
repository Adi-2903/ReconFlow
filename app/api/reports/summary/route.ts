import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { db } from "@/core/db";
import { bankTransactions, matches } from "@/core/db/schema";
import { eq, and, or, sql, desc, between } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = req.nextUrl.searchParams;
    const periodStartStr = searchParams.get("periodStart");
    const periodEndStr = searchParams.get("periodEnd");

    if (!periodStartStr || !periodEndStr) {
      return Response.json({ error: "Missing periodStart or periodEnd" }, { status: 400 });
    }

    const startDate = new Date(periodStartStr);
    const endDate = new Date(periodEndStr);

    // Get all bank transactions for the period
    const periodBankTxns = await db
      .select({ id: bankTransactions.id })
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.userId, userId),
          // We assume date strings can be compared directly if they are stored as ISO, or we can use SQL between
          // For now, fetch all and filter, or use raw SQL since drizzle 'between' works with strings if date columns are used
        )
      );

    // Filter in JS since dates might be stored as strings in local setup
    const validBankTxnIds = new Set(periodBankTxns.filter(b => {
      // Drizzle dates from Neon might be YYYY-MM-DD
      // we'll skip strict date filtering at the DB level for robust hackathon dev, filter in JS
      return true; // Assume we want to show stats for everything right now, or properly filter
    }).map(b => b.id));

    const allMatches = await db
      .select({
        id: matches.id,
        matchType: matches.matchType,
        status: matches.status,
        confidenceScore: matches.confidenceScore,
        evidence: matches.evidence,
        amount: bankTransactions.amount,
        date: bankTransactions.date,
        source: bankTransactions.source,
        reasonText: matches.reasonText,
      })
      .from(matches)
      .innerJoin(bankTransactions, eq(matches.bankTransactionId, bankTransactions.id))
      .where(eq(matches.userId, userId));

    let totalTransactions = 0;
    let autoMatched = 0;
    let manualReview = 0;
    let exceptionsCount = 0;
    const exceptionsList: any[] = [];

    // Filter by period dates
    const filteredMatches = allMatches.filter(m => {
      const d = new Date(m.date);
      return d >= startDate && d <= endDate;
    });

    for (const m of filteredMatches) {
      totalTransactions++;
      
      const isAuto = m.matchType === "exact" && m.status === "approved" && Number(m.confidenceScore) >= 0.95;
      const isManual = m.matchType !== "none" && m.status === "approved" && !isAuto;
      
      const evidence = (m.evidence as any) || {};
      const isException = m.matchType === "none" || m.status === "rejected" || evidence.requiresHumanReview === true;
      const isUnresolvedException = isException && (m.status === "pending" || m.status === "rejected");

      if (isAuto) {
        autoMatched++;
      } else if (isManual) {
        manualReview++;
      }
      
      if (isUnresolvedException) {
        exceptionsCount++;
        
        let reasonTag = "No ledger match found";
        if (m.status === "rejected") {
          reasonTag = "Manually rejected";
        } else if (evidence.likelyReason) {
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

        exceptionsList.push({
          id: m.id,
          amount: Math.round(Number(m.amount) * 100),
          date: new Date(m.date).toLocaleDateString("en-IN", { month: "short", day: "numeric" }),
          source: m.source || "Bank",
          reasonTag,
          status: "Pending",
          statusColor: "text-red-700 bg-red-100"
        });
      } else if (isException && m.status === "approved") {
        // resolved exception
        exceptionsList.push({
          id: m.id,
          amount: Math.round(Number(m.amount) * 100),
          date: new Date(m.date).toLocaleDateString("en-IN", { month: "short", day: "numeric" }),
          source: m.source || "Bank",
          reasonTag: "Resolved by user",
          status: "Resolved",
          statusColor: "text-green-700 bg-green-100"
        });
      }
    }

    // Sort exceptions by amount descending, unresolved first
    exceptionsList.sort((a, b) => {
      if (a.status === "Pending" && b.status !== "Pending") return -1;
      if (a.status !== "Pending" && b.status === "Pending") return 1;
      return Math.abs(b.amount) - Math.abs(a.amount);
    });

    const percentage = totalTransactions > 0 ? ((autoMatched / totalTransactions) * 100).toFixed(1) : "0.0";

    return Response.json({
      stats: {
        total: totalTransactions.toString(),
        autoMatched: autoMatched.toString(),
        manualReview: manualReview.toString(),
        exceptions: exceptionsCount.toString(),
        percentage
      },
      topExceptions: exceptionsList.slice(0, 5)
    });
  } catch (error) {
    console.error("Error fetching reports summary:", error);
    return Response.json({ error: "Failed to fetch reports summary" }, { status: 500 });
  }
}
