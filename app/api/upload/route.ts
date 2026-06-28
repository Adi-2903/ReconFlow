import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getOrCreateUserOrganization, getOrCreateFinancialAccount } from "@/core/db/org-helper";
import { findMatchingTemplate } from "@/services/mapping/template-matcher";
import { parseCsv } from "@/services/parsers/csv.parser";
import { parseExcel } from "@/services/parsers/excel.parser";
import { IngestionService } from "@/services/ingestion.service";
import { parseStatement } from "@/services/parsers/statement.parser";
import { parseTallyLedger } from "@/services/parsers/tally-ledger.parser";
import { CleaningService } from "@/services/cleaning.service";
import { detectLayout } from "@/services/parsers/layout-detector";
import { serializeParsedStatement } from "@/services/parsers/serializer";



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
      let bestLayoutMatch: any = null;
      let parsedStatement: any = null;
      const sheetName = (formData.get("sheetName") as string) || undefined;
      const fileType = (formData.get("fileType") as string) || "bank_csv";

      if (fileName.toLowerCase().endsWith(".csv")) {
        const fileText = buffer.toString("utf8");
        rows = parseCsv(fileText);
      } else if (fileName.toLowerCase().endsWith(".xls") || fileName.toLowerCase().endsWith(".xlsx")) {
        const parsed = parseExcel(buffer, sheetName);
        rows = parsed.rows;
        sheetNames = parsed.sheetNames;
      } else {
        return NextResponse.json({ error: "Unsupported file format. Please upload a CSV or Excel file." }, { status: 400 });
      }

      if (rows.length === 0) {
        return NextResponse.json({ error: "Uploaded file is empty." }, { status: 400 });
      }

      // Run new parser logic to get mapping and parsed structure
      const dummyCleaningService = new CleaningService({
        defaultCurrency: "USD",
        inferredDateFormat: "DD/MM/YYYY",
        accountLocale: "en-US",
        accountCurrency: "USD",
        orgCurrency: "USD"
      });
      if (fileType === "tally_export") {
        parsedStatement = parseTallyLedger(rows, dummyCleaningService, fileType);
      } else {
        parsedStatement = parseStatement(rows, fileType, dummyCleaningService);
      }
      const layout = detectLayout(rows);

      const headers = layout.headerRowIndex !== -1 ? rows[layout.headerRowIndex].map((h) => h.trim()) : [];
      const previewRows = layout.headerRowIndex !== -1 ? rows.slice(layout.headerRowIndex + 1, layout.headerRowIndex + 6) : rows.slice(0, 5);

      // Map back to expected column heuristics for backward compatibility
      const columnHeuristics: Record<string, string> = {};
      if (layout.headerRowIndex !== -1) {
        const hmap = layout.mapping;
        columnHeuristics.date = hmap.date !== -1 ? headers[hmap.date] : "";
        columnHeuristics.description = hmap.description !== -1 ? headers[hmap.description] : "";
        columnHeuristics.amount = hmap.amount !== -1 ? headers[hmap.amount] : "";
        columnHeuristics.debit = hmap.debit !== -1 ? headers[hmap.debit] : "";
        columnHeuristics.credit = hmap.credit !== -1 ? headers[hmap.credit] : "";
        columnHeuristics.reference = hmap.reference !== -1 ? headers[hmap.reference] : "";
        columnHeuristics.direction = ""; // Handled automatically now
        columnHeuristics.counterparty = ""; // Deprecated in parser layer for now
      }

      const hasRequired = !!(
        columnHeuristics.date &&
        columnHeuristics.description &&
        (columnHeuristics.amount || (columnHeuristics.debit && columnHeuristics.credit))
      );

      bestLayoutMatch = {
        type: "canonical_parser",
        name: "Parser Detected Layout",
        confidence: hasRequired ? 0.99 : 0.50,
        mapping: columnHeuristics
      };

      const safeParsedStatement = serializeParsedStatement(parsedStatement);

      return NextResponse.json({
        success: true,
        fileName,
        fileSize: file.size,
        headers,
        previewRows,
        columnHeuristics,
        matchedTemplate: null, // deprecated
        detectedLayout: null, // deprecated
        layoutMatch: bestLayoutMatch,
        parsedStatement: safeParsedStatement, // expose new canonical output with JSON-safe values
        sheetNames,
        selectedSheet: sheetName || sheetNames[0] || null,
      });

    } else if (action === "import") {
      // --- Action 2: Process & Map Complete File ---
      const fileType = formData.get("fileType") as string;
      const columnMappingStr = formData.get("columnMapping") as string;
      const saveTemplateName = formData.get("saveTemplateName") as string;
      const sheetName = (formData.get("sheetName") as string) || undefined;

      if (!fileType || !columnMappingStr) {
        return NextResponse.json({ error: "Missing required import configuration parameters." }, { status: 400 });
      }

      const columnMapping = JSON.parse(columnMappingStr);
      
      // Inject fallback columns for dueDate and documentType if not explicitly mapped by user
      if (file.name.includes("ledger")) {
        if (!columnMapping.dueDate) columnMapping.dueDate = "due_date";
        if (!columnMapping.documentType) columnMapping.documentType = "document_type";
      }

      // Resolve matching account ID
      const accountName = `${fileType.replace("_", " ").toUpperCase()} Account`;
      const type = ["bank_csv", "bank_excel", "stripe_export"].includes(fileType)
        ? "bank"
        : (fileType.includes("qbo") ? "quickbooks" : "tally");

      const accountId = await getOrCreateFinancialAccount(orgId, type as any, accountName);

      // Extract headers to save mapping template if requested
      let originalHeaders: string[] = [];
      if (saveTemplateName) {
        let tempRows: string[][] = [];
        if (fileName.toLowerCase().endsWith(".csv")) {
          tempRows = parseCsv(buffer.toString("utf8"));
        } else {
          tempRows = parseExcel(buffer, sheetName).rows;
        }
        const layout = detectLayout(tempRows);
        originalHeaders = layout.headerRowIndex !== -1 ? tempRows[layout.headerRowIndex] : [];
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
        saveTemplateParam,
        sheetName
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
