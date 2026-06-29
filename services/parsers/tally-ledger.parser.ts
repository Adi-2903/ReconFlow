import { ParsedStatement, ParsedTransaction } from "./types";
import { CleaningService } from "../cleaning.service";

/**
 * Parses a Tally Prime Bank Ledger Excel/CSV export into the canonical ParsedStatement structure.
 */
export function parseTallyLedger(
  rows: string[][],
  cleaningService: CleaningService,
  source: string
): ParsedStatement {
  const warnings: string[] = [];
  const errors: string[] = [];
  const transactions: ParsedTransaction[] = [];
  const metadata: ParsedStatement["metadata"] = {};
  const diagnostics: NonNullable<ParsedStatement["diagnostics"]> = {
    ignoredRows: [],
    subtotalRowsSkipped: 0,
    mergedNarrationCount: 0,
    inheritedDateCount: 0,
    transactionCount: 0
  };

  // 1. Detect Header Row
  let headerRowIndex = -1;
  const headerAliases = {
    date: /date/i,
    particulars: /particulars/i,
    voucherType: /vch\s*type|voucher\s*type/i,
    voucherNo: /vch\s*no|voucher\s*no/i,
    debit: /debit/i,
    credit: /credit/i
  };

  const colMapping = {
    date: -1,
    particularsStart: -1,
    particularsEnd: -1,
    voucherType: -1,
    voucherNo: -1,
    debit: -1,
    credit: -1
  };

  for (let i = 0; i < Math.min(20, rows.length); i++) {
    const row = rows[i];
    let foundDate = false;
    let foundParticulars = false;
    
    for (let j = 0; j < row.length; j++) {
      const cell = String(row[j] || "").trim();
      if (headerAliases.date.test(cell)) {
        colMapping.date = j;
        foundDate = true;
      }
      if (headerAliases.particulars.test(cell)) {
        colMapping.particularsStart = j;
        foundParticulars = true;
      }
      if (headerAliases.voucherType.test(cell)) colMapping.voucherType = j;
      if (headerAliases.voucherNo.test(cell)) colMapping.voucherNo = j;
      if (headerAliases.debit.test(cell)) colMapping.debit = j;
      if (headerAliases.credit.test(cell)) colMapping.credit = j;
    }

    if (foundDate && foundParticulars) {
      headerRowIndex = i;
      diagnostics.detectedHeaderRow = i;
      break;
    }
  }

  if (headerRowIndex === -1) {
    errors.push("Failed to detect Tally header row (requires Date and Particulars).");
    return { metadata, transactions, validationErrors: errors, parserWarnings: warnings };
  }

  // Determine Particulars span: it starts at particularsStart and ends before the next mapped column
  let nextColAfterParticulars = rows[headerRowIndex].length;
  [colMapping.voucherType, colMapping.voucherNo, colMapping.debit, colMapping.credit].forEach(idx => {
    if (idx > colMapping.particularsStart && idx < nextColAfterParticulars) {
      nextColAfterParticulars = idx;
    }
  });
  colMapping.particularsEnd = nextColAfterParticulars - 1;

  // 2. Process Rows
  let lastValidDate = "";

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length === 0 || row.every(val => !val.trim())) {
      continue;
    }

    // Safely extract columns
    const rawDate = colMapping.date !== -1 ? String(row[colMapping.date] || "").trim() : "";
    const rawVoucherType = colMapping.voucherType !== -1 ? String(row[colMapping.voucherType] || "").trim() : "";
    const rawVoucherNo = colMapping.voucherNo !== -1 ? String(row[colMapping.voucherNo] || "").trim() : "";
    const rawDebit = colMapping.debit !== -1 ? String(row[colMapping.debit] || "").trim() : "";
    const rawCredit = colMapping.credit !== -1 ? String(row[colMapping.credit] || "").trim() : "";

    // Concatenate Particulars
    let particularsParts: string[] = [];
    for (let j = colMapping.particularsStart; j <= colMapping.particularsEnd; j++) {
      if (row[j]) {
        const val = String(row[j]).trim();
        if (val) particularsParts.push(val);
      }
    }
    const rawNarration = particularsParts.join(" ");
    if (particularsParts.length > 1) {
      diagnostics.mergedNarrationCount!++;
      warnings.push(`Row ${i}: Multiple narration cells merged.`);
    }

    if (!rawNarration) {
      continue;
    }

    // Date inheritance logic
    let currentDate = rawDate;
    const isInvalidDateString = !currentDate || currentDate.toLowerCase().includes("educational") || !/\d/.test(currentDate);

    if (isInvalidDateString) {
      // Only inherit date if it looks like a valid transaction
      const hasVoucherType = !!rawVoucherType;
      const hasAmount = (!!rawDebit && /\d/.test(rawDebit)) || (!!rawCredit && /\d/.test(rawCredit));
      if (hasVoucherType || hasAmount) {
        currentDate = lastValidDate;
        diagnostics.inheritedDateCount!++;
        warnings.push(`Row ${i}: Date inherited from previous transaction.`);
      } else {
        currentDate = ""; // ensures it fails the currentDate check below if not inherited
      }
    } else {
      lastValidDate = currentDate;
    }

    if (!currentDate) {
      diagnostics.ignoredRows!.push(i);
      continue;
    }

    // Check for explicit balances and treat them purely as metadata (never transactions)
    const isOpeningBalance = /opening\s+balance|b\/f|brought\s+forward/i.test(rawNarration);
    const isClosingBalance = /closing\s+balance|c\/f|carried\s+forward/i.test(rawNarration);

    if (isOpeningBalance || isClosingBalance) {
      const hasAmount = rawDebit || rawCredit;
      if (hasAmount) {
        const { amountMinor } = cleaningService.normalizeTransactionAmount(undefined, rawDebit, rawCredit);
        const balValue = Number(amountMinor) / 100;
        if (isOpeningBalance) {
          metadata.openingBalance = balValue;
          diagnostics.openingBalanceRow = i;
          warnings.push(`Row ${i}: Opening balance detected from ledger row.`);
        }
        if (isClosingBalance) {
          metadata.closingBalance = balValue;
          diagnostics.closingBalanceRow = i;
          warnings.push(`Row ${i}: Closing balance detected from ledger row.`);
        }
      }
      diagnostics.ignoredRows!.push(i);
      continue; // Strictly skip importing these as transactions
    }

    // Validate it's a real transaction
    const hasAmount = (!!rawDebit && /\d/.test(rawDebit)) || (!!rawCredit && /\d/.test(rawCredit));
    if (!hasAmount) {
      diagnostics.subtotalRowsSkipped!++;
      diagnostics.ignoredRows!.push(i);
      warnings.push(`Row ${i}: Subtotal or blank row skipped.`);
      continue; // Subtotal or blank line
    }

    // Clean Date
    lastValidDate = currentDate; // Update inheritance date
    const canonicalDate = cleaningService.normalizeDate(currentDate);

    // Canonicalize Amount
    let amountMinor: bigint;
    let direction: "inflow" | "outflow";
    try {
      // In Tally, Debit = Money In (Inflow), Credit = Money Out (Outflow)
      // CleaningService assumes Bank Statement logic (Debit = Outflow, Credit = Inflow)
      // We swap them here so Tally transactions normalize correctly.
      const norm = cleaningService.normalizeTransactionAmount(undefined, rawCredit, rawDebit);
      amountMinor = norm.amountMinor;
      direction = norm.direction;
    } catch (e: any) {
      warnings.push(`Row ${i + 1}: canonicalization failed - ${e.message}`);
      continue;
    }

    transactions.push({
      date: canonicalDate,
      rawNarration,
      amountMinor,
      direction,
      voucherType: rawVoucherType || undefined,
      voucherNumber: rawVoucherNo || undefined,
      source
    });
    diagnostics.transactionCount!++;
  }

  return {
    metadata,
    transactions,
    validationErrors: errors,
    parserWarnings: warnings,
    diagnostics
  };
}
