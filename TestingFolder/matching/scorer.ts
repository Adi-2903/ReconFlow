import { CanonicalTransaction } from "../types/CanonicalTransaction";

import {
    daysBetween,
    referenceMatches,
    nameMatches,
    directionMatches
} from "./utils";

export function score(
    bankTxn: CanonicalTransaction,
    bookTxn: CanonicalTransaction
): number {

    let score = 0;

    const amountDiff =
        Math.abs(
            bankTxn.amount -
            bookTxn.amount
        );

    if (amountDiff === 0)
        score += 40;
    else if (amountDiff <= 50)
        score += 35;
    else if (amountDiff <= 500)
        score += 20;

    const dayDiff =
        daysBetween(
            bankTxn.transactionDate,
            bookTxn.transactionDate
        );

    score += Math.max(
        0,
        20 - dayDiff * 5
    );

    if (
        referenceMatches(
            bankTxn.referenceNumber,
            bookTxn.referenceNumber
        )
    ) {
        score += 30;
    }

    if (
        nameMatches(
            bankTxn.counterparty,
            bookTxn.counterparty
        )
    ) {
        score += 10;
    }

    // Direction is a hint, not a gate
    if (
        directionMatches(
            bankTxn,
            bookTxn
        )
    ) {
        score += 5;
    }

    return Math.min(
        score,
        100
    );
}