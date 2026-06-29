import path from "path";
import { parseQuickBooks } from "../parsers/quickBooksParser";
import { parseBankCsv } from "../parsers/bankParser";
import { runMatcher } from "../matching/runMatcher";
import { evaluate } from "../validators/reconciliationValidator";
import { ExpectedMatch } from "../types/ExpectedMatch";
import fs from "fs";
import csv from "csv-parser";
import { score } from "../matching/scorer";

async function loadExpectedMatches(): Promise<ExpectedMatch[]> {
    const results: ExpectedMatch[] = [];
    return new Promise((resolve, reject) => {
        fs.createReadStream(path.join(__dirname, "..", "data", "expected_matches.csv"))
            .pipe(csv())
            .on("data", (row) => {
                results.push({
                    match_id: row.match_id,
                    match_type: row.match_type,
                    bank_transaction_ids: row.bank_transaction_ids,
                    book_transaction_ids: row.book_transaction_ids,
                    expected_confidence: row.expected_confidence,
                    explanation: row.explanation
                });
            })
            .on("end", () => resolve(results))
            .on("error", reject);
    });
}

async function main() {
    const quickbooksPath = path.join(__dirname, "..", "data", "quickbooks_book_transactions.xlsx");
    const bankPath = path.join(__dirname, "..", "data", "bank_transactions.csv");

    const quickbooks = parseQuickBooks(quickbooksPath);
    const bank = await parseBankCsv(bankPath);
    const expectedMatches = await loadExpectedMatches();

    const generatedMatches = runMatcher(bank, quickbooks);

    const generatedSet = new Set(
        generatedMatches.map(m => `${m.bankTransactionIds.join(",")}:${m.bookTransactionIds.join(",")}`)
    );

    console.log("\nDiagnosing Missed Single Matches:");
    for (const em of expectedMatches) {
        if (em.match_type === "unmatched") continue;
        const bankIds = em.bank_transaction_ids.split(";");
        const bookIds = em.book_transaction_ids.split(";");

        if (bankIds.length !== 1 || bookIds.length !== 1) continue;

        const pairKey = `${bankIds[0]}:${bookIds[0]}`;
        if (!generatedSet.has(pairKey)) {
            const bankTxn = bank.find(b => b.id === bankIds[0]);
            const bookTxn = quickbooks.find(b => b.id === bookIds[0]);
            if (bankTxn && bookTxn) {
                const s = score(bankTxn, bookTxn);
                console.log(`Missed Single Match: ${em.match_id} (${pairKey})`);
                console.log(`  Scorer Score: ${s}`);
                console.log(`  Explanation: ${em.explanation}`);
            }
        }
    }
}

main().catch(console.error);
