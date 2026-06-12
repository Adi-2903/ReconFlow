import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { db } from "@/core/db";
import { users, matches, bankTransactions, ledgerEntries } from "@/core/db/schema";
import { eq, inArray, and } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const filter = searchParams.get("filter") || "all";

    // Although runId is required, we don't have it on the match table.
    // We will just fetch the matches for the user. We apply the filter logic.
    const allMatches = await db
      .select({
        match: matches,
        bankTx: bankTransactions,
      })
      .from(matches)
      .innerJoin(bankTransactions, eq(matches.bankTransactionId, bankTransactions.id))
      .where(eq(matches.userId, userId));

    let filtered = allMatches;
    if (filter === "pending") {
      filtered = filtered.filter((m) => m.match.status === "pending" && m.match.matchType !== "none");
    } else if (filter === "approved") {
      filtered = filtered.filter((m) => m.match.status === "approved");
    } else if (filter === "rejected") {
      filtered = filtered.filter((m) => m.match.status === "rejected");
    } else if (filter === "exceptions") {
      filtered = filtered.filter((m) => m.match.matchType === "none");
    }

    // Collect all ledger Ids to fetch
    const ledgerIdSet = new Set<string>();
    filtered.forEach((item) => {
      if (item.match.ledgerEntryIds) {
        item.match.ledgerEntryIds.forEach((id) => ledgerIdSet.add(id));
      }
    });

    const allLedgerIds = Array.from(ledgerIdSet);
    let ledgers = [] as any[];
    if (allLedgerIds.length > 0) {
      ledgers = await db
        .select()
        .from(ledgerEntries)
        .where(inArray(ledgerEntries.id, allLedgerIds));
    }

    const ledgerMap = new Map();
    ledgers.forEach((l) => ledgerMap.set(l.id, l));

    const results = filtered.map((item) => {
      const match = item.match;
      const bankTx = item.bankTx;
      const matchLedgers = (match.ledgerEntryIds || []).map((id) => ledgerMap.get(id)).filter(Boolean);

      return {
        id: match.id,
        bankRow: {
          amount: Number(bankTx.amount),
          date: bankTx.date,
          description: bankTx.description || "",
          referenceId: bankTx.referenceId || "",
          source: bankTx.source || "unknown",
        },
        ledgerRows: matchLedgers.map((l) => ({
          amount: Number(l.amount),
          date: l.date,
          memo: l.memo || "",
          invoiceRef: l.invoiceRef || "",
        })),
        ledgerRow: matchLedgers.length === 1 ? {
          amount: Number(matchLedgers[0].amount),
          date: matchLedgers[0].date,
          memo: matchLedgers[0].memo || "",
          invoiceRef: matchLedgers[0].invoiceRef || "",
        } : null,
        confidenceScore: Number(match.confidenceScore || 0),
        matchType: match.matchType,
        reasonText: match.reasonText || "",
        scoringBreakdown: { amountScore: 0, dateScore: 0, textScore: 0 }, // Stubbed, could be persisted if needed
        status: match.status,
      };
    });

    results.sort((a, b) => {
      if (a.matchType === "none" && b.matchType !== "none") return -1;
      if (b.matchType === "none" && a.matchType !== "none") return 1;
      return a.confidenceScore - b.confidenceScore;
    });

    return Response.json(results);
  } catch (error) {
    console.error("Fetch matches error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
