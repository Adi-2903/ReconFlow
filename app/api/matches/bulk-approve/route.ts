import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { bulkApproveMatches } from "@/services/matches.service";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const { runId, threshold } = await req.json();
    if (!runId || threshold === undefined) {
      return Response.json({ error: "Missing runId or threshold" }, { status: 400 });
    }

    const actorEmail = session?.user?.email || "unknown";
    const result = await bulkApproveMatches(userId, threshold, actorEmail);
    return Response.json(result);
  } catch (error: any) {
    console.error("Bulk approve matches error:", error);
    return Response.json({ error: error.message ?? "Internal server error" }, { status: 500 });
  }
}
