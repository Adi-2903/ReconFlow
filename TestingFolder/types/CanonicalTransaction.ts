// src/types/CanonicalTransaction.ts

export interface CanonicalTransaction {
    id: string;

    source:
    | "bank"
    | "tally"
    | "quickbooks";

    transactionDate: Date;

    amount: number;

    direction:
    | "credit"
    | "debit";

    counterparty?: string;

    referenceNumber?: string;

    description?: string;

    sourceId: string;

    rawPayload?: any;
}