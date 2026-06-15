import { CanonicalTransaction } from "../types/CanonicalTransaction";
import { daysBetween } from "./utils";

export function generateCandidates(
    bankTxn: CanonicalTransaction,
    bookTxns: CanonicalTransaction[]
): CanonicalTransaction[] {

    return bookTxns.filter(
        (bookTxn) => {

            const amountDiff =
                Math.abs(
                    bankTxn.amount -
                    bookTxn.amount
                );

            const dayDiff =
                daysBetween(
                    bankTxn.transactionDate,
                    bookTxn.transactionDate
                );

            const amountTolerance =
                Math.max(
                    500,
                    Math.abs(bankTxn.amount) * 0.15
                );

            const maxDateDifference = 7;

            return (
                amountDiff <= amountTolerance &&
                dayDiff <= maxDateDifference
            );
        }
    );
}