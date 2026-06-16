import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { runReconciliation } from "@/services/recon.service";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const { periodStart, periodEnd } = await req.json();
    if (!periodStart || !periodEnd) {
      return Response.json({ error: "Missing periodStart or periodEnd" }, { status: 400 });
    }

    const result = await runReconciliation(userId, periodStart, periodEnd);
    return Response.json(result);
  } catch (error: any) {
    console.error("Recon run error:", error);
    const status = error.statusCode ?? 500;
    return Response.json({ error: error.message ?? "Internal server error" }, { status });
  }
}