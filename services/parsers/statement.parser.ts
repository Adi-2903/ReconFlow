import { ParsedStatement, ParsedTransaction } from "./types";
import { detectLayout } from "./layout-detector";
import { extractExplicitMetadata, inferBalances } from "./metadata-extractor";
import { extractTransactions } from "./transaction-extractor";
import { canonicalizeTransaction } from "./canonicalization";
import { CleaningService } from "../cleaning.service";

/**
 * Orchestrates the 5-stage parsing pipeline.
 */
export function parseStatement(
  rows: string[][],
  source: string,
  cleaningService: CleaningService
): ParsedStatement {
  const warnings: string[] = [];
  const errors: string[] = [];

  // 1. Layout Detection
  const layout = detectLayout(rows);

  if (layout.headerRowIndex === -1) {
    errors.push("Failed to detect a valid transaction table header row.");
    return { metadata: {}, transactions: [], validationErrors: errors, parserWarnings: warnings };
  }

  // 2. Metadata Extraction
  const metadata = extractExplicitMetadata(layout.preHeaderRows);

  // 3. Header Detection Validation (done during layout detection)
  const mapping = layout.mapping;
  if (mapping.date === -1 || mapping.description === -1) {
    errors.push("Missing required columns: Date and/or Description.");
    return { metadata, transactions: [], validationErrors: errors, parserWarnings: warnings };
  }

  const hasAmount = mapping.amount !== -1;
  const hasDebit = mapping.debit !== -1;
  const hasCredit = mapping.credit !== -1;

  if (!hasAmount && !(hasDebit && hasCredit)) {
    errors.push("Missing required columns: Amount OR (Debit AND Credit).");
    return { metadata, transactions: [], validationErrors: errors, parserWarnings: warnings };
  }

  // 4. Transaction Extraction
  const validBodyRows = extractTransactions(layout.bodyRows, mapping);
  if (validBodyRows.length === 0) {
    errors.push("No valid transactions found in the body rows.");
    return { metadata, transactions: [], validationErrors: errors, parserWarnings: warnings };
  }

  // 5. Canonicalization
  const transactions: ParsedTransaction[] = [];
  for (let i = 0; i < validBodyRows.length; i++) {
    const rawRow = validBodyRows[i];
    // Line number approx = headerRow + 2 (1-based, plus header row) + i
    const lineNum = layout.headerRowIndex + 2 + i; 
    
    const parsed = canonicalizeTransaction(
      rawRow,
      mapping,
      cleaningService,
      source,
      lineNum,
      warnings
    );

    if (parsed) {
      transactions.push(parsed);
    }
  }

  if (transactions.length === 0) {
    errors.push("All transactions failed canonicalization.");
    return { metadata, transactions, validationErrors: errors, parserWarnings: warnings };
  }

  // 6. Balance Inference
  inferBalances(metadata, transactions, warnings);

  return {
    metadata,
    transactions,
    validationErrors: errors,
    parserWarnings: warnings
  };
}
