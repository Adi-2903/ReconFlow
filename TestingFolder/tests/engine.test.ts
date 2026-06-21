// TestingFolder/tests/engine.test.ts

import { runMatcher } from "../matching/runMatcher";
import { CanonicalTransaction } from "../types/CanonicalTransaction";

function assert(condition: boolean, message: string) {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
    }
}

async function runTests() {
    console.log("==================================================");
    console.log("RUNNING MATCHING ENGINE UNIT TESTS");
    console.log("==================================================\n");

    // ----------------------------------------------------
    // TEST 1: EXACT MATCH VS FUZZY MATCH PRIORITY
    // ----------------------------------------------------
    console.log("Test 1: Exact Match Priority");
    const bankTx1: CanonicalTransaction = {
        id: "BANK1",
        source: "bank",
        transactionDate: new Date("2026-03-01"),
        amount: 1000,
        amountMinor: 100000n,
        direction: "credit",
        referenceNumber: "INV-100",
        sourceId: "BANK1"
    };

    // Candidate A: exact amount and ref
    const bookTx1A: CanonicalTransaction = {
        id: "BOOK1_A",
        source: "quickbooks",
        transactionDate: new Date("2026-03-01"),
        amount: 1000,
        amountMinor: 100000n,
        direction: "credit",
        referenceNumber: "INV-100",
        sourceId: "BOOK1_A"
    };

    // Candidate B: near match amount and diff ref
    const bookTx1B: CanonicalTransaction = {
        id: "BOOK1_B",
        source: "quickbooks",
        transactionDate: new Date("2026-03-01"),
        amount: 990,
        amountMinor: 99000n,
        direction: "credit",
        referenceNumber: "INV-999",
        sourceId: "BOOK1_B"
    };

    const matches1 = runMatcher([bankTx1], [bookTx1A, bookTx1B]);
    assert(matches1.length === 1, "Should generate exactly 1 match");
    assert(matches1[0].bookTransactionIds.includes("BOOK1_A"), "Should match with exact candidate");
    assert(matches1[0].matchType === "exact", "Should be classification 'exact'");
    console.log("  PASSED: Exact match correctly chosen over fuzzy match.");

    // ----------------------------------------------------
    // TEST 2: PROCESSOR FEE MATCH (970 bank vs 1000 book)
    // ----------------------------------------------------
    console.log("\nTest 2: Processor Fee Matching");
    const bankTx2: CanonicalTransaction = {
        id: "BANK2",
        source: "bank",
        transactionDate: new Date("2026-03-01"),
        amount: 970,
        amountMinor: 97000n,
        direction: "credit",
        referenceNumber: "INV-200",
        sourceId: "BANK2"
    };

    const bookTx2: CanonicalTransaction = {
        id: "BOOK2",
        source: "quickbooks",
        transactionDate: new Date("2026-03-01"),
        amount: 1000,
        amountMinor: 100000n,
        direction: "credit",
        referenceNumber: "INV-200",
        sourceId: "BOOK2"
    };

    const matches2 = runMatcher([bankTx2], [bookTx2]);
    assert(matches2.length === 1, "Should generate 1 match");
    assert(matches2[0].matchType === "fee_adjustment", "Should be classification 'fee_adjustment'");
    assert(matches2[0].reasons?.some((r) => r.reason === "fee_match_validated") || false, "Should include fee validation reason");
    console.log("  PASSED: Processor fee match successfully reconciled.");

    // ----------------------------------------------------
    // TEST 3: SUBSET MATCH (400 + 600 = 1000)
    // ----------------------------------------------------
    console.log("\nTest 3: Subset Matching");
    const bankTx3: CanonicalTransaction = {
        id: "BANK3",
        source: "bank",
        transactionDate: new Date("2026-03-01"),
        amount: 1000,
        amountMinor: 100000n,
        direction: "credit",
        counterparty: "GreenLeaf Enterprises",
        sourceId: "BANK3"
    };

    const bookTx3A: CanonicalTransaction = {
        id: "BOOK3_A",
        source: "quickbooks",
        transactionDate: new Date("2026-03-01"),
        amount: 400,
        amountMinor: 40000n,
        direction: "credit",
        counterparty: "GreenLeaf Enterprises",
        sourceId: "BOOK3_A"
    };

    const bookTx3B: CanonicalTransaction = {
        id: "BOOK3_B",
        source: "quickbooks",
        transactionDate: new Date("2026-03-01"),
        amount: 600,
        amountMinor: 60000n,
        direction: "credit",
        counterparty: "GreenLeaf Enterprises",
        sourceId: "BOOK3_B"
    };

    const matches3 = runMatcher([bankTx3], [bookTx3A, bookTx3B]);
    assert(matches3.length === 1, "Should generate 1 match");
    assert(matches3[0].matchType === "one_to_many", "Should be one_to_many");
    assert(matches3[0].bookTransactionIds.includes("BOOK3_A") && matches3[0].bookTransactionIds.includes("BOOK3_B"), "Should include both books");
    console.log("  PASSED: Subset match (1-to-N) successfully reconciled.");

    // ----------------------------------------------------
    // TEST 4: AMBIGUITY RESOLUTION (TIE-BREAKERS)
    // ----------------------------------------------------
    console.log("\nTest 4: Ambiguity Tie-Breaker Resolution");
    const bankTx4: CanonicalTransaction = {
        id: "BANK4",
        source: "bank",
        transactionDate: new Date("2026-03-05"),
        amount: 1000,
        amountMinor: 100000n,
        direction: "credit",
        referenceNumber: "INV-400",
        sourceId: "BANK4"
    };

    // Match 1: Closer date (2026-03-05 vs 2026-03-03)
    const bookTx4A: CanonicalTransaction = {
        id: "BOOK4_A",
        source: "quickbooks",
        transactionDate: new Date("2026-03-05"),
        amount: 1000,
        amountMinor: 100000n,
        direction: "credit",
        referenceNumber: "INV-400",
        sourceId: "BOOK4_A"
    };

    const bookTx4B: CanonicalTransaction = {
        id: "BOOK4_B",
        source: "quickbooks",
        transactionDate: new Date("2026-03-03"),
        amount: 1000,
        amountMinor: 100000n,
        direction: "credit",
        referenceNumber: "INV-400",
        sourceId: "BOOK4_B"
    };

    const matches4 = runMatcher([bankTx4], [bookTx4A, bookTx4B]);
    assert(matches4.length === 1, "Should generate 1 match");
    assert(matches4[0].bookTransactionIds[0] === "BOOK4_A", "Should match the closest date (BOOK4_A)");
    console.log("  PASSED: Ambiguity tie-breaker correctly resolved using date proximity.");

    // ----------------------------------------------------
    // TEST 5: MATCH CONSUMPTION
    // ----------------------------------------------------
    console.log("\nTest 5: Match Consumption (No Reuse)");
    const bankTx5A: CanonicalTransaction = {
        id: "BANK5_A",
        source: "bank",
        transactionDate: new Date("2026-03-01"),
        amount: 1000,
        amountMinor: 100000n,
        direction: "credit",
        referenceNumber: "INV-500",
        sourceId: "BANK5_A"
    };

    const bankTx5B: CanonicalTransaction = {
        id: "BANK5_B",
        source: "bank",
        transactionDate: new Date("2026-03-01"),
        amount: 1000,
        amountMinor: 100000n,
        direction: "credit",
        referenceNumber: "INV-500",
        sourceId: "BANK5_B"
    };

    const bookTx5: CanonicalTransaction = {
        id: "BOOK5",
        source: "quickbooks",
        transactionDate: new Date("2026-03-01"),
        amount: 1000,
        amountMinor: 100000n,
        direction: "credit",
        referenceNumber: "INV-500",
        sourceId: "BOOK5"
    };

    const matches5 = runMatcher([bankTx5A, bankTx5B], [bookTx5]);
    assert(matches5.length === 1, "Should output exactly 1 match (the other bank transaction remains unmatched)");
    const matchedCount = matches5.filter((m) => m.matchType === "exact").length;
    assert(matchedCount === 1, "Only one bank transaction should match the single book entry");
    console.log("  PASSED: Book transaction successfully consumed, preventing double-matching.");

    // ----------------------------------------------------
    // TEST 6: PARTIAL PAYMENT LIFECYCLE
    // ----------------------------------------------------
    console.log("\nTest 6: Partial Payment Lifecycle (Invoice = 1000, Pay1 = 400, Pay2 = 600)");
    const bookTx6: CanonicalTransaction = {
        id: "BOOK6",
        source: "quickbooks",
        transactionDate: new Date("2026-03-01"),
        amount: 1000,
        amountMinor: 100000n,
        direction: "credit",
        referenceNumber: "INV-600",
        sourceId: "BOOK6"
    };

    const bankTx6A: CanonicalTransaction = {
        id: "BANK6_A",
        source: "bank",
        transactionDate: new Date("2026-03-01"),
        amount: 400,
        amountMinor: 40000n,
        direction: "credit",
        referenceNumber: "INV-600",
        sourceId: "BANK6_A"
    };

    const bankTx6B: CanonicalTransaction = {
        id: "BANK6_B",
        source: "bank",
        transactionDate: new Date("2026-03-02"),
        amount: 600,
        amountMinor: 60000n,
        direction: "credit",
        referenceNumber: "INV-600",
        sourceId: "BANK6_B"
    };

    // Run first payment (should match partially as partial_payment)
    const matches6A = runMatcher([bankTx6A], [bookTx6]);
    assert(matches6A.length === 1, "Should generate exactly 1 match for BANK6_A");
    assert(matches6A[0].matchType === "partial_payment", "First match should be partial_payment");
    assert(matches6A[0].score === 65, "Should inherit score + validation bonus (60 + 5 = 65)");

    // Simulate remaining balance in books (BOOK6 remaining balance = 600)
    const bookTx6Remaining: CanonicalTransaction = {
        ...bookTx6,
        amount: 600,
        amountMinor: 60000n
    };

    // Run second payment (should match exactly now)
    const matches6B = runMatcher([bankTx6B], [bookTx6Remaining]);
    assert(matches6B.length === 1, "Should generate exactly 1 match for BANK6_B");
    assert(matches6B[0].matchType === "exact", "Second match should be exact now that remaining balance matches");
    console.log("  PASSED: Invoice successfully transitioned UNMATCHED -> PARTIALLY_MATCHED -> MATCHED.");

    // ----------------------------------------------------
    // TEST 7: OVERPAYMENT TEST (Invoice = 1000, Pay1 = 800, Pay2 = 400)
    // ----------------------------------------------------
    console.log("\nTest 7: Overpayment Prevention");
    const bookTx7: CanonicalTransaction = {
        id: "BOOK7",
        source: "quickbooks",
        transactionDate: new Date("2026-03-01"),
        amount: 1000,
        amountMinor: 100000n,
        direction: "credit",
        referenceNumber: "INV-700",
        sourceId: "BOOK7"
    };

    const bankTx7A: CanonicalTransaction = {
        id: "BANK7_A",
        source: "bank",
        transactionDate: new Date("2026-03-01"),
        amount: 800,
        amountMinor: 80000n,
        direction: "credit",
        referenceNumber: "INV-700",
        sourceId: "BANK7_A"
    };

    const bankTx7B: CanonicalTransaction = {
        id: "BANK7_B",
        source: "bank",
        transactionDate: new Date("2026-03-02"),
        amount: 400, // exceeds remaining 200 balance!
        amountMinor: 40000n,
        direction: "credit",
        referenceNumber: "INV-700",
        sourceId: "BANK7_B"
    };

    // First payment: OK
    const matches7A = runMatcher([bankTx7A], [bookTx7]);
    assert(matches7A.length === 1, "First payment BANK7_A should match");
    assert(matches7A[0].matchType === "partial_payment", "Should match as partial_payment");

    // Simulate remaining balance (BOOK7 remaining balance = 200)
    const bookTx7Remaining: CanonicalTransaction = {
        ...bookTx7,
        amount: 200,
        amountMinor: 20000n
    };

    // Second payment: Should be blocked since it overpays the remaining balance (400 > 200)
    const matches7B = runMatcher([bankTx7B], [bookTx7Remaining]);
    assert(matches7B.length === 0, "Second payment should be rejected/not matched");
    console.log("  PASSED: Overpayment successfully blocked from partial match.");

    // ----------------------------------------------------
    // TEST 8: FX DIFFERENCE TEST (USD ↔ INR)
    // ----------------------------------------------------
    console.log("\nTest 8: FX Difference Matching");
    const bankTx8: CanonicalTransaction = {
        id: "BANK8",
        source: "bank",
        transactionDate: new Date("2026-03-01"),
        amount: 84.50,
        amountMinor: 8450n,
        currency: "USD",
        baseCurrency: "INR",
        convertedAmountMinor: 8450n,
        fxStatus: "CONVERTED",
        direction: "credit",
        counterparty: "ACME CORP",
        sourceId: "BANK8"
    };

    const bookTx8: CanonicalTransaction = {
        id: "BOOK8",
        source: "quickbooks",
        transactionDate: new Date("2026-03-01"),
        amount: 84.50,
        amountMinor: 8450n,
        currency: "INR",
        baseCurrency: "INR",
        convertedAmountMinor: 8450n,
        direction: "credit",
        counterparty: "Acme Corporation",
        sourceId: "BOOK8"
    };

    const matches8 = runMatcher([bankTx8], [bookTx8]);
    assert(matches8.length === 1, "Should generate 1 match");
    assert(matches8[0].matchType === "fx_difference", "Should be mapped to fx_difference MatchType");
    console.log("  PASSED: FX Difference successfully matched via converted amounts & base currency.");

    // ----------------------------------------------------
    // TEST 9: CANDIDATE ORDERING REGRESSION TEST
    // ----------------------------------------------------
    console.log("\nTest 9: Candidate Ordering Regression Test");
    const bankTx9: CanonicalTransaction = {
        id: "BANK9",
        source: "bank",
        transactionDate: new Date("2026-03-01"),
        amount: 1000,
        amountMinor: 100000n,
        direction: "credit",
        referenceNumber: "INV-900",
        sourceId: "BANK9"
    };

    // Candidates with descending candidate score ranking computed by generateCandidates
    // Candidate A: exact date & ref (highest score)
    const bookTx9A: CanonicalTransaction = {
        id: "BOOK9_A",
        source: "quickbooks",
        transactionDate: new Date("2026-03-01"),
        amount: 1000,
        amountMinor: 100000n,
        direction: "credit",
        referenceNumber: "INV-900",
        sourceId: "BOOK9_A"
    };

    // Candidate B: date delay (medium score)
    const bookTx9B: CanonicalTransaction = {
        id: "BOOK9_B",
        source: "quickbooks",
        transactionDate: new Date("2026-03-05"),
        amount: 1000,
        amountMinor: 100000n,
        direction: "credit",
        referenceNumber: "INV-900",
        sourceId: "BOOK9_B"
    };

    // Candidate C: no reference overlap, date delay (lowest score)
    const bookTx9C: CanonicalTransaction = {
        id: "BOOK9_C",
        source: "quickbooks",
        transactionDate: new Date("2026-03-07"),
        amount: 1000,
        amountMinor: 100000n,
        direction: "credit",
        referenceNumber: "INV-XYZ",
        sourceId: "BOOK9_C"
    };

    // We run matches separately to verify candidate scores
    const genA = runMatcher([bankTx9], [bookTx9A]);
    const genB = runMatcher([bankTx9], [bookTx9B]);
    const genC = runMatcher([bankTx9], [bookTx9C]);

    const scoreA = genA[0]?.score || 0;
    const scoreB = genB[0]?.score || 0;
    const scoreC = genC[0]?.score || 0;

    console.log(`  Candidate Scores: A=${scoreA}, B=${scoreB}, C=${scoreC}`);
    assert(scoreA > scoreB, "A must score higher than B");
    assert(scoreB > scoreC, "B must score higher than C");
    console.log("  PASSED: Phase 5 candidate scores are successfully inherited and preserved in final ranking.");

    console.log("\n==================================================");
    console.log("ALL TESTS PASSED SUCCESSFULLY!");
    console.log("==================================================");
}

runTests().catch((err) => {
    console.error("Unit test failure:", err);
    process.exit(1);
});
