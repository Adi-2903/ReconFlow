// matching/subsetMatcher.ts

import { CanonicalTransaction }
    from "../types/CanonicalTransaction";

export function findOneToMany(
    bankTxn: CanonicalTransaction,
    candidates: CanonicalTransaction[]
): CanonicalTransaction[] {

    for (
        let i = 0;
        i < candidates.length;
        i++
    ) {

        for (
            let j = i + 1;
            j < candidates.length;
            j++
        ) {

            const total =
                candidates[i].amount +
                candidates[j].amount;

            if (
                Math.abs(
                    total -
                    bankTxn.amount
                ) <= 1
            ) {
                return [
                    candidates[i],
                    candidates[j]
                ];
            }
        }
    }

    return [];
}