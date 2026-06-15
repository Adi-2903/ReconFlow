export interface BookTransaction {
    id: string;

    sourceSystem: "tally";

    sourceTransactionId: string;

    transactionDate: Date;

    transactionTypeRaw: string;

    transactionTypeNormalized: string;

    referenceNumber?: string;

    description?: string;

    currency: string;

    lineCount: number;

    debitTotal: number;

    creditTotal: number;

    reconciliationAmount: number;

    isBalanced: boolean;

    rawPayload?: unknown;
}