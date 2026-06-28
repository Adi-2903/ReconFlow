import { mapHeaders } from "./header-mapper";
import { HeaderMapping } from "./types";

export const NON_TRANSACTION_PATTERNS = [
  /page\s+\d+/i,
  /generated/i,
  /statement/i,
  /subtotal/i,
  /grand\s+total/i,
  /opening\s+balance/i,
  /closing\s+balance/i,
  /brought\s+forward/i,
  /carried\s+forward/i,
  /b\/f/i,
  /c\/f/i,
  /total/i,
  /---/
];

export interface LayoutResult {
  headerRowIndex: number;
  mapping: HeaderMapping;
  preHeaderRows: string[][];
  bodyRows: string[][];
}

/**
 * Identifies the header row and partitions the dataset.
 */
export function detectLayout(rows: string[][]): LayoutResult {
  let bestIndex = -1;
  let maxScore = 0;
  let bestMapping: HeaderMapping | null = null;

  const rowsToScan = Math.min(rows.length, 100); // Scan up to first 100 rows for headers

  for (let i = 0; i < rowsToScan; i++) {
    const row = rows[i];
    if (row.length === 0 || row.every((c) => !c.trim())) continue;

    const headers = row.map(h => h.trim());
    const mapping = mapHeaders(headers);

    let score = 0;
    if (mapping.date !== -1) score += 10;
    if (mapping.description !== -1) score += 10;
    
    const hasAmount = mapping.amount !== -1;
    const hasDebit = mapping.debit !== -1;
    const hasCredit = mapping.credit !== -1;

    if (hasAmount) score += 10;
    if (hasDebit && hasCredit) score += 20;

    if (mapping.balance !== -1) score += 5;
    if (mapping.reference !== -1) score += 5;

    // Minimum required: Date + Desc + (Amount OR (Debit + Credit))
    if (score > maxScore && mapping.date !== -1 && mapping.description !== -1 && (hasAmount || (hasDebit && hasCredit))) {
      maxScore = score;
      bestIndex = i;
      bestMapping = mapping;
    }
  }

  if (bestIndex === -1 || !bestMapping) {
    // Return empty fallback if no valid header found
    return {
      headerRowIndex: -1,
      mapping: mapHeaders([]),
      preHeaderRows: [],
      bodyRows: rows
    };
  }

  return {
    headerRowIndex: bestIndex,
    mapping: bestMapping,
    preHeaderRows: rows.slice(0, bestIndex),
    bodyRows: rows.slice(bestIndex + 1)
  };
}
