import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { getReportSummary } from "@/services/reports.service";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const searchParams = req.nextUrl.searchParams;
    const periodStart = searchParams.get("periodStart");
    const periodEnd = searchParams.get("periodEnd");

    if (!periodStart || !periodEnd) {
      return Response.json({ error: "Missing periodStart or periodEnd" }, { status: 400 });
    }

    const result = await getReportSummary(userId, periodStart, periodEnd);
    return Response.json(result);
  } catch (error) {
    console.error("Error fetching reports summary:", error);
    return Response.json({ error: "Failed to fetch reports summary" }, { status: 500 });
  }
}
