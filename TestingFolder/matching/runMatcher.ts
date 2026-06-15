// matching/runMatcher.ts

import { Match } from "../types/Match";
import { CanonicalTransaction } from "../types/CanonicalTransaction";

import { generateCandidates } from "./candidateGenerator";
import { score } from "./scorer";
import { findOneToMany } from "./subsetMatcher";

export function runMatcher(
    bankTxns: CanonicalTransaction[],
    bookTxns: CanonicalTransaction[]
): Match[] {

    const matches: Match[] = [];

    const consumedBookIds =
        new Set<string>();

    for (const bankTxn of bankTxns) {

        const availableBooks =
            bookTxns.filter(
                (b) =>
                    !consumedBookIds.has(
                        b.id
                    )
            );

        const candidates =
            generateCandidates(
                bankTxn,
                availableBooks
            );

        // =====================
        // ONE TO MANY FIRST
        // =====================

        const grouped =
            findOneToMany(
                bankTxn,
                candidates
            );

        if (
            grouped.length > 0
        ) {

            grouped.forEach(
                (g) =>
                    consumedBookIds.add(
                        g.id
                    )
            );

            matches.push({
                bankTransactionIds: [
                    bankTxn.id
                ],

                bookTransactionIds:
                    grouped.map(
                        (g) => g.id
                    ),

                score: 93,

                matchType:
                    "one_to_many"
            });

            continue;
        }

        // =====================
        // SINGLE MATCH
        // =====================

        let bestCandidate:
            CanonicalTransaction | undefined;

        let bestScore = 0;

        for (const candidate of candidates) {

            const currentScore =
                score(
                    bankTxn,
                    candidate
                );

            if (
                currentScore >
                bestScore
            ) {
                bestScore =
                    currentScore;

                bestCandidate =
                    candidate;
            }
        }

        if (
            bestCandidate &&
            bestScore >= 60
        ) {

            consumedBookIds.add(
                bestCandidate.id
            );

            matches.push({
                bankTransactionIds: [
                    bankTxn.id
                ],

                bookTransactionIds: [
                    bestCandidate.id
                ],

                score: bestScore,

                matchType:
                    bestScore >= 95
                        ? "exact"
                        : "near"
            });
        }
    }

    return matches;
}