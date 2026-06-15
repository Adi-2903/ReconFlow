// src/validators/importValidator.ts

import { BookTransaction } from "../types/BookTransaction";
import { BookTransactionLine } from "../types/BookTransactionLine";

import {
    validateTransactionBalance
} from "./accountingValidator";

export interface ImportError {
    transactionId: string;

    error: string;
}

export function validateImport(
    transactions: BookTransaction[],
    lines: BookTransactionLine[]
): ImportError[] {
    const errors: ImportError[] = [];

    for (const transaction of transactions) {
        const txnLines = lines.filter(
            (line) =>
                line.transactionId ===
                transaction.id
        );

        if (txnLines.length === 0) {
            errors.push({
                transactionId:
                    transaction.id,

                error:
                    "Transaction has no lines"
            });

            continue;
        }

        if (txnLines.length < 2) {
            errors.push({
                transactionId:
                    transaction.id,

                error:
                    "Transaction contains less than 2 accounting lines"
            });
        }

        const balance =
            validateTransactionBalance(
                transaction,
                txnLines
            );

        if (!balance.isBalanced) {
            errors.push({
                transactionId:
                    transaction.id,

                error: `Transaction not balanced (Debit=${balance.debitTotal}, Credit=${balance.creditTotal})`
            });
        }

        if (
            !transaction.transactionDate
        ) {
            errors.push({
                transactionId:
                    transaction.id,

                error:
                    "Missing transaction date"
            });
        }

        if (
            !transaction.transactionTypeRaw
        ) {
            errors.push({
                transactionId:
                    transaction.id,

                error:
                    "Missing transaction type"
            });
        }

        if (
            transaction.reconciliationAmount <=
            0
        ) {
            errors.push({
                transactionId:
                    transaction.id,

                error:
                    "Invalid reconciliation amount"
            });
        }

        if (
            transaction.lineCount !==
            txnLines.length
        ) {
            errors.push({
                transactionId:
                    transaction.id,

                error:
                    `Line count mismatch. Stored=${transaction.lineCount}, Actual=${txnLines.length}`
            });
        }

        const debitTotal =
            txnLines.reduce(
                (sum, line) =>
                    sum + line.debitAmount,
                0
            );

        const creditTotal =
            txnLines.reduce(
                (sum, line) =>
                    sum + line.creditAmount,
                0
            );

        if (
            Math.abs(
                debitTotal -
                transaction.debitTotal
            ) > 0.01
        ) {
            errors.push({
                transactionId:
                    transaction.id,

                error:
                    "Stored debit total does not match line totals"
            });
        }

        if (
            Math.abs(
                creditTotal -
                transaction.creditTotal
            ) > 0.01
        ) {
            errors.push({
                transactionId:
                    transaction.id,

                error:
                    "Stored credit total does not match line totals"
            });
        }
    }

    return errors;
}