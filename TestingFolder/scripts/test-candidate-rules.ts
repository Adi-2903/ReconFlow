import path from "path";
import { parseQuickBooks } from "../parsers/quickBooksParser";
import { parseBankCsv } from "../parsers/bankParser";
import { runMatcher } from "../matching/runMatcher";
import { evaluate } from "../validators/reconciliationValidator";
import { ExpectedMatch } from "../types/ExpectedMatch";
import fs from "fs";
import csv from "csv-parser";
import { daysBetween, referenceMatches, nameMatches } from "../matching/utils";
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

// Modify generateCandidates behavior dynamically
interface GeneratorConfig {
    amountThreshold: number; // e.g. percent or absolute
    dateThreshold: number; // e.g. days
    requireRefSimilarity: boolean;
    requireNameSimilarity: boolean;
    requireEitherSimilarity: boolean; // Ref similarity OR Counterparty similarity
    allowEmptySimilarityPass: boolean; // if ref/counterparty are empty, do they pass?
    blockOnMismatch?: boolean;
}

function runCandidateTest(
    bank: CanonicalTransaction[],
    quickbooks: CanonicalTransaction[],
    expectedMatches: ExpectedMatch[],
    config: GeneratorConfig,
    description: string
) {
    // We override generateCandidates behavior using a closure or a customized candidate filtering
    // Let's monkey patch or just simulate it.
    // Wait, runMatcher imports generateCandidates. We can mock it if we run in the same process, or we can just run runMatcher with a modified candidate filter inside.
    // To do that easily, let's write custom generator code inside the test.
    // Wait, runMatcher has its own logic, we can import it and see how it behaves if we modify generateCandidates.
    // Since we want to test multiple rules, let's write a modified runner or let's run the actual runMatcher with the candidateGenerator.ts modified.
    // Or we can just print how many correct matches have candidates under each rule combination!
    // Let's do that: check if each expected match pair would be allowed as a candidate under the rules.
    console.log(`\n--- Test: ${description} ---`);
    let totalExpectedPairs = 0;
    let candidatesAllowedCount = 0;

    for (const em of expectedMatches) {
        if (em.match_type === "unmatched") continue;
        const bankIds = em.bank_transaction_ids.split(",");
        const bookIds = em.book_transaction_ids.split(",");
        totalExpectedPairs++;

        // For each pair, let's see if the candidate would be generated
        let allPairsAllowed = true;
        for (const bankId of bankIds) {
            const bankTxn = bank.find(b => b.id === bankId);
            if (!bankTxn) {
                allPairsAllowed = false;
                continue;
            }
            for (const bookId of bookIds) {
                const bookTxn = quickbooks.find(b => b.id === bookId);
                if (!bookTxn) {
                    allPairsAllowed = false;
                    continue;
                }

                // Check amount
                const amountDiff = Math.abs(bankTxn.amount - bookTxn.amount);
                const amountTolerance = Math.max(500, Math.abs(bankTxn.amount) * config.amountThreshold);
                const amountPass = amountDiff <= amountTolerance;

                // Check date
                const dayDiff = daysBetween(bankTxn.transactionDate, bookTxn.transactionDate);
                const datePass = dayDiff <= config.dateThreshold;

                // Check reference similarity
                const refPass = referenceMatches(bankTxn.referenceNumber, bookTxn.referenceNumber);

                // Check counterparty similarity
                const namePass = nameMatches(bankTxn.counterparty, bookTxn.counterparty);

                let similarityPass = true;
                if (config.blockOnMismatch) {
                    const hasRef = bankTxn.referenceNumber && bookTxn.referenceNumber;
                    const refMatch = hasRef ? referenceMatches(bankTxn.referenceNumber, bookTxn.referenceNumber) : true;

                    const hasName = bankTxn.counterparty && bookTxn.counterparty;
                    const nameMatch = hasName ? nameMatches(bankTxn.counterparty, bookTxn.counterparty) : true;

                    similarityPass = refMatch && nameMatch;
                } else if (config.requireEitherSimilarity) {
                    similarityPass = refPass || namePass;
                    if (config.allowEmptySimilarityPass) {
                        // if both references are empty or both names are empty, or either is missing
                        // wait, if we allow empty similarity to pass when fields are missing:
                        if (!bankTxn.referenceNumber && !bookTxn.referenceNumber && !bankTxn.counterparty && !bookTxn.counterparty) {
                            similarityPass = true;
                        }
                    }
                } else {
                    if (config.requireRefSimilarity && !refPass) similarityPass = false;
                    if (config.requireNameSimilarity && !namePass) similarityPass = false;
                }

                if (!amountPass || !datePass || !similarityPass) {
                    allPairsAllowed = false;
                }
            }
        }
        if (allPairsAllowed) {
            candidatesAllowedCount++;
        }
    }
    
    // Count total search space (all candidates generated for all bank transactions)
    let totalCandidatesGenerated = 0;
    for (const bankTxn of bank) {
        for (const bookTxn of quickbooks) {
            const amountDiff = Math.abs(bankTxn.amount - bookTxn.amount);
            const amountTolerance = Math.max(500, Math.abs(bankTxn.amount) * config.amountThreshold);
            const amountPass = amountDiff <= amountTolerance;

            const dayDiff = daysBetween(bankTxn.transactionDate, bookTxn.transactionDate);
            const datePass = dayDiff <= config.dateThreshold;

            const refPass = referenceMatches(bankTxn.referenceNumber, bookTxn.referenceNumber);
            const namePass = nameMatches(bankTxn.counterparty, bookTxn.counterparty);

            let similarityPass = true;
            if (config.blockOnMismatch) {
                const hasRef = bankTxn.referenceNumber && bookTxn.referenceNumber;
                const refMatch = hasRef ? referenceMatches(bankTxn.referenceNumber, bookTxn.referenceNumber) : true;

                const hasName = bankTxn.counterparty && bookTxn.counterparty;
                const nameMatch = hasName ? nameMatches(bankTxn.counterparty, bookTxn.counterparty) : true;

                similarityPass = refMatch && nameMatch;
            } else if (config.requireEitherSimilarity) {
                similarityPass = refPass || namePass;
                if (config.allowEmptySimilarityPass) {
                    if (!bankTxn.referenceNumber && !bookTxn.referenceNumber && !bankTxn.counterparty && !bookTxn.counterparty) {
                        similarityPass = true;
                    }
                }
            } else {
                if (config.requireRefSimilarity && !refPass) similarityPass = false;
                if (config.requireNameSimilarity && !namePass) similarityPass = false;
            }

            if (amountPass && datePass && similarityPass) {
                totalCandidatesGenerated++;
            }
        }
    }

    console.log(`Allowed expected matches: ${candidatesAllowedCount} / ${totalExpectedPairs} (${(candidatesAllowedCount/totalExpectedPairs*100).toFixed(2)}%)`);
    console.log(`Total Candidates Generated: ${totalCandidatesGenerated}`);
}

