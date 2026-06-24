import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { manualMatch, ReviewConflictError } from "@/services/matches.service";

/**
 * POST /api/matches/[id]/manual-match
 *
 * Body:
 *   {
 *     ledgerEntryIds: string[];   // 1–10 canonical_transaction IDs (ledger side)
 *     reason?: string;            // optional analyst justification
 *   }
 *
 * The [id] segment is the bank transaction's canonical_transaction ID.
 *
 * Returns:
 *   200  { success: true, matchId: string }
 *   400  Validation failure
 *   401  Unauthenticated
 *   403  Forbidden
 *   409  { error: string, code: "ALREADY_FINALIZED" | "CONCURRENT_CLAIM" }
 *   500  Unexpected error
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const internalUserId = session?.user?.id;
    if (!internalUserId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: bankTransactionId } = await params;
    if (!bankTransactionId) {
      return Response.json({ error: "Missing bank transaction id" }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    if (!body) {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { ledgerEntryIds, reason } = body as {
      ledgerEntryIds?: unknown;
      reason?: unknown;
    };

    if (!Array.isArray(ledgerEntryIds) || ledgerEntryIds.length === 0) {
      return Response.json(
        { error: "ledgerEntryIds must be a non-empty array" },
        { status: 400 }
      );
    }
    if (!ledgerEntryIds.every((id) => typeof id === "string")) {
      return Response.json(
        { error: "Each ledgerEntryId must be a string (UUID)" },
        { status: 400 }
      );
    }
    if (ledgerEntryIds.length > 10) {
      return Response.json(
        { error: "Cannot match more than 10 ledger entries at once" },
        { status: 400 }
      );
    }

    const parsedReason =
      typeof reason === "string" ? reason.trim() || undefined : undefined;
    const actorEmail = session?.user?.email || "unknown";

    const result = await manualMatch(
      internalUserId,
      actorEmail,
      bankTransactionId,
      ledgerEntryIds as string[],
      parsedReason
    );

    return Response.json(result);
  } catch (error) {
    if (error instanceof ReviewConflictError) {
      return Response.json(
        { error: error.message, code: error.code },
        { status: 409 }
      );
    }
    const err = error as any;
    if (err?.statusCode === 400) return Response.json({ error: err.message }, { status: 400 });
    if (err?.statusCode === 404) return Response.json({ error: err.message }, { status: 404 });
    if (err?.statusCode === 403) return Response.json({ error: "Forbidden" }, { status: 403 });
    // PostgreSQL NOWAIT lock failure — another reviewer is mid-transaction
    if (err?.code === "55P03" || (err?.message as string)?.includes("could not obtain lock")) {
      return Response.json(
        {
          error: "One or more selected transactions are currently being reviewed. Please try again.",
          code: "CONCURRENT_CLAIM",
        },
        { status: 409 }
      );
    }
    console.error("Manual match error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
