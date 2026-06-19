// src/types/CanonicalTransaction.ts

export type FxStatus =
    | "NOT_REQUIRED"
    | "SOURCE_PROVIDED"
    | "CONVERTED"
    | "MISSING_RATE";

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

    amountMinor?: bigint;
    currency?: string;
    baseCurrency?: string;
    convertedAmountMinor?: bigint;
    fxStatus?: FxStatus;
    matchingSignals?: {
        channel?: string;
        utr?: string;
        invoiceNumber?: string;
        voucherNumber?: string;
        referenceNumber?: string;
        customerName?: string;
        vendorName?: string;
        merchantName?: string;
        relatedTransactionId?: string;
    };
    metadata?: {
        source?: string;
        [key: string]: any;
    };
}