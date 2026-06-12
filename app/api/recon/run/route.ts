import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { db } from "@/core/db";
import { users, bankTransactions, ledgerEntries, reconRuns, matches } from "@/core/db/schema";
import { eq, and, between } from "drizzle-orm";
import { matchTransactions } from "@/core/matching/engine";
import { generateMatchReason } from "@/lib/ai-reason";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { periodStart, periodEnd } = body;
    if (!periodStart || !periodEnd) {
      return Response.json({ error: "Missing periodStart or periodEnd" }, { status: 400 });
    }

    const startDate = new Date(periodStart);
    const endDate = new Date(periodEnd);

    const bankRowsResult = await db
      .select()
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.userId, userId),
          eq(bankTransactions.status, "unmatched")
          // TODO: Add date filtering if string date can be compared or use between
        )
      );

    const bankRows = bankRowsResult.filter(r => {
      const d = new Date(r.date);
      return d >= startDate && d <= endDate;
    });

    const ledgerRowsResult = await db
      .select()
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.userId, userId),
          eq(ledgerEntries.status, "unmatched")
        )
      );
      
    const ledgerRows = ledgerRowsResult.filter(r => {
      const d = new Date(r.date);
      return d >= startDate && d <= endDate;
    });

    const [run] = await db
      .insert(reconRuns)
      .values({
        userId,
        periodStart: periodStart,
        periodEnd: periodEnd,
        totalTransactions: bankRows.length,
        status: "running",
      })
      .returning();

    try {
      const engineBanks = bankRows.map((b) => ({
        id: b.id,
        amount: Math.round(Number(b.amount) * 100),
        date: new Date(b.date),
        description: b.description || "",
        referenceId: b.referenceId || "",
      }));

      const engineLedgers = ledgerRows.map((l) => ({
        id: l.id,
        amount: Math.round(Number(l.amount) * 100),
        date: new Date(l.date),
        memo: l.memo || "",
        invoiceRef: l.invoiceRef || "",
      }));

      const matchResults = matchTransactions(engineBanks, engineLedgers);

      // AI Reasoning Pass
      // For any match that is not exact (or exact but low confidence), generate an AI explanation
      const aiTasks = matchResults.map(async (match) => {
        const isExactAutoApprove = match.matchType === "exact" && match.confidenceScore >= 0.95;
        if (isExactAutoApprove || match.matchType === "none") {
          return { ...match, aiResult: null };
        }

        const bankTxn = engineBanks.find(b => b.id === match.bankTransactionId)!;
        const candidates = engineLedgers.filter(l => match.ledgerEntryIds.includes(l.id));

        const aiResult = await generateMatchReason(bankTxn, candidates);
        return { ...match, aiResult };
      });

      // Run AI calls in parallel (capped concurrency if needed, but Promise.allSettled is fine for typical hackathon volumes)
      const aiResults = await Promise.allSettled(aiTasks);
      const enhancedMatches = aiResults.map((result, i) => {
        if (result.status === "fulfilled") return result.value;
        console.error("AI call failed for match", matchResults[i]);
        return { ...matchResults[i], aiResult: null };
      });

      let autoMatched = 0;
      let needsReview = 0;
      let exceptions = 0;

      await db.transaction(async (tx) => {
        for (const match of enhancedMatches) {
          const isExactAutoApprove = match.matchType === "exact" && match.confidenceScore >= 0.95;
          const status = isExactAutoApprove ? "approved" : "pending";

          if (isExactAutoApprove) {
            autoMatched++;
          } else if (match.matchType === "none") {
            exceptions++;
          } else {
            needsReview++;
          }

          let reasonText = "";
          let evidence = null;

          if (match.aiResult) {
            reasonText = match.aiResult.explanation;
            evidence = match.aiResult;
          } else {
            if (match.matchType === "exact") reasonText = "Exact match on amount and date.";
            else if (match.matchType === "bulk") reasonText = "Multiple ledger entries sum precisely to this bank transaction.";
            else if (match.matchType === "fuzzy") reasonText = "Partial match based on similar amount, date, or text references.";
            else reasonText = "No matching ledger entries found.";
          }

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

          if (match.ledgerEntryIds.length > 0) {
            for (const ledgerId of match.ledgerEntryIds) {
              await tx
                .update(ledgerEntries)
                .set({ status: "matched" })
                .where(eq(ledgerEntries.id, ledgerId));
            }
          }
        }

        await tx
          .update(reconRuns)
          .set({
            status: "complete",
            autoMatched,
            needsReview,
            exceptions,
          })
          .where(eq(reconRuns.id, run.id));
      });

      return Response.json({
        runId: run.id,
        stats: {
          total: bankRows.length,
          autoMatched,
          needsReview,
          exceptions,
        },
      });
    } catch (engineError) {
      await db
        .update(reconRuns)
        .set({ status: "failed" })
        .where(eq(reconRuns.id, run.id));
      throw engineError;
    }
  } catch (error) {
    console.error("Recon run error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
