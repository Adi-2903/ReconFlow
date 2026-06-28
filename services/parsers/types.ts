export interface ParsedStatement {
  metadata: {
    bankName?: string;
    accountHolder?: string;
    accountNumber?: string;
    statementStart?: string;
    statementEnd?: string;
    openingBalance?: number;
    closingBalance?: number;
    currency?: string;
  };
  transactions: ParsedTransaction[];
  validationErrors: string[];
  parserWarnings: string[];
  diagnostics?: {
    detectedHeaderRow?: number;
    openingBalanceRow?: number;
    closingBalanceRow?: number;
    ignoredRows?: number[];
    subtotalRowsSkipped?: number;
    mergedNarrationCount?: number;
    inheritedDateCount?: number;
    transactionCount?: number;
    [key: string]: any;
  };
}

export interface ParsedTransaction {
  date: string;
  rawNarration: string;
  amountMinor: bigint;
  direction: "inflow" | "outflow";
  balance?: number;
  reference?: string;
  source: string;
  voucherType?: string;
  voucherNumber?: string;
}

export interface HeaderMapping {
  date: number;
  description: number;
  amount: number;
  debit: number;
  credit: number;
  balance: number;
  reference: number;
  valueDate: number;
}
