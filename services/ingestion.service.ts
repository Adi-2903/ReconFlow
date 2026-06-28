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
import { parseStatement } from "./parsers/statement.parser";
import { parseTallyLedger } from "./parsers/tally-ledger.parser";
import { detectLayout } from "./parsers/layout-detector";
import { CleaningService } from "./cleaning.service";
import { CanonicalTransactionInputSchema } from "./mapping/canonical-input";
import { IntelligenceService } from "./intelligence.service";

function mapSourceSystem(type: string): "bank" | "quickbooks" | "tally" | "stripe" | "xero" | "netsuite" {
  const t = type.toLowerCase();
  if (t.includes("stripe")) return "stripe";
  if (t.includes("tally")) return "tally";
  if (t.includes("quickbooks") || t.includes("qbo")) return "quickbooks";
  if (t.includes("xero")) return "xero";
  if (t.includes("netsuite")) return "netsuite";
  return "bank";
}

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
              eq(canonicalTransactions.organizationId, orgId),
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

          // Map, enrich and insert canonical transaction
          const isStripe = sourceType === "stripe";
          const rawInput = {
            organizationId: orgId,
            accountId,
            rawRecordId: rawRec.id,
            sourceSystem: mapSourceSystem(sourceType),
            externalId: r.sourceTransactionId || null,
            side: isStripe ? "money" : "books",
            direction: r.amountMinor >= BigInt(0) ? "inflow" : "outflow",
            status: "AVAILABLE",
            transactionDate: r.transactionDate.toISOString().split("T")[0],
            amountMinor: r.amountMinor < BigInt(0) ? r.amountMinor * BigInt(-1) : r.amountMinor,
            currency: r.currency,
            referenceNumber: r.referenceNumber || null,
            counterpartyName: r.counterpartyName || null,
            description: r.description || null,
            transactionType: r.transactionType || null,
            sourceTransactionId: r.sourceTransactionId,
            metadata: {},
          };

          const enrichedInput = await IntelligenceService.enrichTransaction(orgId, rawInput, importRun.id);
          const validatedInput = CanonicalTransactionInputSchema.parse(enrichedInput);

          await db.insert(canonicalTransactions).values({
            organizationId: validatedInput.organizationId,
            accountId: validatedInput.accountId,
            rawRecordId: validatedInput.rawRecordId,
            sourceSystem: validatedInput.sourceSystem,
            externalId: validatedInput.externalId,
            side: validatedInput.side,
            direction: validatedInput.direction,
            status: validatedInput.status,
            transactionDate: new Date(validatedInput.transactionDate),
            amountMinor: validatedInput.amountMinor,
            currency: validatedInput.currency,
            referenceNumber: validatedInput.referenceNumber,
            counterpartyName: validatedInput.counterpartyName,
            counterpartyNormalized: validatedInput.counterpartyNormalized,
            description: validatedInput.description,
            transactionType: validatedInput.transactionType,
            sourceTransactionId: validatedInput.sourceTransactionId,
            baseCurrency: validatedInput.baseCurrency,
            convertedAmountMinor: validatedInput.convertedAmountMinor,
            exchangeRate: validatedInput.exchangeRate,
            exchangeRateSource: validatedInput.exchangeRateSource,
            fxRateProvider: validatedInput.fxRateProvider,
            exchangeRateDate: validatedInput.exchangeRateDate,
            fxStatus: validatedInput.fxStatus,
            metadata: validatedInput.metadata,
            // embeddingStatus: validatedInput.embeddingStatus as any,
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
      if (fileName.toLowerCase().endsWith(".csv")) {
        const fileText = fileBuffer.toString("utf8");
        rows = parseCsv(fileText);
      } else {
        let parsed = parseExcel(fileBuffer, sheetName);
        if (!sheetName && parsed.sheetNames.length > 1) {
          const requiredMappedHeaders = Object.values(columnMap)
            .filter(Boolean)
            .map((h) => String(h).trim().toLowerCase());

          if (requiredMappedHeaders.length > 0) {
            let bestSheetName = parsed.sheetNames[0];
            let maxMatches = -1;

            for (const name of parsed.sheetNames) {
              try {
                const p = parseExcel(fileBuffer, name);
                const { headerRowIndex: hIndex } = detectLayout(p.rows);
                if (hIndex !== -1 && p.rows[hIndex]) {
                  const headers = p.rows[hIndex].map((h) => String(h || "").trim().toLowerCase());
                  const matchCount = requiredMappedHeaders.filter((h) =>
                    headers.includes(h)
                  ).length;
                  if (matchCount > maxMatches) {
                    maxMatches = matchCount;
                    bestSheetName = name;
                  }
                }
              } catch (e) {
                // ignore
              }
            }
            if (maxMatches > 0) {
              parsed = parseExcel(fileBuffer, bestSheetName);
            }
          }
        }
        rows = parsed.rows;
      }

      if (rows.length < 2) {
        throw new Error("File contains insufficient data (header + at least one data row needed).");
      }

      // Determine account locale
      const accountLocale = accountMetadata.locale || (account.baseCurrency === "INR" ? "en-IN" : "en-US");

      // 4. Instantiate cleaning standardizer
      const cleaningService = new CleaningService({
        defaultCurrency: org.baseCurrency || "USD",
        inferredDateFormat: "DD/MM/YYYY", // Or use inferDateFormat if we want, but letting cleaning service handle it
        accountLocale,
        accountCurrency: account.baseCurrency,
        orgCurrency: org.baseCurrency,
      });

      // 5. Run the new Parser Pipeline
      await db.update(dbImports).set({ status: "MAPPING" }).where(eq(dbImports.id, importRun.id));
      
      let parsedStatement;
      if (fileType === "tally_export") {
        parsedStatement = parseTallyLedger(rows, cleaningService, fileType);
      } else {
        parsedStatement = parseStatement(rows, fileType, cleaningService);
      }
      
      if (parsedStatement.validationErrors.length > 0) {
        throw new Error(`Parsing failed: ${parsedStatement.validationErrors.join(", ")}`);
      }

      // 6. Fetch existing transactions to handle idempotency
      const existingRows = await db
        .select({
          date: canonicalTransactions.transactionDate,
          amount: canonicalTransactions.amountMinor,
          desc: canonicalTransactions.description,
          sourceTransactionId: canonicalTransactions.sourceTransactionId,
        })
        .from(canonicalTransactions)
        .where(eq(canonicalTransactions.organizationId, orgId));

      const existingSignatures = new Set(
        existingRows.map((e) => `${e.date}_${e.amount}_${e.desc?.trim().toLowerCase()}`)
      );
      const existingTxnIds = new Set(
        existingRows.map((e) => e.sourceTransactionId).filter(Boolean)
      );

      const isMoney = ["bank_csv", "bank_excel", "stripe_export"].includes(fileType);
      
      for (let i = 0; i < parsedStatement.transactions.length; i++) {
        const txn = parsedStatement.transactions[i];

        // Pre-insert raw record log (using the raw string representation for now)
        const [rawRec] = await db
          .insert(rawRecords)
          .values({
            organizationId: orgId,
            importId: importRun.id,
            rowNumber: i + 1,
            rawPayload: { rawNarration: txn.rawNarration, amount: txn.amountMinor.toString(), date: txn.date },
          })
          .returning();

        try {
          // Generate deterministic transaction hash
          const hashInput = `${txn.date}_${txn.amountMinor}_${txn.rawNarration}_${txn.reference || ""}`;
          const deterministicTxnId = crypto.createHash("sha256").update(hashInput).digest("hex");

          const rowSig = `${txn.date}_${txn.amountMinor}_${(txn.rawNarration || "").trim().toLowerCase()}`;
          if (existingSignatures.has(rowSig) || existingTxnIds.has(deterministicTxnId)) {
            skippedCount++;
            continue;
          }
          existingSignatures.add(rowSig);
          existingTxnIds.add(deterministicTxnId);

          const txnType = cleaningService.normalizeTransactionType(fileType, txn.direction);

          const rawInput = {
            organizationId: orgId,
            accountId,
            rawRecordId: rawRec.id,
            sourceSystem: mapSourceSystem(fileType),
            externalId: txn.reference || null,
            side: isMoney ? "money" : "books",
            direction: txn.direction,
            status: "AVAILABLE",
            transactionDate: txn.date,
            amountMinor: txn.amountMinor,
            currency: parsedStatement.metadata.currency || account.baseCurrency,
            referenceNumber: txn.reference || null,
            counterpartyName: null,
            counterpartyNormalized: null,
            description: txn.rawNarration,
            transactionType: txnType,
            sourceTransactionId: deterministicTxnId,
            metadata: {
              balance: txn.balance,
              voucherType: txn.voucherType,
              voucherNumber: txn.voucherNumber,
              ...parsedStatement.metadata
            },
          };

          const enrichedInput = await IntelligenceService.enrichTransaction(orgId, rawInput, importRun.id);
          const validatedInput = CanonicalTransactionInputSchema.parse(enrichedInput);

          await db.insert(canonicalTransactions).values({
            organizationId: validatedInput.organizationId,
            accountId: validatedInput.accountId,
            rawRecordId: validatedInput.rawRecordId,
            sourceSystem: validatedInput.sourceSystem,
            externalId: validatedInput.externalId,
            side: validatedInput.side,
            direction: validatedInput.direction,
            status: validatedInput.status,
            transactionDate: new Date(validatedInput.transactionDate),
            amountMinor: validatedInput.amountMinor,
            currency: validatedInput.currency,
            referenceNumber: validatedInput.referenceNumber,
            counterpartyName: validatedInput.counterpartyName,
            counterpartyNormalized: validatedInput.counterpartyNormalized,
            description: validatedInput.description,
            transactionType: validatedInput.transactionType,
            sourceTransactionId: validatedInput.sourceTransactionId,
            baseCurrency: validatedInput.baseCurrency,
            convertedAmountMinor: validatedInput.convertedAmountMinor,
            exchangeRate: validatedInput.exchangeRate,
            exchangeRateSource: validatedInput.exchangeRateSource,
            fxRateProvider: validatedInput.fxRateProvider,
            exchangeRateDate: validatedInput.exchangeRateDate,
            fxStatus: validatedInput.fxStatus,
            metadata: validatedInput.metadata,
          });

          successCount++;
        } catch (rowErr: any) {
          console.error(`Row ingestion error:`, rowErr);
          failureCount++;
          
          await db
            .update(rawRecords)
            .set({ rawPayload: { _status: "failed", _error: rowErr.message } })
            .where(eq(rawRecords.id, rawRec.id));
        }
      }

      // 7. Update status to COMPLETED
      await db
        .update(dbImports)
        .set({
          status: "COMPLETED",
          rowCount: parsedStatement.transactions.length,
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


