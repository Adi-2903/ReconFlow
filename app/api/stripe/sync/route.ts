import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { syncStripeTransactions } from "@/services/stripe.service";

// Vercel Serverless: extend timeout for paginated Stripe API sync
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const result = await syncStripeTransactions(userId);
    return Response.json(result);
  } catch (error: any) {
    console.error("Error syncing Stripe data:", error);
    const status = error.statusCode ?? 500;
    return Response.json({ error: error.message || "Failed to sync Stripe data" }, { status });
  }
}
