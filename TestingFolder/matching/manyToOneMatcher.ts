// matching/manyToOneMatcher.ts

import { CanonicalTransaction }
    from "../types/CanonicalTransaction";

export function findManyToOne(
    bookTxn: CanonicalTransaction,
    bankCandidates: CanonicalTransaction[]
): CanonicalTransaction[] {

    for (
        let i = 0;
        i < bankCandidates.length;
        i++
    ) {
        for (
            let j = i + 1;
            j < bankCandidates.length;
            j++
        ) {

            const total =
                bankCandidates[i].amount +
                bankCandidates[j].amount;

            if (
                Math.abs(
                    total -
                    bookTxn.amount
                ) <= 1
            ) {
                return [
                    bankCandidates[i],
                    bankCandidates[j]
                ];
            }
        }
    }

    return [];
}