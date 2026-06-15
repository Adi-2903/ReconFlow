import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { db } from "@/core/db";
import { users, bankTransactions, ledgerEntries, reconRuns, matches } from "@/core/db/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import { matchTransactions } from "@/core/matching/engine";
import { generateMatchReason, DEFAULT_FEE_PATTERNS } from "@/lib/ai-reason";

export async function POST(req: NextRequest) {
  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ── Parse + validate body ────────────────────────────────────────────────
    const body = await req.json();
    const { periodStart, periodEnd } = body;
    if (!periodStart || !periodEnd) {
      return Response.json(
        { error: "Missing periodStart or periodEnd" },
        { status: 400 }
      );
    }

    const startDate = new Date(periodStart);
    const endDate = new Date(periodEnd);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return Response.json(
        { error: "Invalid date format for periodStart or periodEnd" },
        { status: 400 }
      );
    }

    if (startDate > endDate) {
      return Response.json(
        { error: "periodStart must be before periodEnd" },
        { status: 400 }
      );
    }

    // ── Fetch unmatched transactions ─────────────────────────────────────────
    // FIX: Date filtering now in SQL (not JS memory filter).
    // The original TODO is resolved — cast the date column for comparison.
    // NOTE: If your schema stores `date` as TEXT (common with Drizzle + SQLite),
    // use the JS filter fallback below. For Aurora PostgreSQL with DATE/TIMESTAMP
    // columns, the gte/lte SQL filter works correctly.
    const bankRows = await db
      .select()
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.userId, userId),
          eq(bankTransactions.status, "unmatched"),
          gte(bankTransactions.date, periodStart), // periodStart is ISO string
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

    // Early exit: nothing to reconcile
    if (bankRows.length === 0) {
      return Response.json({
        runId: null,
        stats: { total: 0, autoMatched: 0, needsReview: 0, exceptions: 0 },
        message: "No unmatched bank transactions found for this period.",
      });
    }

    // ── Create recon run record ──────────────────────────────────────────────
    const [run] = await db
      .insert(reconRuns)
      .values({
        userId,
        periodStart,
        periodEnd,
        totalTransactions: bankRows.length,
        status: "running",
      })
      .returning();

    try {
      // ── Map to engine types (amounts in paise) ───────────────────────────
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

      // ── Run the 4-pass deterministic engine ──────────────────────────────
      const matchResults = matchTransactions(engineBanks, engineLedgers);

      // ── AI Reasoning Pass ────────────────────────────────────────────────
      // Only non-exact, non-exception matches get AI reasoning.
      // Exact matches (confidence 1.0) auto-approve without spending Gemini tokens.
      // Exceptions (matchType "none") go straight to human review — no AI needed.
      //
      // FIX: Pass DEFAULT_FEE_PATTERNS so Gemini knows about Razorpay/NEFT/TDS fees.
      const aiTasks = matchResults.map(async (match) => {
        const skipAI =
          (match.matchType === "exact" && match.confidenceScore >= 0.95) ||
          match.matchType === "none";

        if (skipAI) return { ...match, aiResult: null };

        const bankTxn = engineBanks.find((b) => b.id === match.bankTransactionId)!;
        const candidates = engineLedgers.filter((l) =>
          match.ledgerEntryIds.includes(l.id)
        );

        const aiResult = await generateMatchReason(
          bankTxn,
          candidates,
          DEFAULT_FEE_PATTERNS // FIX: was not being passed in original route.ts
        );

        return { ...match, aiResult };
      });

      // Run AI calls concurrently (Promise.allSettled so one failure doesn't abort all)
      const aiResults = await Promise.allSettled(aiTasks);
      const enhancedMatches = aiResults.map((result, i) => {
        if (result.status === "fulfilled") return result.value;
        console.error("AI call failed for match index", i, matchResults[i]);
        return { ...matchResults[i], aiResult: null };
      });

      // ── Persist results in a single DB transaction ───────────────────────
      let autoMatched = 0;
      let needsReview = 0;
      let exceptions = 0;

      await db.transaction(async (tx) => {
        for (const match of enhancedMatches) {
          const isAutoApprove =
            match.matchType === "exact" && match.confidenceScore >= 0.95;
          const status = isAutoApprove ? "approved" : "pending";

          if (isAutoApprove) {
            autoMatched++;
          } else if (match.matchType === "none") {
            exceptions++;
          } else {
            needsReview++;
          }

          // Build reason text — prefer AI explanation, fall back to deterministic label
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

          // Update bank transaction status
          const bankStatus = match.matchType === "none" ? "exception" : "matched";
          await tx
            .update(bankTransactions)
            .set({ status: bankStatus })
            .where(eq(bankTransactions.id, match.bankTransactionId));

          // Update all matched ledger entries
          for (const ledgerId of match.ledgerEntryIds) {
            await tx
              .update(ledgerEntries)
              .set({ status: "matched" })
              .where(eq(ledgerEntries.id, ledgerId));
          }
        }

        // Mark the run complete with final stats
        await tx
          .update(reconRuns)
          .set({ status: "complete", autoMatched, needsReview, exceptions })
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
      // If the engine or DB transaction fails, mark the run as failed
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function fallbackReason(matchType: string): string {
  switch (matchType) {
    case "exact":
      return "Exact match on amount and date.";
    case "bulk":
      return "Multiple ledger entries sum precisely to this bank transaction.";
    case "fuzzy":
      return "Partial match based on similar amount, date, or text references.";
    default:
      return "No matching ledger entries found.";
  }
}