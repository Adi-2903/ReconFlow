import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { db } from "@/core/db";
import { users, matches, auditEvents } from "@/core/db/schema";
import { eq } from "drizzle-orm";

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

    const matchResult = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
    if (!matchResult.length) {
      return Response.json({ error: "Match not found" }, { status: 404 });
    }
    const match = matchResult[0];

    if (match.userId !== internalUserId) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    if (match.status !== "pending") {
      return Response.json({ error: "Conflict: Match is already processed" }, { status: 409 });
    }

    await db.transaction(async (tx) => {
      await tx
        .update(matches)
        .set({
          status: "approved",
          approvedBy: actorEmail,
          approvedAt: new Date(),
        })
        .where(eq(matches.id, matchId));

      await tx.insert(auditEvents).values({
        userId: internalUserId,
        matchId: matchId,
        action: "approved",
        actorEmail: actorEmail,
      });
    });

    return Response.json({ success: true, matchId, status: "approved" });
  } catch (error) {
    console.error("Approve match error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
