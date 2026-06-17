import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getOrCreateUserOrganization, getOrCreateFinancialAccount } from "@/core/db/org-helper";
import { findMatchingTemplate } from "@/services/mapping/template-matcher";
import { detectColumns } from "@/services/mapping/column-detector";
import { parseCsv } from "@/services/parsers/csv.parser";
import { parseExcel } from "@/services/parsers/excel.parser";
import { IngestionService } from "@/services/ingestion.service";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = req.nextUrl.searchParams;
    const formData = await req.formData();
    
    const action = searchParams.get("action") || (formData.get("action") as string) || "import";
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const fileName = file.name;
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const orgId = await getOrCreateUserOrganization(userId);

    if (action === "preview") {
      // --- Action 1: File Layout Preview & Column Mapping Recommendation ---
      let rows: string[][] = [];
      let sheetNames: string[] = [];

      if (fileName.endsWith(".csv")) {
        const fileText = buffer.toString("utf8");
        rows = parseCsv(fileText);
      } else if (fileName.endsWith(".xls") || fileName.endsWith(".xlsx")) {
        const parsed = parseExcel(buffer);
        rows = parsed.rows;
        sheetNames = parsed.sheetNames;
      } else {
        return NextResponse.json({ error: "Unsupported file format. Please upload a CSV or Excel file." }, { status: 400 });
      }

      if (rows.length === 0) {
        return NextResponse.json({ error: "Uploaded file is empty." }, { status: 400 });
      }

      const headers = rows[0].map((h) => h.trim());
      const previewRows = rows.slice(1, 6); // First 5 rows of data

      // Heuristically detect columns
      const columnHeuristics = detectColumns(headers);

      // Check for template match based on header fingerprint
      const fileType = (formData.get("fileType") as string) || "bank_csv";
      const matchedTemplate = await findMatchingTemplate(orgId, fileType, headers);

      return NextResponse.json({
        success: true,
        fileName,
        fileSize: file.size,
        headers,
        previewRows,
        columnHeuristics,
        matchedTemplate,
        sheetNames,
      });

    } else if (action === "import") {
      // --- Action 2: Process & Map Complete File ---
      const fileType = formData.get("fileType") as string;
      const columnMappingStr = formData.get("columnMapping") as string;
      const saveTemplateName = formData.get("saveTemplateName") as string;

      if (!fileType || !columnMappingStr) {
        return NextResponse.json({ error: "Missing required import configuration parameters." }, { status: 400 });
      }

      const columnMapping = JSON.parse(columnMappingStr);

      // Resolve matching account ID
      const accountName = `${fileType.replace("_", " ").toUpperCase()} Account`;
      const type = ["bank_csv", "bank_excel", "stripe_export"].includes(fileType)
        ? "bank"
        : (fileType.includes("qbo") ? "quickbooks" : "tally");

      const accountId = await getOrCreateFinancialAccount(orgId, type as any, accountName);

      // Extract headers to save mapping template if requested
      let originalHeaders: string[] = [];
      if (saveTemplateName) {
        if (fileName.endsWith(".csv")) {
          originalHeaders = parseCsv(buffer.toString("utf8"))[0] || [];
        } else {
          originalHeaders = parseExcel(buffer).rows[0] || [];
        }
      }

      const saveTemplateParam = saveTemplateName
        ? { templateName: saveTemplateName, originalHeaders }
        : undefined;

      const stats = await IngestionService.importFileTransactions(
        orgId,
        accountId,
        buffer,
        fileName,
        fileType,
        columnMapping,
        saveTemplateParam
      );

      return NextResponse.json({
        success: true,
        message: `Import complete. Imported: ${stats.successCount}, Skipped (Duplicate): ${stats.skippedCount}, Failed: ${stats.failureCount}`,
        metrics: stats,
      });
    }

    return NextResponse.json({ error: "Invalid action." }, { status: 400 });

  } catch (error: any) {
    console.error("Upload API Error:", error);
    return NextResponse.json({ error: error.message || "Failed to process upload." }, { status: 500 });
  }
}
