import { HeaderMapping } from "./types";
import { NON_TRANSACTION_PATTERNS } from "./layout-detector";

/**
 * Filters the raw body rows to return only those that appear to be valid transactions.
 */
export function extractTransactions(bodyRows: string[][], mapping: HeaderMapping): string[][] {
  const transactionRows: string[][] = [];

  for (const row of bodyRows) {
    if (row.length === 0 || row.every(val => !val.trim())) {
      continue;
    }

    const dateStr = mapping.date !== -1 ? row[mapping.date]?.trim() : "";
    if (!dateStr) {
      continue;
    }

    // Filter out common footer/metadata patterns in date column
    if (NON_TRANSACTION_PATTERNS.some(pattern => pattern.test(dateStr))) {
      continue;
    }

    if (!/\d/.test(dateStr)) {
      continue; // Dates must have digits
    }

    const descStr = mapping.description !== -1 ? row[mapping.description]?.trim() : "";
    if (descStr) {
      if (/opening\s+balance|closing\s+balance|brought\s+forward|carried\s+forward|\bb\/f\b|\bc\/f\b|subtotal|grand\s+total/i.test(descStr)) {
        continue;
      }
    }

    const hasAmount = mapping.amount !== -1 && row[mapping.amount]?.trim() && /\d/.test(row[mapping.amount]);
    const hasDebit = mapping.debit !== -1 && row[mapping.debit]?.trim() && /\d/.test(row[mapping.debit]);
    const hasCredit = mapping.credit !== -1 && row[mapping.credit]?.trim() && /\d/.test(row[mapping.credit]);

    if (!hasAmount && !hasDebit && !hasCredit) {
      continue; // Must have some money value
    }

    transactionRows.push(row);
  }

  return transactionRows;
}