async function main() {
    const quickbooksPath = path.join(__dirname, "..", "data", "quickbooks_book_transactions.xlsx");
    const bankPath = path.join(__dirname, "..", "data", "bank_transactions.csv");

    const quickbooks = parseQuickBooks(quickbooksPath);
    const bank = await parseBankCsv(bankPath);
    const expectedMatches = await loadExpectedMatches();

    // 1. Current logic (only amount and date, 15% tolerance)
    runCandidateTest(bank, quickbooks, expectedMatches, {
        amountThreshold: 0.15,
        dateThreshold: 7,
        requireRefSimilarity: false,
        requireNameSimilarity: false,
        requireEitherSimilarity: false,
        allowEmptySimilarityPass: false
    }, "Current Logic (Amount <= 15% & Date <= 7 days)");

    // 2. Either similarity with 5% amount tolerance
    runCandidateTest(bank, quickbooks, expectedMatches, {
        amountThreshold: 0.05,
        dateThreshold: 7,
        requireRefSimilarity: false,
        requireNameSimilarity: false,
        requireEitherSimilarity: true,
        allowEmptySimilarityPass: false
    }, "Either: Amount <= 5% & Date <= 7 & (Ref OR Name)");

    // 3. Either similarity with 2% amount tolerance
    runCandidateTest(bank, quickbooks, expectedMatches, {
        amountThreshold: 0.02,
        dateThreshold: 7,
        requireRefSimilarity: false,
        requireNameSimilarity: false,
        requireEitherSimilarity: true,
        allowEmptySimilarityPass: false
    }, "Either: Amount <= 2% & Date <= 7 & (Ref OR Name)");

    // 4. Either similarity with 5% amount tolerance, block on mismatch
    runCandidateTest(bank, quickbooks, expectedMatches, {
        amountThreshold: 0.05,
        dateThreshold: 7,
        requireRefSimilarity: false,
        requireNameSimilarity: false,
        requireEitherSimilarity: false,
        allowEmptySimilarityPass: false,
        blockOnMismatch: true
    }, "Block on Mismatch: Amount <= 5% & Date <= 7 & (missing or matches ref/name)");
}

main().catch(console.error);
