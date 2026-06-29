import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { db } from "@/core/db";
import { organizationMembers } from "@/core/db/schema";
import { eq } from "drizzle-orm";
import { bulkApproveMatches } from "@/services/matches.service";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const [member] = await db
      .select({ role: organizationMembers.role })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, userId))
      .limit(1);

    if (!member || (member.role !== "owner" && member.role !== "admin")) {
      return Response.json({ error: "Forbidden: Insufficient permissions for bulk approval" }, { status: 403 });
    }

    // F-04: runId has been removed from this contract. The matches table has no
    // reconRunId column, so filtering by run was never implementable. Bulk
    // approval is already scoped to the authenticated user's organisation
    // (enforced by bulkApproveMatches via getOrCreateUserOrganization).
    const { threshold } = await req.json();
    if (threshold === undefined) {
      return Response.json({ error: "Missing threshold" }, { status: 400 });
    }

    const actorEmail = session?.user?.email || "unknown";
    const result = await bulkApproveMatches(userId, threshold, actorEmail);
    return Response.json(result);
  } catch (error: any) {
    console.error("Bulk approve matches error:", error);
    return Response.json({ error: error.message ?? "Internal server error" }, { status: 500 });
  }
}
