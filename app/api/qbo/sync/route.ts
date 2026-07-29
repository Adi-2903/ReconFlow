import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { syncQboData } from "@/services/qbo.service";

// Vercel Serverless: extend timeout for QuickBooks API sync
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return Response.json({ error: "Unauthorized", details: "No active session or user ID found" }, { status: 401 });
    }

    const result = await syncQboData(userId, req.nextUrl.origin);
    return Response.json(result);
  } catch (error: any) {
    console.error("Error syncing QBO data:", error);
    const status = error.statusCode ?? 500;
    return Response.json(
      { error: error.message || "Failed to sync QuickBooks data", details: error.response?.data || error },
      { status }
    );
  }
}
