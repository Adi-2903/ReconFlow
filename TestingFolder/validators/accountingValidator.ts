// src/validators/accountingValidator.ts

import { BookTransaction } from "../types/BookTransaction";
import { BookTransactionLine } from "../types/BookTransactionLine";

export interface BalanceValidationResult {
    transactionId: string;

    debitTotal: number;

    creditTotal: number;

    difference: number;

    isBalanced: boolean;
}

export interface TotalsValidationResult {
    totalTransactions: number;

    totalDebit: number;

    totalCredit: number;

    difference: number;

    balanced: boolean;
}

export function validateTransactionBalance(
    transaction: BookTransaction,
    lines: BookTransactionLine[]
): BalanceValidationResult {
    const debitTotal = lines.reduce(
        (sum, line) => sum + line.debitAmount,
        0
    );

    const creditTotal = lines.reduce(
        (sum, line) => sum + line.creditAmount,
        0
    );

    const difference = Math.abs(
        debitTotal - creditTotal
    );

    return {
        transactionId: transaction.id,

        debitTotal,

        creditTotal,

        difference,

        isBalanced: difference < 0.01
    };
}

export function validateTotals(
    transactions: BookTransaction[]
): TotalsValidationResult {
    const totalDebit = transactions.reduce(
        (sum, txn) => sum + txn.debitTotal,
        0
    );

    const totalCredit = transactions.reduce(
        (sum, txn) => sum + txn.creditTotal,
        0
    );

    const difference = Math.abs(
        totalDebit - totalCredit
    );

    return {
        totalTransactions:
            transactions.length,

        totalDebit,

        totalCredit,

        difference,

        balanced: difference < 0.01
    };
}