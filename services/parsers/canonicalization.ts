import { HeaderMapping, ParsedTransaction } from "./types";
import { CleaningService } from "../cleaning.service";

/**
 * Converts a raw row into a ParsedTransaction using the mapping and a cleaning service.
 */
export function canonicalizeTransaction(
  row: string[],
  mapping: HeaderMapping,
  cleaningService: CleaningService,
  source: string,
  rowIndex: number,
  warnings: string[]
): ParsedTransaction | null {
  try {
    const rawDate = mapping.date !== -1 ? row[mapping.date]?.trim() : "";
    const rawDesc = mapping.description !== -1 ? row[mapping.description]?.trim() : "";
    const rawRef = mapping.reference !== -1 ? row[mapping.reference]?.trim() : "";
    const rawAmount = mapping.amount !== -1 ? row[mapping.amount]?.trim() : undefined;
    const rawDebit = mapping.debit !== -1 ? row[mapping.debit]?.trim() : undefined;
    const rawCredit = mapping.credit !== -1 ? row[mapping.credit]?.trim() : undefined;
    const rawBalance = mapping.balance !== -1 ? row[mapping.balance]?.trim() : undefined;

    // Normalise date using existing robust cleaning service
    const canonicalDate = cleaningService.normalizeDate(rawDate);
    
    // Normalise amount and direction
    const { amountMinor, direction } = cleaningService.normalizeTransactionAmount(
      rawAmount,
      rawDebit,
      rawCredit,
      undefined // We removed explicit direction column mapping for Bank Rec MVP
    );

    let parsedBalance: number | undefined = undefined;
    if (rawBalance && /\d/.test(rawBalance)) {
      const cleanedBal = rawBalance.replace(/,/g, "");
      const val = parseFloat(cleanedBal);
      if (!isNaN(val)) {
        parsedBalance = val;
      }
    }

    return {
      date: canonicalDate,
      rawNarration: rawDesc,
      amountMinor,
      direction,
      balance: parsedBalance,
      reference: rawRef || undefined,
      source
    };
  } catch (error: any) {
    warnings.push(`Row ${rowIndex}: canonicalization failed - ${error.message}`);
    return null;
  }
}
