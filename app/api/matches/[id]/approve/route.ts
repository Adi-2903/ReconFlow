import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { approveMatch, ReviewConflictError } from "@/services/matches.service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    const internalUserId = session?.user?.id;
    if (!internalUserId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: matchId } = await params;
    if (!matchId) {
      return Response.json({ error: "Missing match id" }, { status: 400 });
    }

    const actorEmail = session?.user?.email || "unknown";

    // reason is optional — the UI may or may not surface a text input
    const body = await req.json().catch(() => ({}));
    const reason: string | undefined = typeof body?.reason === "string" ? body.reason.trim() || undefined : undefined;

    const result = await approveMatch(internalUserId, matchId, actorEmail, reason);
    return Response.json(result);
  } catch (error) {
    if (error instanceof ReviewConflictError) {
      return Response.json(
        { error: error.message, code: error.code },
        { status: 409 }
      );
    }
    const err = error as any;
    if (err?.statusCode === 404) return Response.json({ error: "Match not found" }, { status: 404 });
    if (err?.statusCode === 403) return Response.json({ error: "Forbidden" }, { status: 403 });
    // PostgreSQL NOWAIT lock failure — treat as concurrent claim
    if (err?.code === "55P03" || (err?.message as string)?.includes("could not obtain lock")) {
      return Response.json(
        { error: "This match is currently being reviewed. Please try again.", code: "CONCURRENT_CLAIM" },
        { status: 409 }
      );
    }
    console.error("Approve match error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
