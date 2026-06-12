import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { db } from "@/core/db";
import { users, matches, auditEvents } from "@/core/db/schema";
import { eq, and, ne } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const internalUserId = session?.user?.id;
    if (!internalUserId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const actorEmail = session?.user?.email || "unknown";

    const body = await req.json();
    const { runId, threshold } = body;
    if (!runId || threshold === undefined) {
      return Response.json({ error: "Missing runId or threshold" }, { status: 400 });
    }

    // We don't link match to runId directly in schema, so we do it by user's pending matches.
    const pendingMatches = await db
      .select()
      .from(matches)
      .where(
        and(
          eq(matches.userId, internalUserId),
          eq(matches.status, "pending"),
          ne(matches.matchType, "none")
        )
      );

    const matchesToApprove = pendingMatches.filter((m) => Number(m.confidenceScore) >= threshold);

    if (matchesToApprove.length === 0) {
      return Response.json({ approvedCount: 0 });
    }

    await db.transaction(async (tx) => {
      for (const match of matchesToApprove) {
        await tx
          .update(matches)
          .set({
            status: "approved",
            approvedBy: actorEmail,
            approvedAt: new Date(),
          })
          .where(eq(matches.id, match.id));

        await tx.insert(auditEvents).values({
          userId: internalUserId,
          matchId: match.id,
          action: "approved",
          actorEmail: actorEmail,
        });
      }
    });

    return Response.json({ approvedCount: matchesToApprove.length });
  } catch (error) {
    console.error("Bulk approve matches error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
