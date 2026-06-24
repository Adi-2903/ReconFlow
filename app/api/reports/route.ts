import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getReconciliationSummaryReport,
  getExceptionReport,
  getFeeReport,
  getFXReport,
  getRiskReport,
  getAuditActivityReport
} from "@/services/reports.service";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const searchParams = req.nextUrl.searchParams;
    const type = searchParams.get("type");
    const periodStart = searchParams.get("periodStart");
    const periodEnd = searchParams.get("periodEnd");
    
    if (!periodStart || !periodEnd) {
      return NextResponse.json({ error: "Missing periodStart or periodEnd" }, { status: 400 });
    }

    if (type === "summary") {
      const summary = await getReconciliationSummaryReport(userId, periodStart, periodEnd);
      return NextResponse.json(summary);
    }

    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    const offset = (page - 1) * limit;
    if (offset > 10000) {
      return NextResponse.json({ error: "Preview limit exceeded. Please narrow the selected date range." }, { status: 400 });
    }

    let result;
    switch (type) {
      case "exceptions":
        result = await getExceptionReport(userId, periodStart, periodEnd, page, limit);
        break;
      case "fee":
        result = await getFeeReport(userId, periodStart, periodEnd, page, limit);
        break;
      case "fx":
        result = await getFXReport(userId, periodStart, periodEnd, page, limit);
        break;
      case "risk":
        result = await getRiskReport(userId, periodStart, periodEnd, page, limit);
        break;
      case "audit":
        result = await getAuditActivityReport(userId, periodStart, periodEnd, page, limit);
        break;
      default:
        return NextResponse.json({ error: "Invalid report type" }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Reports API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
