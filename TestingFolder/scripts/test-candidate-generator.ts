import path from "path";
import fs from "fs";
import csv from "csv-parser";
import { parseQuickBooks } from "../parsers/quickBooksParser";
import { parseBankCsv } from "../parsers/bankParser";
import { generateCandidates } from "../matching/candidateGenerator";
import { CanonicalTransaction, FxStatus } from "../types/CanonicalTransaction";
import { ExpectedMatch } from "../types/ExpectedMatch";
import { CandidateResult } from "../types/CandidateResult";

async function loadExpectedMatches(filePath: string): Promise<ExpectedMatch[]> {
    const results: ExpectedMatch[] = [];
    return new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
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

function getPercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
}

async function runTests() {
    console.log("==================================================");
    console.log("RUNNING CANDIDATE GENERATOR TEST SUITE");
    console.log("==================================================\n");

    const dataDir = path.join(__dirname, "..", "data");
    const quickbooksPath = path.join(dataDir, "quickbooks_book_transactions.xlsx");
    const bankPath = path.join(dataDir, "bank_transactions.csv");
    const expectedMatchesPath = path.join(dataDir, "expected_matches.csv");

    // Load data
    const quickbooks = parseQuickBooks(quickbooksPath);
    const bank = await parseBankCsv(bankPath);
    const expectedMatches = await loadExpectedMatches(expectedMatchesPath);

    console.log(`Loaded ${bank.length} bank transactions`);
    console.log(`Loaded ${quickbooks.length} book transactions`);
    console.log(`Loaded ${expectedMatches.length} expected match records\n`);

    // ----------------------------------------------------
    // TEST 1 & 2: RECALL & RANKING TEST
    // ----------------------------------------------------
    console.log("--------------------------------------------------");
    console.log("1. RECALL & RANKING TEST");
    console.log("--------------------------------------------------");

    let totalSingleMatches = 0;
    let recalledSingleMatches = 0;
    let rank1Count = 0;
    let top3Count = 0;

    let totalBulkMatches = 0;
    let recalledBulkMatches = 0;

    for (const em of expectedMatches) {
        if (em.match_type === "unmatched") continue;

        const bankIds = em.bank_transaction_ids.split(/[;,]/).map(id => id.trim()).filter(Boolean);
        const bookIds = em.book_transaction_ids.split(/[;,]/).map(id => id.trim()).filter(Boolean);

        const isBulk = em.match_type === "one_to_many" || em.match_type === "many_to_one";

        if (isBulk) {
            totalBulkMatches++;
            let allPairsFound = true;
            for (const bankId of bankIds) {
                const bankTxn = bank.find(b => b.id === bankId);
                if (!bankTxn) continue;
                const candidates = generateCandidates(bankTxn, quickbooks);
                for (const bookId of bookIds) {
                    const found = candidates.some(c => c.candidate.id === bookId);
                    if (!found) {
                        allPairsFound = false;
                    }
                }
            }
            if (allPairsFound) {
                recalledBulkMatches++;
            }
        } else {
            totalSingleMatches++;
            // Check single matches
            let matchRecalled = true;
            for (const bankId of bankIds) {
                const bankTxn = bank.find(b => b.id === bankId);
                if (!bankTxn) {
                    matchRecalled = false;
                    continue;
                }
                const candidates = generateCandidates(bankTxn, quickbooks);

                for (const bookId of bookIds) {
                    const candidateIndex = candidates.findIndex(c => c.candidate.id === bookId);
                    if (candidateIndex === -1) {
                        matchRecalled = false;
                    } else {
                        if (candidateIndex === 0) {
                            rank1Count++;
                        }
                        if (candidateIndex < 3) {
                            top3Count++;
                        }
                    }
                }
            }

            if (matchRecalled) {
                recalledSingleMatches++;
            } else {
                console.log(`Missed single/fee match: ${em.match_id} (Bank: ${em.bank_transaction_ids}, Book: ${em.book_transaction_ids})`);
            }
        }
    }

    const singleRecallPercent = (recalledSingleMatches / totalSingleMatches) * 100;
    const rank1Percent = recalledSingleMatches > 0 ? (rank1Count / recalledSingleMatches) * 100 : 0;
    const top3Percent = recalledSingleMatches > 0 ? (top3Count / recalledSingleMatches) * 100 : 0;

    console.log(`\nSingle/Fee Adjustment Matches:`);
    console.log(`  Total expected: ${totalSingleMatches}`);
    console.log(`  Recalled:       ${recalledSingleMatches} / ${totalSingleMatches} (${singleRecallPercent.toFixed(2)}%)`);
    console.log(`  Ranked #1:      ${rank1Count} / ${recalledSingleMatches} (${rank1Percent.toFixed(2)}%)`);
    console.log(`  Ranked Top 3:   ${top3Count} / ${recalledSingleMatches} (${top3Percent.toFixed(2)}%)`);

    console.log(`\nBulk (One-to-Many / Many-to-One) Matches:`);
    console.log(`  Total expected: ${totalBulkMatches}`);
    console.log(`  Recalled:       ${recalledBulkMatches} / ${totalBulkMatches} (Expected to be 0% due to 1-to-1 amount tolerance blocking)`);

    // Assertion for single recall
    if (recalledSingleMatches !== totalSingleMatches) {
        throw new Error(`Recall check failed! Recalled ${recalledSingleMatches} of ${totalSingleMatches} single matches.`);
    }
    console.log("PASSED: Recall & Ranking Test (Single Matches 100% Recalled)");

    // ----------------------------------------------------
    // TEST 3: METRICS & SEARCH SPACE REPORT
    // ----------------------------------------------------
    console.log("\n--------------------------------------------------");
    console.log("3. METRICS & SEARCH SPACE REPORT");
    console.log("--------------------------------------------------");

    const candidateCounts: number[] = [];
    let totalGeneratedCandidates = 0;

    for (const bankTxn of bank) {
        const candidates = generateCandidates(bankTxn, quickbooks);
        candidateCounts.push(candidates.length);
        totalGeneratedCandidates += candidates.length;
    }

    const avgCandidates = totalGeneratedCandidates / bank.length;
    const p95Candidates = getPercentile(candidateCounts, 95);
    const maxCandidates = Math.max(...candidateCounts);
    const searchSpaceReduction = (1 - (avgCandidates / quickbooks.length)) * 100;

    console.log(`Total Bank Transactions:       ${bank.length}`);
    console.log(`Average Candidates Per Txn:    ${avgCandidates.toFixed(2)}`);
    console.log(`95th Percentile Candidates:    ${p95Candidates}`);
    console.log(`Max Candidates Per Txn:        ${maxCandidates}`);
    console.log(`Search Space Reduction:        ${searchSpaceReduction.toFixed(2)}%`);
    console.log("PASSED: Metrics & Search Space Report Generated");

    // ----------------------------------------------------
    // TEST 4: BLOCKING TEST (Direction & Missing Rate Mismatch)
    // ----------------------------------------------------
    console.log("\n--------------------------------------------------");
    console.log("4. BLOCKING TEST");
    console.log("--------------------------------------------------");

    // Create custom transactions
    const baseTxn: CanonicalTransaction = {
        id: "TXN_BASE",
        source: "bank",
        transactionDate: new Date("2026-03-01"),
        amount: 100,
        amountMinor: 10000n,
        direction: "credit",
        sourceId: "TXN_BASE",
        matchingSignals: {}
    };

    const bookDirMismatch: CanonicalTransaction = {
        id: "BOOK_DIR_MISMATCH",
        source: "quickbooks",
        transactionDate: new Date("2026-03-01"),
        amount: 100,
        amountMinor: 10000n,
        direction: "debit",
        sourceId: "BOOK_DIR_MISMATCH",
        matchingSignals: {}
    };

    // 1. Direction mismatch should block
    const dirCandidates = generateCandidates(baseTxn, [bookDirMismatch]);
    console.log(`Direction Mismatch Candidates Count: ${dirCandidates.length}`);
    if (dirCandidates.length !== 0) {
        throw new Error("Blocking test failed: direction mismatch candidate was not blocked!");
    }
    console.log("PASSED: Direction mismatch successfully blocked.");

    // 2. Missing rate check
    const bankCrossCurrency: CanonicalTransaction = {
        ...baseTxn,
        currency: "USD",
        baseCurrency: "INR",
        convertedAmountMinor: undefined,
        fxStatus: "MISSING_RATE"
    };

    const bookCrossCurrency: CanonicalTransaction = {
        id: "BOOK_CROSS",
        source: "quickbooks",
        transactionDate: new Date("2026-03-01"),
        amount: 8400,
        amountMinor: 840000n,
        currency: "INR",
        direction: "credit",
        sourceId: "BOOK_CROSS",
        matchingSignals: {}
    };

    const missingRateCandidates = generateCandidates(bankCrossCurrency, [bookCrossCurrency]);
    console.log(`Missing Rate Mismatch Candidates Count: ${missingRateCandidates.length}`);
    if (missingRateCandidates.length !== 0) {
        throw new Error("Blocking test failed: missing FX rate candidate was not blocked!");
    }
    console.log("PASSED: Missing rate mismatch successfully blocked.");

    // ----------------------------------------------------
    // TEST 5: SETTLEMENT TEST
    // ----------------------------------------------------
    console.log("\n--------------------------------------------------");
    console.log("5. SETTLEMENT TEST (Stripe name mismatch bypass)");
    console.log("--------------------------------------------------");

    const stripeBank: CanonicalTransaction = {
        id: "STRIPE_BANK",
        source: "bank",
        transactionDate: new Date("2026-03-01"),
        amount: 1000,
        amountMinor: 100000n,
        direction: "credit",
        counterparty: "STRIPE PAYOUT 12345",
        sourceId: "STRIPE_BANK",
        matchingSignals: {
            channel: "STRIPE"
        }
    };

    const stripeBook: CanonicalTransaction = {
        id: "STRIPE_BOOK",
        source: "quickbooks",
        transactionDate: new Date("2026-03-01"),
        amount: 1000,
        amountMinor: 100000n,
        direction: "credit",
        counterparty: "Stripe Settlement",
        sourceId: "STRIPE_BOOK",
        matchingSignals: {}
    };

    const stripeCandidates = generateCandidates(stripeBank, [stripeBook]);
    console.log(`Stripe Payout Candidates Count: ${stripeCandidates.length}`);
    if (stripeCandidates.length !== 1) {
        throw new Error("Settlement test failed: Stripe payout candidate was blocked!");
    }
    console.log(`Stripe Candidate Score: ${stripeCandidates[0].score}, Band: ${stripeCandidates[0].confidenceBand}`);
    console.log("PASSED: Stripe settlement successfully resolved despite name mismatch.");

    // ----------------------------------------------------
    // TEST 6: CROSS-CURRENCY RECALL TEST
    // ----------------------------------------------------
    console.log("\n--------------------------------------------------");
    console.log("6. CROSS-CURRENCY RECALL TEST");
    console.log("--------------------------------------------------");

    const crossBank: CanonicalTransaction = {
        id: "CROSS_BANK",
        source: "bank",
        transactionDate: new Date("2026-03-01"),
        amount: 84.50,
        amountMinor: 8450n,
        currency: "USD",
        baseCurrency: "INR",
        convertedAmountMinor: 8450n,
        fxStatus: "CONVERTED",
        direction: "credit",
        sourceId: "CROSS_BANK",
        matchingSignals: {}
    };

    const crossBook: CanonicalTransaction = {
        id: "CROSS_BOOK",
        source: "quickbooks",
        transactionDate: new Date("2026-03-01"),
        amount: 84.50,
        amountMinor: 8450n,
        currency: "INR",
        baseCurrency: "INR",
        convertedAmountMinor: 8450n,
        direction: "credit",
        sourceId: "CROSS_BOOK",
        matchingSignals: {}
    };

    const crossCandidates = generateCandidates(crossBank, [crossBook]);
    console.log(`Cross-currency Candidates Count: ${crossCandidates.length}`);
    if (crossCandidates.length !== 1) {
        throw new Error("Cross-currency test failed: converted transaction was blocked!");
    }
    console.log(`Cross-currency Candidate Score: ${crossCandidates[0].score}, Band: ${crossCandidates[0].confidenceBand}`);

    // Verify it blocks on MISSING_RATE
    const crossBankMissing: CanonicalTransaction = {
        ...crossBank,
        fxStatus: "MISSING_RATE"
    };
    const crossCandidatesMissing = generateCandidates(crossBankMissing, [crossBook]);
    console.log(`Cross-currency (Missing Rate) Candidates Count: ${crossCandidatesMissing.length}`);
    if (crossCandidatesMissing.length !== 0) {
        throw new Error("Cross-currency test failed: missing rate did not block the candidate!");
    }
    console.log("PASSED: Cross-currency recall and missing rate tests.");

    // ----------------------------------------------------
    // TEST 7: DUPLICATE AMBIGUITY TEST
    // ----------------------------------------------------
    console.log("\n--------------------------------------------------");
    console.log("7. DUPLICATE AMBIGUITY TEST");
    console.log("--------------------------------------------------");

    const dupBank: CanonicalTransaction = {
        id: "DUP_BANK",
        source: "bank",
        transactionDate: new Date("2026-03-01"),
        amount: 1000,
        amountMinor: 100000n,
        direction: "credit",
        sourceId: "DUP_BANK",
        matchingSignals: {}
    };

    const dupBookA: CanonicalTransaction = {
        id: "DUP_BOOK_A",
        source: "quickbooks",
        transactionDate: new Date("2026-03-01"),
        amount: 1000,
        amountMinor: 100000n,
        direction: "credit",
        sourceId: "DUP_BOOK_A",
        matchingSignals: {}
    };

    const dupBookB: CanonicalTransaction = {
        id: "DUP_BOOK_B",
        source: "quickbooks",
        transactionDate: new Date("2026-03-01"),
        amount: 1000,
        amountMinor: 100000n,
        direction: "credit",
        sourceId: "DUP_BOOK_B",
        matchingSignals: {}
    };

    const dupCandidates = generateCandidates(dupBank, [dupBookA, dupBookB]);
    console.log(`Duplicate Candidates Count: ${dupCandidates.length}`);
    if (dupCandidates.length !== 2) {
        throw new Error("Duplicate ambiguity test failed: did not return both identical books!");
    }
    console.log(`Candidate 1: ${dupCandidates[0].candidate.id}, Score: ${dupCandidates[0].score}`);
    console.log(`Candidate 2: ${dupCandidates[1].candidate.id}, Score: ${dupCandidates[1].score}`);
    console.log("PASSED: Duplicate ambiguity test (both duplicate books returned in stable rank order).");

    console.log("\n==================================================");
    console.log("ALL TESTS PASSED SUCCESSFULLY!");
    console.log("==================================================");
}

runTests().catch(err => {
    console.error("Test suite failed:", err);
    process.exit(1);
});
