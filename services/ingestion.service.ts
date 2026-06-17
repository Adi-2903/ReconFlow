import { db } from "@/core/db";
import {
  imports as dbImports,
  rawRecords,
  canonicalTransactions,
  financialAccounts,
  organizations,
} from "@/core/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import crypto from "crypto";
import { parseCsv } from "./parsers/csv.parser";
import { parseExcel } from "./parsers/excel.parser";
import { NormalizedConnectorRecord } from "./connectors/connector.interface";
import { saveMappingTemplate } from "./mapping/template-matcher";
import { findHeaderRowIndex, inferDateFormat } from "./mapping/column-detector";
import { CleaningService } from "./cleaning.service";

export class IngestionService {
  /**
   * Generates a SHA-256 hash of a file buffer to enable duplicate detection.
   */
  static generateChecksum(buffer: Buffer): string {
    return crypto.createHash("sha256").update(buffer).digest("hex");
  }

  /**
   * Ingests normalized records from an external connector.
   */
  static async ingestConnectorRecords(
    orgId: string,
    accountId: string,
    sourceType: "stripe" | "quickbooks",
    records: NormalizedConnectorRecord[]
  ): Promise<{ successCount: number; skippedCount: number; failureCount: number }> {
    if (records.length === 0) {
      return { successCount: 0, skippedCount: 0, failureCount: 0 };
    }

    // 1. Create an import run log entry
    const [importRun] = await db
      .insert(dbImports)
      .values({
        organizationId: orgId,
        accountId: accountId,
        sourceType,
        filename: `${sourceType.toUpperCase()} Sync Run - ${new Date().toISOString()}`,
        status: "PARSING",
        rowCount: records.length,
      })
      .returning();

    let successCount = 0;
    let skippedCount = 0;
    let failureCount = 0;

    try {
      // 2. Identify duplicates by querying existing transactions in batches
      const sourceTxnIds = records.map((r) => r.sourceTransactionId).filter(Boolean);
      const existingTxns = new Set<string>();

      if (sourceTxnIds.length > 0) {
        // Query database for matching source IDs
        const existingList = await db
          .select({ sourceTransactionId: canonicalTransactions.sourceTransactionId })
          .from(canonicalTransactions)
          .where(
            and(
              eq(canonicalTransactions.accountId, accountId),
              inArray(canonicalTransactions.sourceTransactionId, sourceTxnIds)
            )
          );
        existingList.forEach((e) => {
          if (e.sourceTransactionId) existingTxns.add(e.sourceTransactionId);
        });
      }

      await db.update(dbImports).set({ status: "CLEANING" }).where(eq(dbImports.id, importRun.id));

      // 3. Process records
      for (let i = 0; i < records.length; i++) {
        const r = records[i];

        // If duplicate found, mark as skipped
        if (existingTxns.has(r.sourceTransactionId)) {
          skippedCount++;
          continue;
        }

        try {
          // Log raw record payload line
          const [rawRec] = await db
            .insert(rawRecords)
            .values({
              organizationId: orgId,
              importId: importRun.id,
              rowNumber: i + 1,
              rawPayload: r.metadata || r,
              sourceHash: r.sourceTransactionId,
            })
            .returning();

          // Map and insert canonical transaction
          const isStripe = sourceType === "stripe";
          await db.insert(canonicalTransactions).values({
            organizationId: orgId,
            accountId,
            rawRecordId: rawRec.id,
            side: isStripe ? "money" : "books", // Stripe = money, QBO = books
            direction: r.amountMinor >= BigInt(0) ? "inflow" : "outflow",
            status: "AVAILABLE",
            transactionDate: r.transactionDate.toISOString().split("T")[0],
            amountMinor: r.amountMinor < BigInt(0) ? r.amountMinor * BigInt(-1) : r.amountMinor, // Store absolute positive amounts
            currency: r.currency,
            referenceNumber: r.referenceNumber || null,
            counterpartyName: r.counterpartyName || null,
            description: r.description || null,
            transactionType: r.transactionType || null,
            sourceTransactionId: r.sourceTransactionId,
          });

          successCount++;
        } catch (itemErr) {
          console.error(`Error ingesting connector record ${r.sourceTransactionId}:`, itemErr);
          failureCount++;
        }
      }

      // 4. Update import status to completed
      await db
        .update(dbImports)
        .set({
          status: "COMPLETED",
          successCount,
          skippedCount,
          failureCount,
        })
        .where(eq(dbImports.id, importRun.id));

    } catch (err: any) {
      await db
        .update(dbImports)
        .set({
          status: "FAILED",
          errorMessage: err.message || "Failed during processing",
          failureCount: records.length,
        })
        .where(eq(dbImports.id, importRun.id));
      throw err;
    }

    return { successCount, skippedCount, failureCount };
  }

