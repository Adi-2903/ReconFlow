import { NextRequest, NextResponse } from "next/server";
import { runFxSyncJob } from "@/services/fx-sync.job";

// Vercel Serverless: extend timeout for FX rate sync across multiple currencies
export const maxDuration = 60;

/**
 * Vercel Cron Job endpoint for nightly FX rate synchronization.
 *
 * Configured in vercel.json to run daily at 2 AM UTC.
 * Protected by CRON_SECRET to prevent unauthorized external invocations.
 *
 * Usage:
 *   - Automatic: Vercel Cron (Pro plan)
 *   - Manual: External cron service (e.g., cron-job.org) with Authorization header
 *   - Testing: curl -X GET https://your-app.vercel.app/api/cron/fx-sync -H "Authorization: Bearer YOUR_CRON_SECRET"
 */
export async function GET(req: NextRequest) {
  try {
    // Verify authorization — Vercel Cron sends this header automatically
    const authHeader = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret) {
      if (authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    } else {
      console.warn("⚠️ CRON_SECRET not set — cron endpoint is unprotected. Set CRON_SECRET in Vercel environment variables.");
    }

    await runFxSyncJob();
    return NextResponse.json({ success: true, message: "FX sync completed" });
  } catch (error: any) {
    console.error("FX Cron Job Error:", error);
    return NextResponse.json(
      { error: error.message || "FX sync failed" },
      { status: 500 }
    );
  }
}
