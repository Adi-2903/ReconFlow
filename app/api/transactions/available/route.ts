import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { db } from "@/core/db";
import { canonicalTransactions, organizationMembers } from "@/core/db/schema";
import { eq, and, ilike, or, desc, asc } from "drizzle-orm";
import { generateCandidates } from "@/core/matching/candidateGenerator";
import type { BankTransaction, LedgerEntry } from "@/core/matching/engine";

/**
 * GET /api/transactions/available
 *
 * Returns ledger-side canonical_transactions with status = 'AVAILABLE'
 * scoped to the authenticated user's organization.
 *
 * Query params:
 *   bankId  — (optional) UUID of the bank transaction to score candidates against.
 *             When provided, results are ranked by candidateGenerator score DESC.
 *             When omitted, results are returned in transactionDate DESC order.
 *   query   — (optional) free-text search across description, referenceNumber,
 *             counterpartyName.
 *   limit   — (optional) max results to return. Default: 50. Max: 200.
 *   offset  — (optional) pagination offset. Default: 0.
 *
 * Response shape:
 *   {
 *     data: AvailableLedgerEntry[];
 *     total: number;
 *   }
 */

interface AvailableLedgerEntry {
  id: string;
  amount: number;           // in currency units (not paise)
  currency: string;
  date: string;             // ISO date string
  description: string;
  referenceNumber: string;
  counterpartyName: string;
  side: string;
  direction: string;
  sourceSystem: string;
  // Ranking fields — only present when bankId is supplied
  score?: number;
  confidenceBand?: "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW";
  reasons?: Array<{ reason: string; points: number }>;
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Resolve the user's organization
    const [membership] = await db
      .select({ organizationId: organizationMembers.organizationId })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, userId))
      .limit(1);

    if (!membership) {
      return Response.json({ error: "No organization found for this user" }, { status: 404 });
    }

    const { organizationId } = membership;

    // ── Parse query params ──────────────────────────────────────────────────────
    const { searchParams } = req.nextUrl;
    const bankId = searchParams.get("bankId") || undefined;
    const query = searchParams.get("query") || undefined;
    const rawLimit = parseInt(searchParams.get("limit") || "50", 10);
    const limit = Math.min(Math.max(1, Number.isNaN(rawLimit) ? 50 : rawLimit), 200);
    const rawOffset = parseInt(searchParams.get("offset") || "0", 10);
    const offset = Math.max(0, Number.isNaN(rawOffset) ? 0 : rawOffset);

    // ── Build the base where condition ─────────────────────────────────────────
    const conditions = [
      eq(canonicalTransactions.organizationId, organizationId),
      eq(canonicalTransactions.status, "AVAILABLE"),
      eq(canonicalTransactions.side, "books"), // ledger side only
    ];

    if (query) {
      conditions.push(
        or(
          ilike(canonicalTransactions.description, `%${query}%`),
          ilike(canonicalTransactions.referenceNumber, `%${query}%`),
          ilike(canonicalTransactions.counterpartyName, `%${query}%`)
        ) as any
      );
    }

    // ── Fetch ledger rows ───────────────────────────────────────────────────────
    const rows = await db
      .select()
      .from(canonicalTransactions)
      .where(and(...conditions))
      .orderBy(desc(canonicalTransactions.transactionDate))
      .limit(bankId ? 500 : limit) // fetch more when scoring to pick top-N after ranking
      .offset(bankId ? 0 : offset);

    // ── Map to AvailableLedgerEntry ────────────────────────────────────────────
    const mapped: AvailableLedgerEntry[] = rows.map((row) => ({
      id: row.id,
      amount: Number(row.amountMinor) / 100,
      currency: row.currency,
      date:
        row.transactionDate instanceof Date
          ? row.transactionDate.toISOString().split("T")[0]
          : String(row.transactionDate),
      description: row.description || "",
      referenceNumber: row.referenceNumber || "",
      counterpartyName: row.counterpartyName || "",
      side: row.side,
      direction: row.direction,
      sourceSystem: row.sourceSystem,
    }));

    // ── If bankId provided, rank with candidateGenerator ──────────────────────
    if (bankId) {
      // Fetch the bank transaction
      const [bankRow] = await db
        .select()
        .from(canonicalTransactions)
        .where(eq(canonicalTransactions.id, bankId))
        .limit(1);

      if (!bankRow) {
        return Response.json({ error: "Bank transaction not found" }, { status: 404 });
      }

      // Shape into BankTransaction interface
      const bankTxn: BankTransaction = {
        id: bankRow.id,
        amount: Number(bankRow.amountMinor),
        date: bankRow.transactionDate instanceof Date
          ? bankRow.transactionDate
          : new Date(bankRow.transactionDate),
        description: bankRow.description || "",
        referenceId: bankRow.referenceNumber || "",
        direction: bankRow.direction as "inflow" | "outflow",
        currency: bankRow.currency,
        baseCurrency: bankRow.baseCurrency || undefined,
        convertedAmountMinor: bankRow.convertedAmountMinor
          ? Number(bankRow.convertedAmountMinor)
          : undefined,
        fxStatus: bankRow.fxStatus,
        counterparty: bankRow.counterpartyName || undefined,
        matchingSignals: (bankRow.metadata as any)?.matchingSignals,
      };

      // Shape ledger rows into LedgerEntry interface
      const ledgerEntries: LedgerEntry[] = rows.map((row) => ({
        id: row.id,
        amount: Number(row.amountMinor),
        date: row.transactionDate instanceof Date
          ? row.transactionDate
          : new Date(row.transactionDate),
        memo: row.description || "",
        invoiceRef: row.referenceNumber || "",
        direction: row.direction as "inflow" | "outflow",
        currency: row.currency,
        baseCurrency: row.baseCurrency || undefined,
        convertedAmountMinor: row.convertedAmountMinor
          ? Number(row.convertedAmountMinor)
          : undefined,
        fxStatus: row.fxStatus,
        counterparty: row.counterpartyName || undefined,
        matchingSignals: (row.metadata as any)?.matchingSignals,
      }));

      // Run candidate scoring
      const scored = generateCandidates(bankTxn, ledgerEntries, { skipAmountGate: false });

      // Build a scored map for O(1) lookup
      const scoreMap = new Map(
        scored.map((c) => [c.candidate.id, c])
      );

      // Merge scores into the mapped rows
      const ranked: AvailableLedgerEntry[] = mapped.map((entry) => {
        const candidate = scoreMap.get(entry.id);
        if (candidate) {
          return {
            ...entry,
            score: candidate.score,
            confidenceBand: candidate.confidenceBand,
            reasons: candidate.reasons,
          };
        }
        return { ...entry, score: -Infinity };
      });

      // Sort by score DESC, then paginate
      ranked.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
      const paginated = ranked.slice(offset, offset + limit);

      return Response.json({ data: paginated, total: mapped.length });
    }

    return Response.json({ data: mapped, total: mapped.length });
  } catch (error) {
    console.error("Available transactions error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
