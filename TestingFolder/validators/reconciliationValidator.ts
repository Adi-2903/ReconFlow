import { Match } from "../types/Match";
import { ExpectedMatch } from "../types/ExpectedMatch";
import { EvaluationResult } from "../types/EvaluationResult";

export function evaluate(
    generated: Match[],
    expected: ExpectedMatch[]
): EvaluationResult {

    const normalizePair = (pairStr: string) => {
        const [banks, books] = pairStr.split(":");
        const sortedBanks = (banks || "").split(/[;,]/).map(x => x.trim()).filter(Boolean).sort().join(";");
        const sortedBooks = (books || "").split(/[;,]/).map(x => x.trim()).filter(Boolean).sort().join(";");
        return `${sortedBanks}:${sortedBooks}`;
    };

    const expectedReconMatches =
        expected.filter(
            (m) =>
                m.match_type !==
                "unmatched"
        );

    const expectedPairs =
        new Set(
            expectedReconMatches.map(
                (m) =>
                    normalizePair(`${m.bank_transaction_ids}:${m.book_transaction_ids}`)
            )
        );

    const generatedPairs =
        new Set(
            generated.map(
                (m) =>
                    normalizePair(`${m.bankTransactionIds.join(";")}:${m.bookTransactionIds.join(";")}`)
            )
        );

    let tp = 0;

    for (const pair of generatedPairs) {
        if (
            expectedPairs.has(pair)
        ) {
            tp++;
        }
    }

    const fp =
        generatedPairs.size - tp;

    const fn =
        expectedPairs.size - tp;

    const precision =
        tp === 0
            ? 0
            : tp / (tp + fp);

    const recall =
        tp === 0
            ? 0
            : tp / (tp + fn);

    const f1 =
        precision + recall === 0
            ? 0
            : (
                2 *
                precision *
                recall
            ) /
            (
                precision +
                recall
            );

    return {
        tp,
        fp,
        fn,
        precision,
        recall,
        f1
    };
}