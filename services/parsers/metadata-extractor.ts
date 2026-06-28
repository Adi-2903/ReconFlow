import { ParsedStatement, ParsedTransaction } from "./types";

/**
 * Scans pre-header rows for explicitly stated metadata.
 */
export function extractExplicitMetadata(preHeaderRows: string[][]): ParsedStatement["metadata"] {
  const metadata: ParsedStatement["metadata"] = {};

  for (const row of preHeaderRows) {
    const rowText = row.join(" ").toLowerCase();

    // Bank Name
    if (!metadata.bankName) {
      if (rowText.includes("icici bank") || rowText.includes("icici")) {
        metadata.bankName = "ICICI Bank";
      } else if (rowText.includes("axis bank") || rowText.includes("axis")) {
        metadata.bankName = "Axis Bank";
      } else if (rowText.includes("hdfc bank") || rowText.includes("hdfc")) {
        metadata.bankName = "HDFC Bank";
      } else if (rowText.includes("state bank of india") || rowText.includes("sbi")) {
        metadata.bankName = "SBI";
      }
    }

    // Account Number (basic heuristic, looking for labels followed by digits)
    if (!metadata.accountNumber) {
      const accMatch = rowText.match(/(?:account\s*no|a\/c\s*no|acc\s*no|account\s*number)[\s\:\-\.]*([\d]{6,18})/i);
      if (accMatch && accMatch[1]) {
        metadata.accountNumber = accMatch[1];
      }
    }

    // Opening Balance (explicit)
    if (metadata.openingBalance === undefined) {
      const opMatch = rowText.match(/opening\s+balance.*?([\d,]+(?:\.\d+)?)/i);
      if (opMatch && opMatch[1]) {
        const val = parseFloat(opMatch[1].replace(/,/g, ""));
        if (!isNaN(val)) {
          metadata.openingBalance = val;
        }
      }
    }

    // Closing Balance (explicit)
    if (metadata.closingBalance === undefined) {
      const clMatch = rowText.match(/closing\s+balance.*?([\d,]+(?:\.\d+)?)/i);
      if (clMatch && clMatch[1]) {
        const val = parseFloat(clMatch[1].replace(/,/g, ""));
        if (!isNaN(val)) {
          metadata.closingBalance = val;
        }
      }
    }
  }

  return metadata;
}

/**
 * Infers missing opening and closing balances by analyzing the chronologically sorted transactions.
 * It detects sort order first (oldest-first vs newest-first).
 */
export function inferBalances(
  metadata: ParsedStatement["metadata"], 
  transactions: ParsedTransaction[],
  warnings: string[]
): void {
  if (transactions.length === 0) return;

  // Filter to only transactions that actually have a balance column value
  const txnsWithBalance = transactions.filter(t => t.balance !== undefined);
  
  if (txnsWithBalance.length < 2) {
    if (txnsWithBalance.length === 0) {
      warnings.push("Balance column missing or unparseable. Cannot infer opening/closing balances.");
    }
    return;
  }

  // Detect chronological order
  // Assuming date format is YYYY-MM-DD from canonicalization
  const firstDate = new Date(txnsWithBalance[0].date).getTime();
  const lastDate = new Date(txnsWithBalance[txnsWithBalance.length - 1].date).getTime();

  let isOldestFirst = true;
  if (!isNaN(firstDate) && !isNaN(lastDate)) {
    if (firstDate > lastDate) {
      isOldestFirst = false;
    }
  } else {
    warnings.push("Cannot reliably detect chronological order due to invalid dates. Assuming oldest-first for balance inference.");
  }

  const earliestTxn = isOldestFirst ? txnsWithBalance[0] : txnsWithBalance[txnsWithBalance.length - 1];
  const latestTxn = isOldestFirst ? txnsWithBalance[txnsWithBalance.length - 1] : txnsWithBalance[0];

  if (metadata.openingBalance === undefined) {
    // Derive opening balance = Earliest Txn Balance - Earliest Txn Effect
    const effect = earliestTxn.direction === "inflow" 
      ? Number(earliestTxn.amountMinor) / 100 
      : -(Number(earliestTxn.amountMinor) / 100);
    
    metadata.openingBalance = earliestTxn.balance! - effect;
    warnings.push("Opening balance inferred from chronological first transaction.");
  }

  if (metadata.closingBalance === undefined) {
    // Derive closing balance = Latest Txn Balance
    metadata.closingBalance = latestTxn.balance;
    warnings.push("Closing balance inferred from chronological last transaction.");
  }
}
