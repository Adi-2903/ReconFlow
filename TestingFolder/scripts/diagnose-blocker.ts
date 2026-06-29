import path from "path";
import { parseQuickBooks } from "../parsers/quickBooksParser";
import { parseBankCsv } from "../parsers/bankParser";
import { ExpectedMatch } from "../types/ExpectedMatch";
import fs from "fs";
import csv from "csv-parser";
import { daysBetween, referenceMatches, nameMatches, directionMatches } from "../matching/utils";
import { CanonicalTransaction } from "../types/CanonicalTransaction";

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

    const TOLERANCE_BPS = 500n;
    const MIN_AMOUNT_TOLERANCE = 500n;

    console.log("\nDiagnosing Blocker Filters for Expected Matches:");
    
    let totalNonBulk = 0;
    let blockedCount = 0;

    for (const em of expectedMatches) {
        if (em.match_type === "unmatched") continue;
        const bankIds = em.bank_transaction_ids.split(";");
        const bookIds = em.book_transaction_ids.split(";");

        totalNonBulk++;

        // For this test, let's analyze each pair in the match
        for (const bankId of bankIds) {
            const bankTxn = bank.find(b => b.id === bankId);
            for (const bookId of bookIds) {
                const bookTxn = quickbooks.find(b => b.id === bookId);

                if (!bankTxn || !bookTxn) {
                    console.log(`  Match ${em.match_id}: Transaction not found! bankId=${bankId}, bookId=${bookId}`);
                    blockedCount++;
                    continue;
                }

        // Direction Check
        const dirPass = directionMatches(bankTxn, bookTxn);

        // Currency Check
        const currenciesDiffer = bankTxn.currency && bookTxn.currency && bankTxn.currency !== bookTxn.currency;
        const currencyPass =
            (!bankTxn.currency || !bookTxn.currency) ||
            (bankTxn.currency === bookTxn.currency) ||
            (bankTxn.convertedAmountMinor !== undefined && bankTxn.convertedAmountMinor !== null &&
             bookTxn.convertedAmountMinor !== undefined && bookTxn.convertedAmountMinor !== null &&
             bankTxn.baseCurrency && bookTxn.baseCurrency &&
             bankTxn.baseCurrency === bookTxn.baseCurrency);
        const fxStatusPass = !(currenciesDiffer && bankTxn.fxStatus === "MISSING_RATE");

        // Amount Check
        const bankAmtMinor = bankTxn.convertedAmountMinor !== undefined && bankTxn.convertedAmountMinor !== null
            ? bankTxn.convertedAmountMinor
            : bankTxn.amountMinor;

        const bookAmtMinor = bookTxn.convertedAmountMinor !== undefined && bookTxn.convertedAmountMinor !== null
            ? bookTxn.convertedAmountMinor
            : bookTxn.amountMinor;

        let amountPass = false;
        let diffStr = "";
        let tolStr = "";
        if (bankAmtMinor !== undefined && bookAmtMinor !== undefined) {
            const diff = bankAmtMinor > bookAmtMinor ? bankAmtMinor - bookAmtMinor : bookAmtMinor - bankAmtMinor;
            const comparisonAmount = bankAmtMinor > bookAmtMinor ? bankAmtMinor : bookAmtMinor;
            const calculatedTolerance = (comparisonAmount * TOLERANCE_BPS) / 10000n;
            const allowedTolerance = calculatedTolerance > MIN_AMOUNT_TOLERANCE ? calculatedTolerance : MIN_AMOUNT_TOLERANCE;
            amountPass = diff <= allowedTolerance;
            diffStr = diff.toString();
            tolStr = allowedTolerance.toString();
        }

        // Date Check
        const dayDiff = daysBetween(bankTxn.transactionDate, bookTxn.transactionDate);
        const datePass = dayDiff <= 7; // using default 7 days max for diagnosis

        if (!dirPass || !currencyPass || !fxStatusPass || !amountPass || !datePass) {
            blockedCount++;
            console.log(`Blocked Expected Match: ${em.match_id} (${bankTxn.id} -> ${bookTxn.id})`);
            console.log(`  Direction Pass: ${dirPass} (Bank: ${bankTxn.direction}, Book: ${bookTxn.direction})`);
            console.log(`  Currency Pass: ${currencyPass} (Bank Curr: ${bankTxn.currency}, Book Curr: ${bookTxn.currency})`);
            console.log(`  FX Status Pass: ${fxStatusPass}`);
            console.log(`  Amount Pass: ${amountPass} (Bank AmtMinor: ${bankAmtMinor}, Book AmtMinor: ${bookAmtMinor}, Diff: ${diffStr}, Tol: ${tolStr})`);
            console.log(`  Date Pass: ${datePass} (Day Diff: ${dayDiff})`);
        }
            }
        }
    }

    console.log(`\nDiagnosis Summary: Blocked ${blockedCount} out of ${totalNonBulk} single expected matches.`);
}

main().catch(console.error);
