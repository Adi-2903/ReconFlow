import { NextRequest } from "next/server";
import { auth } from "@/auth";

// Vercel Serverless: extend timeout for reconciliation engine + AI reasoning
export const maxDuration = 60;
import { runReconciliation } from "@/services/recon.service";
import { db } from "@/core/db";
import { organizations } from "@/core/db/schema";
import { eq } from "drizzle-orm";
import { getOrCreateUserOrganization } from "@/core/db/org-helper";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const { periodStart, periodEnd } = await req.json();
    if (!periodStart || !periodEnd) {
      return Response.json({ error: "Missing periodStart or periodEnd" }, { status: 400 });
    }

    const orgId = await getOrCreateUserOrganization(userId);
    await db.update(organizations).set({
      activePeriodStart: new Date(periodStart),
      activePeriodEnd: new Date(periodEnd)
    }).where(eq(organizations.id, orgId));

    const result = await runReconciliation(userId, periodStart, periodEnd);
    return Response.json(result);
  } catch (error: any) {
    console.error("Recon run error:", error);
    const status = error.statusCode ?? 500;
    return Response.json({ error: error.message ?? "Internal server error" }, { status });
  }
}