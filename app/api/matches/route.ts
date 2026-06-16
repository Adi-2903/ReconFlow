import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { listMatches } from "@/services/matches.service";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const filter = new URL(req.url).searchParams.get("filter") || "all";
    const results = await listMatches(userId, filter);
    return Response.json(results);
  } catch (error) {
    console.error("Fetch matches error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
