import path from "path";
import fs from "fs";
import csv from "csv-parser";

import { parseTallyFile } from "../parsers/tallyParser";
import { parseQuickBooks } from "../parsers/quickBooksParser";
import { parseBankCsv } from "../parsers/bankParser";

import { runMatcher } from "../matching/runMatcher.js";

import { validateImport } from "../validators/importValidator";
import { validateTotals } from "../validators/accountingValidator";
import { evaluate } from "../validators/reconciliationValidator";

import { ExpectedMatch } from "../types/ExpectedMatch";

async function loadExpectedMatches(): Promise<
    ExpectedMatch[]
> {
    const results: ExpectedMatch[] = [];

    return new Promise((resolve, reject) => {
        fs.createReadStream(
            path.join(
                __dirname,
                "..",
                "data",
                "expected_matches.csv"
            )
        )
            .pipe(csv())
            .on("data", (row) => {
                results.push({
                    match_id: row.match_id,
                    match_type: row.match_type,
                    bank_transaction_ids:
                        row.bank_transaction_ids,
                    book_transaction_ids:
                        row.book_transaction_ids,
                    expected_confidence:
                        row.expected_confidence,
                    explanation:
                        row.explanation
                });
            })
            .on("end", () => resolve(results))
            .on("error", reject);
    });
}

async function main() {
    console.log(
        "\n====================================="
    );
    console.log(
        "RECONFLOW VALIDATION HARNESS"
    );
    console.log(
        "=====================================\n"
    );

    const tallyPath = path.join(
        __dirname,
        "..",
        "data",
        "tally_transactions.xml"
    );

    const quickbooksPath = path.join(
        __dirname,
        "..",
        "data",
        "quickbooks_book_transactions.xlsx"
    );

    const bankPath = path.join(
        __dirname,
        "..",
        "data",
        "bank_transactions.csv"
    );

    console.log(
        "Loading source files...\n"
    );

    const tally =
        await parseTallyFile(
            tallyPath
        );

    const quickbooks =
        parseQuickBooks(
            quickbooksPath
        );

    const bank =
        await parseBankCsv(
            bankPath
        );

    console.log(
        "Files Loaded Successfully\n"
    );

    console.log("\nBANK DIRECTIONS");

    const bankDirections = bank.reduce(
        (acc, txn) => {
            acc[txn.direction] =
                (acc[txn.direction] || 0) + 1;
            return acc;
        },
        {} as Record<string, number>
    );

    console.log(bankDirections);

    console.log("\nQUICKBOOKS DIRECTIONS");

    const qbDirections = quickbooks.reduce(
        (acc, txn) => {
            acc[txn.direction] =
                (acc[txn.direction] || 0) + 1;
            return acc;
        },
        {} as Record<string, number>
    );

    console.log(qbDirections);

    console.log(
        "Tally Transactions:",
        tally.transactions.length
    );

    console.log(
        "Tally Lines:",
        tally.lines.length
    );

    console.log(
        "QuickBooks Transactions:",
        quickbooks.length
    );

    console.log(
        "Bank Transactions:",
        bank.length
    );

    // =====================
    // ACCOUNTING VALIDATION
    // =====================

    console.log(
        "\n====================================="
    );
    console.log(
        "IMPORT VALIDATION"
    );
    console.log(
        "=====================================\n"
    );

    const importErrors =
        validateImport(
            tally.transactions,
            tally.lines
        );

    if (
        importErrors.length > 0
    ) {
        console.log(
            `Found ${importErrors.length} import errors`
        );

        console.table(
            importErrors.slice(
                0,
                20
            )
        );
    } else {
        console.log(
            "No import errors found"
        );
    }

    console.log(
        "\n====================================="
    );
    console.log(
        "ACCOUNTING TOTALS"
    );
    console.log(
        "=====================================\n"
    );

    const totals =
        validateTotals(
            tally.transactions
        );

    console.table([
        totals
    ]);

    // =====================
    // RECONCILIATION
    // =====================

    console.log(
        "\n====================================="
    );
    console.log(
        "RUNNING MATCH ENGINE"
    );
    console.log(
        "=====================================\n"
    );

    const generatedMatches =
        runMatcher(
            bank,
            quickbooks
        );

    console.log(
        "Generated Matches:",
        generatedMatches.length
    );

    console.log(
        "\n====================================="
    );
    console.log(
        "LOADING EXPECTED MATCHES"
    );
    console.log(
        "=====================================\n"
    );

    const expectedMatches =
        await loadExpectedMatches();

    console.log(
        "Expected Matches:",
        expectedMatches.length
    );

    console.log(
        "\n====================================="
    );
    console.log(
        "MATCH EVALUATION"
    );
    console.log(
        "=====================================\n"
    );

    const metrics =
        evaluate(
            generatedMatches,
            expectedMatches
        );
    const generatedSet =
        new Set(
            generatedMatches.map(
                (m) =>
                    `${m.bankTransactionIds.join(",")}:${m.bookTransactionIds.join(",")}`
            )
        );

    const missedMatches =
        expectedMatches.filter(
            (m) =>
                !generatedSet.has(
                    `${m.bank_transaction_ids}:${m.book_transaction_ids}`
                )
        );

    console.log(
        "\nMISSED MATCHES:",
        missedMatches.length
    );

    console.table(
        missedMatches.slice(
            0,
            30
        )
    );

    console.table([
        metrics
    ]);

    console.log(
        "\n====================================="
    );
    console.log(
        "TOP GENERATED MATCHES"
    );
    console.log(
        "=====================================\n"
    );

    console.table(
        generatedMatches
            .sort(
                (a, b) =>
                    b.score -
                    a.score
            )
            .slice(
                0,
                20
            )
    );

    const expectedSet =
        new Set(
            expectedMatches.map(
                (m) =>
                    `${m.bank_transaction_ids}:${m.book_transaction_ids}`
            )
        );

    const falsePositives =
        generatedMatches.filter(
            (match) =>
                !expectedSet.has(
                    `${match.bankTransactionIds.join(",")}:${match.bookTransactionIds.join(",")}`
                )
        );

    console.log(
        "\n====================================="
    );
    console.log(
        "FALSE POSITIVE ANALYSIS"
    );
    console.log(
        "=====================================\n"
    );

    console.log(
        "False Positives:",
        falsePositives.length
    );

    console.table(
        falsePositives.slice(
            0,
            10
        )
    );

    console.log(
        "\n====================================="
    );
    console.log(
        "SUMMARY"
    );
    console.log(
        "=====================================\n"
    );

    console.log(
        `Tally Transactions: ${tally.transactions.length}`
    );

    console.log(
        `Tally Lines: ${tally.lines.length}`
    );

    console.log(
        `QuickBooks Transactions: ${quickbooks.length}`
    );

    console.log(
        `Bank Transactions: ${bank.length}`
    );

    console.log(
        `Generated Matches: ${generatedMatches.length}`
    );

    console.log(
        `Expected Matches: ${expectedMatches.length}`
    );

    console.log(
        `Precision: ${(metrics.precision * 100).toFixed(2)}%`
    );

    console.log(
        `Recall: ${(metrics.recall * 100).toFixed(2)}%`
    );

    console.log(
        `F1 Score: ${(metrics.f1 * 100).toFixed(2)}%`
    );
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});