  /**
   * Processes file upload (CSV / Excel) and converts it to canonical transactions.
   */
  static async importFileTransactions(
    orgId: string,
    accountId: string,
    fileBuffer: Buffer,
    fileName: string,
    fileType: string, // 'bank_csv', 'bank_excel', 'qbo_export', 'tally_export', 'stripe_export'
    columnMap: Record<string, string>,
    saveTemplate?: { templateName: string; originalHeaders: string[] },
    sheetName?: string
  ): Promise<{ successCount: number; skippedCount: number; failureCount: number }> {
    // 1. Generate sha256 checksum and check for duplicate files
    const sha256 = this.generateChecksum(fileBuffer);
    const [existingImport] = await db
      .select()
      .from(dbImports)
      .where(and(eq(dbImports.organizationId, orgId), eq(dbImports.sha256, sha256)))
      .limit(1);

    if (existingImport) {
      throw new Error(`File ${fileName} has already been uploaded.`);
    }

    // Retrieve Organization and Account to get base currencies and locales
    const [account] = await db
      .select()
      .from(financialAccounts)
      .where(eq(financialAccounts.id, accountId))
      .limit(1);
    if (!account) {
      throw new Error("Financial account not found.");
    }

    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    if (!org) {
      throw new Error("Organization not found.");
    }

    const accountMetadata = (account.metadata as any) || {};
    const accountLocale = accountMetadata.locale || (account.baseCurrency === "INR" ? "en-IN" : "en-US");

    // 2. Insert import record as UPLOADED
    const [importRun] = await db
      .insert(dbImports)
      .values({
        organizationId: orgId,
        accountId: accountId,
        sourceType: fileType,
        filename: fileName,
        sha256,
        status: "UPLOADED",
      })
      .returning();

    let successCount = 0;
    let skippedCount = 0;
    let failureCount = 0;
    let dataRows: string[][] = [];

    try {
      // 3. Update status to PARSING
      await db.update(dbImports).set({ status: "PARSING" }).where(eq(dbImports.id, importRun.id));

      let rows: string[][] = [];
      if (fileName.endsWith(".csv")) {
        const fileText = fileBuffer.toString("utf8");
        rows = parseCsv(fileText);
      } else {
        const parsed = parseExcel(fileBuffer, sheetName);
        rows = parsed.rows;
      }

      if (rows.length < 2) {
        throw new Error("File contains insufficient data (header + at least one data row needed).");
      }

      // 4. Update status to CLEANING
      await db.update(dbImports).set({ status: "CLEANING" }).where(eq(dbImports.id, importRun.id));

      // Find best header row dynamically based on scoring matching headers
      const { index: headerRowIndex } = findHeaderRowIndex(rows);
      const headers = rows[headerRowIndex].map((h) => h.trim());
      dataRows = rows.slice(headerRowIndex + 1);

      // Find indices of columns in file headers
      const dateIndex = headers.indexOf(columnMap.date);
      const descIndex = headers.indexOf(columnMap.description);
      const amountIndex = headers.indexOf(columnMap.amount);
      const refIndex = headers.indexOf(columnMap.reference);

      // Support separate debit/credit column mappings
      const debitIndex = headers.indexOf(columnMap.debit);
      const creditIndex = headers.indexOf(columnMap.credit);

      if (dateIndex === -1 || descIndex === -1 || (amountIndex === -1 && (debitIndex === -1 || creditIndex === -1))) {
        throw new Error("Invalid column mapping. Required columns (Date, Description, Amount) are missing.");
      }

      // Infer the date format format layout from the date column values (first 50 values)
      const sampleDateStrings: string[] = [];
      for (const row of dataRows) {
        if (row && row[dateIndex]) {
          sampleDateStrings.push(row[dateIndex]);
        }
        if (sampleDateStrings.length >= 50) break;
      }
      const inferredDateFormat = inferDateFormat(sampleDateStrings, accountLocale);

      // Instantiate cleaning standardizer
      const cleaningService = new CleaningService({
        defaultCurrency: org.baseCurrency || "USD",
        inferredDateFormat,
        accountLocale,
        accountCurrency: account.baseCurrency,
        orgCurrency: org.baseCurrency,
      });

      // 5. Update status to MAPPING
      await db.update(dbImports).set({ status: "MAPPING" }).where(eq(dbImports.id, importRun.id));

      // Fetch existing transactions to handle idempotency by checking both signatures & sourceTransactionId
      const existingRows = await db
        .select({
          date: canonicalTransactions.transactionDate,
          amount: canonicalTransactions.amountMinor,
          desc: canonicalTransactions.description,
          sourceTransactionId: canonicalTransactions.sourceTransactionId,
        })
        .from(canonicalTransactions)
        .where(eq(canonicalTransactions.accountId, accountId));

      const existingSignatures = new Set(
        existingRows.map((e) => `${e.date}_${e.amount}_${e.desc?.trim().toLowerCase()}`)
      );
      const existingTxnIds = new Set(
        existingRows.map((e) => e.sourceTransactionId).filter(Boolean)
      );

      // 6. Loop and insert
      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        if (row.length === 0 || row.every((val) => val === "")) {
          skippedCount++;
          continue;
        }

        const payload: Record<string, string> = {};
        headers.forEach((h, index) => {
          payload[h] = row[index] || "";
        });

        // Pre-insert raw record log
        const [rawRec] = await db
          .insert(rawRecords)
          .values({
            organizationId: orgId,
            importId: importRun.id,
            rowNumber: headerRowIndex + i + 2, // 1-indexed spreadsheet line number
            rawPayload: payload,
          })
          .returning();

        try {
          const rawDateStr = row[dateIndex];
          const rawDescStr = row[descIndex];
          const refStr = refIndex !== -1 ? row[refIndex] : "";

          // Normalize Date
          const formattedDate = cleaningService.normalizeDate(rawDateStr);

          // Normalize Amount
          const amountVal = amountIndex !== -1 ? row[amountIndex] : undefined;
          const debitVal = debitIndex !== -1 ? row[debitIndex] : undefined;
          const creditVal = creditIndex !== -1 ? row[creditIndex] : undefined;
          const { amountMinor, direction } = cleaningService.normalizeAmount(amountVal, debitVal, creditVal);

          // Normalize Counterparty
          const counterpartyName = rawDescStr;
          const counterpartyNormalized = cleaningService.normalizeCounterparty(rawDescStr);

          // Normalize Currency
          const currency = cleaningService.detectCurrency(
            (rawDescStr || "") + " " + (amountVal || debitVal || creditVal || "")
          );

          // Generate deterministic transaction hash
          const hashInput = `${formattedDate}_${amountMinor}_${counterpartyNormalized}`;
          const deterministicTxnId = crypto.createHash("sha256").update(hashInput).digest("hex");

          // Check for duplication inside file or database
          const rowSig = `${formattedDate}_${amountMinor}_${rawDescStr.trim().toLowerCase()}`;
          if (existingSignatures.has(rowSig) || existingTxnIds.has(deterministicTxnId)) {
            skippedCount++;
            continue;
          }
          existingSignatures.add(rowSig);
          existingTxnIds.add(deterministicTxnId);

          // Determine canonical side:
          // Bank CSV, Bank Excel, Stripe Export -> side: money
          // QuickBooks Export, Tally Export -> side: books
          const isMoney = ["bank_csv", "bank_excel", "stripe_export"].includes(fileType);

          await db.insert(canonicalTransactions).values({
            organizationId: orgId,
            accountId,
            rawRecordId: rawRec.id,
            side: isMoney ? "money" : "books",
            direction,
            status: "AVAILABLE",
            transactionDate: formattedDate,
            amountMinor,
            currency,
            referenceNumber: refStr || null,
            counterpartyName,
            counterpartyNormalized,
            description: rawDescStr || null,
            transactionType: cleaningService.normalizeTransactionType(fileType, direction),
            sourceTransactionId: deterministicTxnId,
          });

          successCount++;
        } catch (rowErr: any) {
          console.error(`Row ingestion error on line ${headerRowIndex + i + 2}:`, rowErr);
          failureCount++;
          
          // Log failure status inside raw_payload of rawRecords log row
          const updatedPayload = {
            ...payload,
            _status: "failed",
            _error: rowErr.message || "Failed processing validation",
          };
          await db
            .update(rawRecords)
            .set({ rawPayload: updatedPayload })
            .where(eq(rawRecords.id, rawRec.id));
        }
      }

      // Save matching template if templateName is provided
      if (saveTemplate && saveTemplate.templateName) {
        await saveMappingTemplate(
          orgId,
          fileType,
          saveTemplate.templateName,
          columnMap,
          saveTemplate.originalHeaders
        );
      }

      // 7. Update status to COMPLETED
      await db
        .update(dbImports)
        .set({
          status: "COMPLETED",
          rowCount: dataRows.length,
          successCount,
          skippedCount,
          failureCount,
        })
        .where(eq(dbImports.id, importRun.id));

    } catch (err: any) {
      await db
        .update(dbImports)
        .set({
          status: "FAILED",
          errorMessage: err.message || "Failed during parsing",
          failureCount: dataRows.length || 0,
        })
        .where(eq(dbImports.id, importRun.id));
      throw err;
    }

    return { successCount, skippedCount, failureCount };
  }
}
