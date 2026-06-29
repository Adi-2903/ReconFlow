import path from "path";
import { parseQuickBooks } from "../parsers/quickBooksParser";
import { parseBankCsv } from "../parsers/bankParser";
import { ExpectedMatch } from "../types/ExpectedMatch";
import fs from "fs";
import csv from "csv-parser";
import { daysBetween, referenceMatches, nameMatches } from "../matching/utils";

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

    console.log("Analyzing each expected match...");
    for (const em of expectedMatches) {
        if (em.match_type === "unmatched") continue;
        const bankIds = em.bank_transaction_ids.split(",");
        const bookIds = em.book_transaction_ids.split(",");

        for (const bankId of bankIds) {
            const bankTxn = bank.find(b => b.id === bankId);
            for (const bookId of bookIds) {
                const bookTxn = quickbooks.find(b => b.id === bookId);
                if (bankTxn && bookTxn) {
                    const refOk = referenceMatches(bankTxn.referenceNumber, bookTxn.referenceNumber);
                    const nameOk = nameMatches(bankTxn.counterparty, bookTxn.counterparty);
                    
                    const bankRef = bankTxn.referenceNumber || "";
                    const bookRef = bookTxn.referenceNumber || "";
                    const bankName = bankTxn.counterparty || "";
                    const bookName = bookTxn.counterparty || "";

                    if (!refOk && !nameOk) {
                        console.log(`Mismatch in both ref and name for expected match ${em.match_id}:`);
                        console.log(`  Bank ID: ${bankTxn.id}, Book ID: ${bookTxn.id}`);
                        console.log(`  Bank Ref: "${bankRef}", Book Ref: "${bookRef}" (Ref Ok: ${refOk})`);
                        console.log(`  Bank Name: "${bankName}", Book Name: "${bookName}" (Name Ok: ${nameOk})`);
                        console.log(`  Explanation: ${em.explanation}`);
                    }
                }
            }
        }
    }
}

main().catch(console.error);
