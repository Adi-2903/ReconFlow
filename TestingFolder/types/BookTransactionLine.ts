export interface BookTransactionLine {
    id: string;

    transactionId: string;

    lineNumber: number;

    accountName: string;

    partyName?: string;

    debitAmount: number;

    creditAmount: number;

    rawLedgerName?: string;
}