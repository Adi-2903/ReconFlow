import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getOrCreateUserOrganization, getOrCreateFinancialAccount } from "@/core/db/org-helper";
import { findMatchingTemplate } from "@/services/mapping/template-matcher";
import { detectColumns, findHeaderRowIndex, detectSourceLayout } from "@/services/mapping/column-detector";
import { parseCsv } from "@/services/parsers/csv.parser";
import { parseExcel } from "@/services/parsers/excel.parser";
import { parseTallyXml } from "@/services/parsers/tally.parser";
import { IngestionService } from "@/services/ingestion.service";

async function getLayoutMatchForHeaders(orgId: string, fileType: string, headers: string[]) {
  const detectedLayout = detectSourceLayout(headers);
  if (detectedLayout) {
    return {
      type: "known_layout",
      name: detectedLayout.name,
      layoutId: detectedLayout.layoutId,
      confidence: detectedLayout.confidence,
      mapping: detectedLayout.mapping,
    };
  }

  const matchedTemplate = await findMatchingTemplate(orgId, fileType, headers);
  if (matchedTemplate) {
    return {
      type: "learned_template",
      name: matchedTemplate.templateName,
      templateId: matchedTemplate.id,
      confidence: 0.90,
      mapping: matchedTemplate.config.columnMap,
    };
  }

  const columnHeuristics = detectColumns(headers);
  const hasRequired = !!(
    columnHeuristics.date &&
    columnHeuristics.description &&
    (columnHeuristics.amount || (columnHeuristics.debit && columnHeuristics.credit))
  );
  return {
    type: "heuristics",
    name: "Auto-Detected Layout",
    confidence: hasRequired ? 0.70 : 0.50,
    mapping: columnHeuristics,
  };
}

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
      let detectedSheetName: string | undefined = undefined;
      let bestLayoutMatch: any = null;
      const sheetName = (formData.get("sheetName") as string) || undefined;
      const fileType = (formData.get("fileType") as string) || "bank_csv";

      if (fileName.toLowerCase().endsWith(".csv")) {
        const fileText = buffer.toString("utf8");
        rows = parseCsv(fileText);
      } else if (fileName.toLowerCase().endsWith(".xml")) {
        const fileText = buffer.toString("utf8");
        rows = await parseTallyXml(fileText);
      } else if (fileName.toLowerCase().endsWith(".xls") || fileName.toLowerCase().endsWith(".xlsx")) {
        const parsed = parseExcel(buffer, sheetName);
        rows = parsed.rows;
        sheetNames = parsed.sheetNames;

        if (!sheetName && sheetNames.length > 1) {
          let highestConfidence = -1;
          let bestSheetRows = parsed.rows;
          let bestSheetName = sheetNames[0];

          for (const name of sheetNames) {
            try {
              const p = parseExcel(buffer, name);
              const { index: hIndex } = findHeaderRowIndex(p.rows);
              if (hIndex !== -1 && p.rows[hIndex]) {
                const sheetHeaders = p.rows[hIndex].map(h => String(h || "").trim());
                const match = await getLayoutMatchForHeaders(orgId, fileType, sheetHeaders);
                if (match && match.confidence > highestConfidence) {
                  highestConfidence = match.confidence;
                  bestLayoutMatch = match;
                  bestSheetRows = p.rows;
                  bestSheetName = name;
                }
              }
            } catch (e) {
              // ignore sheet parse error during auto-detection
            }
          }
          
          if (highestConfidence >= 0.70) {
            rows = bestSheetRows;
            detectedSheetName = bestSheetName;
          }
        }
      } else {
        return NextResponse.json({ error: "Unsupported file format. Please upload a CSV, Excel, or XML file." }, { status: 400 });
      }

      if (rows.length === 0) {
        return NextResponse.json({ error: "Uploaded file is empty." }, { status: 400 });
      }

      const { index: headerRowIndex } = findHeaderRowIndex(rows);
      const headers = rows[headerRowIndex].map((h) => h.trim());
      const previewRows = rows.slice(headerRowIndex + 1, headerRowIndex + 6); // First 5 rows of data

      // Heuristically detect columns
      const columnHeuristics = detectColumns(headers);

      // Check for template match based on header fingerprint
      const matchedTemplate = await findMatchingTemplate(orgId, fileType, headers);

      // Detect known layouts
      const detectedLayout = detectSourceLayout(headers);

      const layoutMatch = bestLayoutMatch || (await getLayoutMatchForHeaders(orgId, fileType, headers));

      return NextResponse.json({
        success: true,
        fileName,
        fileSize: file.size,
        headers,
        previewRows,
        columnHeuristics,
        matchedTemplate,
        detectedLayout,
        layoutMatch,
        sheetNames,
        selectedSheet: sheetName || detectedSheetName || sheetNames[0] || null,
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
        } else if (fileName.toLowerCase().endsWith(".xml")) {
          tempRows = await parseTallyXml(buffer.toString("utf8"));
        } else {
          tempRows = parseExcel(buffer, sheetName).rows;
        }
        const { index: headerRowIndex } = findHeaderRowIndex(tempRows);
        originalHeaders = tempRows[headerRowIndex] || [];
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
