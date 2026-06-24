import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getReconciliationSummaryReport,
  getExceptionReport,
  getFeeReport,
  getFXReport,
  getRiskReport,
  REPORT_VERSION
} from "@/services/reports.service";
// @ts-ignore
import ExcelJS from "exceljs";
import { PassThrough } from "stream";
import { renderToStream } from "@react-pdf/renderer";
import React from "react";
// Assuming a generic PDF document for now; you'd typically have a tailored component.
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

export const runtime = 'nodejs';

function createPdfDocument(data: any[], title: string, metadata: any) {
  const styles = StyleSheet.create({
    page: { padding: 30, fontSize: 10 },
    title: { fontSize: 16, marginBottom: 10 },
    row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#ccc", paddingVertical: 4 },
    cell: { flex: 1 }
  });

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={{ marginBottom: 20 }}>
          <Text style={styles.title}>{title}</Text>
          <Text>Period: {metadata.periodStart} to {metadata.periodEnd}</Text>
          <Text>Generated At: {metadata.generatedAt}</Text>
          <Text>Version: {metadata.reportVersion}</Text>
        </View>
        {data.slice(0, 1000).map((row, i) => ( // limit PDF to 1000 rows max for layout reasons
          <View style={styles.row} key={i}>
            <Text style={styles.cell}>{row.date ? new Date(row.date).toISOString().split('T')[0] : ""}</Text>
            <Text style={styles.cell}>{row.amountMinor ? (Number(row.amountMinor)/100).toFixed(2) : ""}</Text>
            <Text style={styles.cell}>{row.reasonText || row.status || ""}</Text>
          </View>
        ))}
      </Page>
    </Document>
  );
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const searchParams = req.nextUrl.searchParams;
    const type = searchParams.get("type");
    const periodStart = searchParams.get("periodStart");
    const periodEnd = searchParams.get("periodEnd");
    const format = searchParams.get("format");
    
    if (!periodStart || !periodEnd || !type || !format) {
      return NextResponse.json({ error: "Missing required parameters" }, { status: 400 });
    }

    // 1. Guardrail: Max 365 days
    const start = new Date(periodStart);
    const end = new Date(periodEnd);
    const daysDiff = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    if (daysDiff > 365) {
      return NextResponse.json({ error: "Date range cannot exceed 365 days." }, { status: 400 });
    }

    // 2. Fetch data (limit 100001 to enforce guardrail)
    const limit = 100001;
    let result: { data: any[], totalCount: number };
    
    switch (type) {
      case "exceptions":
        result = await getExceptionReport(userId, periodStart, periodEnd, 1, limit);
        break;
      case "fee":
        result = await getFeeReport(userId, periodStart, periodEnd, 1, limit);
        break;
      case "fx":
        result = await getFXReport(userId, periodStart, periodEnd, 1, limit);
        break;
      case "risk":
        result = await getRiskReport(userId, periodStart, periodEnd, 1, limit);
        break;
      default:
        return NextResponse.json({ error: "Invalid report type" }, { status: 400 });
    }

    // Check rows > 100,000 guardrail
    if (result.data.length > 100000) {
      return NextResponse.json({ error: "Result exceeds 100,000 rows. Please narrow the date range." }, { status: 400 });
    }

    const metadata = {
      reportVersion: REPORT_VERSION,
      generatedAt: new Date().toISOString(),
      periodStart,
      periodEnd,
      reportType: type
    };

    if (format === "csv") {
      const passThrough = new PassThrough();
      
      const headers = Object.keys(result.data[0] || { date: "", amount: "", status: "" }).join(",");
      passThrough.write(headers + "\n");
      
      for (const row of result.data) {
        const values = Object.values(row).map(v => `"${String(v).replace(/"/g, '""')}"`);
        passThrough.write(values.join(",") + "\n");
      }
      passThrough.end();

      return new NextResponse(passThrough as any, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="report_${type}.csv"`
        }
      });
    }

    if (format === "xlsx") {
      const passThrough = new PassThrough();
      const options = { stream: passThrough, useStyles: true, useSharedStrings: true };
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter(options);
      const sheet = workbook.addWorksheet('Report');

      // Metadata rows
      sheet.addRow(['Report Version', metadata.reportVersion, 'Generated At', metadata.generatedAt]);
      sheet.addRow(['Period', `${periodStart} to ${periodEnd}`, 'Type', type]);
      sheet.addRow([]);

      if (result.data.length > 0) {
        const columns = Object.keys(result.data[0]).map(key => ({ header: key, key }));
        sheet.columns = columns;

        for (const row of result.data) {
          sheet.addRow(row).commit();
        }
      }
      
      workbook.commit().then(() => {
        // stream finishes automatically
      });

      return new NextResponse(passThrough as any, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="report_${type}.xlsx"`
        }
      });
    }

    if (format === "pdf") {
      const passThrough = new PassThrough();
      const pdfStream = await renderToStream(createPdfDocument(result.data, `Report: ${type.toUpperCase()}`, metadata));
      
      pdfStream.pipe(passThrough);

      return new NextResponse(passThrough as any, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="report_${type}.pdf"`
        }
      });
    }

    return NextResponse.json({ error: "Unsupported format" }, { status: 400 });

  } catch (error) {
    console.error("Export API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
