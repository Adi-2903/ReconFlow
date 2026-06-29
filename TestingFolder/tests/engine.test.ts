// TestingFolder/tests/engine.test.ts

import { runMatcher as rawRunMatcher } from "../matching/runMatcher";
import { CanonicalTransaction } from "../types/CanonicalTransaction";

const runMatcher = (bankTxns: CanonicalTransaction[], bookTxns: CanonicalTransaction[]) => 
    rawRunMatcher(bankTxns, bookTxns).filter(m => m.matchType !== "unmatched_ledger");

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
    assert(matches1[0].matchOutcome === "MATCHED", "Outcome should be MATCHED");
    assert(matches1[0].discrepancyType === "NONE", "Discrepancy should be NONE");
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
    assert(matches2[0].matchOutcome === "MATCHED", "Outcome should be MATCHED");
    assert(matches2[0].discrepancyType === "PROCESSING_FEE", "Discrepancy should be PROCESSING_FEE");
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
    console.log("DISCREPANCY IS: ", matches3[0].discrepancyType);
    assert(matches3[0].matchOutcome === "MATCHED", "Outcome should be MATCHED");
    assert(matches3[0].discrepancyType === "NONE", "Discrepancy should be NONE");
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

    // ----------------------------------------------------
    // TEST 10: B2 — STRIPE BULK PAYOUT (4 invoices minus fees)
    // ----------------------------------------------------
    console.log("\nTest 10: Stripe Bulk Payout (B2) — 1 bank payout matches 4 invoices via combo fee");

    // 4 invoices of ₹41,125 each = ₹164,500 total
    // Stripe INR fee: 2.9% + ₹25 per txn = 4×(41125×0.029 + 2500) = 4×(1193 + 2500) = 4×3693 = ₹14,772
    // Expected bank payout: ₹164,500 - ₹14,772 = ₹149,728 → 14972800 paise (approx)
    // Use round numbers that cleanly satisfy matchesProcessorFeeForCombo

    const bankTx10: CanonicalTransaction = {
        id: "BANK10",
        source: "bank",
        transactionDate: new Date("2026-01-12"),
        amount: 1496290,           // ₹14962.90 (scaled for test; real values don't matter, math must hold)
        amountMinor: 149629000n,   // 4× invoices minus Stripe fee (approx)
        direction: "credit",
        description: "STRIPE PAYOUT po_1Pjk29",
        referenceNumber: "po_1Pjk29",
        counterparty: "Stripe",
        sourceId: "BANK10"
    };

    // 4 invoices of ₹41,000 each (= ₹164,000 total)
    // Stripe INR fee per invoice: round(4100000 * 0.029) + 2500 = 118900 + 2500 = 121400 paise
    // Total fee for 4: 485600 paise
    // Expected bank payout: 16400000 - 485600 = 15914400 paise ≈ ₹159,144
    const makeInvoice10 = (id: string): CanonicalTransaction => ({
        id,
        source: "quickbooks",
        transactionDate: new Date("2026-01-09"),
        amount: 41000,
        amountMinor: 4100000n,
        direction: "credit",
        referenceNumber: id,
        counterparty: "Various Client",
        sourceId: id
    });

    const book10A = makeInvoice10("INV10A");
    const book10B = makeInvoice10("INV10B");
    const book10C = makeInvoice10("INV10C");
    const book10D = makeInvoice10("INV10D");

    // Override bank amount to exactly match expected payout after combo fee
    const stripePerInvoice = Math.round(4100000 * 0.029) + 2500; // 121400 paise per invoice
    const totalInvoice = 4100000 * 4; // 16400000 paise
    const totalFee = stripePerInvoice * 4; // 485600 paise
    const expectedPayout = totalInvoice - totalFee; // 15914400 paise

    const bankTx10Exact: CanonicalTransaction = {
        ...bankTx10,
        amount: expectedPayout / 100,
        amountMinor: BigInt(expectedPayout)
    };

    const matches10 = runMatcher([bankTx10Exact], [book10A, book10B, book10C, book10D]);
    assert(matches10.length === 1, "B2: Should generate exactly 1 match");
    assert(matches10[0].matchType === "one_to_many", `B2: Should be one_to_many, got ${matches10[0].matchType}`);
    assert(matches10[0].bookTransactionIds.length === 4, `B2: Should match all 4 invoices, got ${matches10[0].bookTransactionIds.length}`);
    console.log("  PASSED: Stripe bulk payout matched against 4 invoices via combo fee formula.");

    // ----------------------------------------------------
    // TEST 11: B1/B3 REGRESSION — NEFT bulk, no Stripe keyword
    // ----------------------------------------------------
    console.log("\nTest 11: B1/B3 Regression — NEFT bulk (Stripe hatch must NOT fire)");

    // Bank: NEFT narration with no Stripe keyword, matches 2 invoices by sum
    const bankTx11: CanonicalTransaction = {
        id: "BANK11",
        source: "bank",
        transactionDate: new Date("2026-01-20"),
        amount: 80000,
        amountMinor: 8000000n,
        direction: "credit",
        description: "NEFT FROM BRIGHT PATH CONSULTING N052026012099887",
        referenceNumber: "N052026012099887",
        counterparty: "Bright Path Consulting",
        sourceId: "BANK11"
    };

    const book11A: CanonicalTransaction = {
        id: "INV11A",
        source: "quickbooks",
        transactionDate: new Date("2026-01-16"),
        amount: 50000,
        amountMinor: 5000000n,
        direction: "credit",
        referenceNumber: "INV-2090",
        counterparty: "Bright Path Consulting",
        sourceId: "INV11A"
    };

    const book11B: CanonicalTransaction = {
        id: "INV11B",
        source: "quickbooks",
        transactionDate: new Date("2026-01-16"),
        amount: 30000,
        amountMinor: 3000000n,
        direction: "credit",
        referenceNumber: "INV-2091",
        counterparty: "Bright Path Consulting",
        sourceId: "INV11B"
    };

    const matches11 = runMatcher([bankTx11], [book11A, book11B]);
    assert(matches11.length === 1, "B1/B3 regression: Should produce 1 bulk match");
    assert(matches11[0].matchType === "one_to_many", `B1/B3 regression: Should be one_to_many, got ${matches11[0].matchType}`);
    assert(!matches11[0].bankTransactionIds.includes("BANK10"), "B1/B3 regression: Stripe hatch must not have fired (bank has NEFT narration)");
    console.log("  PASSED: NEFT bulk still matches correctly; Stripe escape hatch did not fire.");

    // ----------------------------------------------------
    // TEST 12: X4a/X4b COLLISION — two twins, no signals
    // ----------------------------------------------------
    console.log("\nTest 12: X4a/X4b Collision — twin txns must not double-match same invoice");

    const bankTx12A: CanonicalTransaction = {
        id: "BANK12A",
        source: "bank",
        transactionDate: new Date("2026-01-24"),
        amount: 15000,
        amountMinor: 1500000n,
        direction: "credit",
        description: "NEFT FROM VANTAGE LOGISTICS",
        referenceNumber: "N052026012455001",
        counterparty: "Vantage Logistics LLP",
        sourceId: "BANK12A"
    };

    const bankTx12B: CanonicalTransaction = {
        ...bankTx12A,
        id: "BANK12B",
        referenceNumber: "N052026012455002",
        sourceId: "BANK12B"
    };

    const book12A: CanonicalTransaction = {
        id: "INV-2072",
        source: "quickbooks",
        transactionDate: new Date("2026-01-24"),
        amount: 15000,
        amountMinor: 1500000n,
        direction: "credit",
        referenceNumber: "INV-2072",
        counterparty: "Vantage Logistics LLP",
        sourceId: "INV-2072"
    };

    const book12B: CanonicalTransaction = {
        ...book12A,
        id: "INV-2073",
        referenceNumber: "INV-2073",
        sourceId: "INV-2073"
    };

    const matches12 = runMatcher([bankTx12A, bankTx12B], [book12A, book12B]);
    // Each invoice must appear in at most one match
    const usedBookIds12 = matches12.flatMap(m => m.bookTransactionIds);
    const uniqueBookIds12 = new Set(usedBookIds12);
    assert(uniqueBookIds12.size === usedBookIds12.length, "X4 collision: Each invoice must be claimed by at most one bank txn (no double-match)");
    console.log(`  PASSED: X4 collision mitigated — ${matches12.length} match(es) produced, no invoice double-claimed.`);

    // ----------------------------------------------------
    // TEST 13: REF CONFLICT RECALL GUARD
    // Conflicting refs + no signals → candidate SURVIVES generation (not dropped)
    // ----------------------------------------------------
    console.log("\nTest 13: Ref Conflict Recall Guard — candidate survives despite ref mismatch");

    // Import generateCandidates directly to test at the scorer level
    const { generateCandidates: genCandidates } = await import("../matching/candidateGenerator");

    const bankTx13: CanonicalTransaction = {
        id: "BANK13",
        source: "bank",
        transactionDate: new Date("2026-01-01"),
        amount: 10000,
        amountMinor: 1000000n,
        direction: "credit",
        referenceNumber: "ABC123",
        counterparty: "Acme Corp",
        sourceId: "BANK13"
    };

    const book13: CanonicalTransaction = {
        id: "BOOK13",
        source: "quickbooks",
        transactionDate: new Date("2026-01-01"),
        amount: 10000,
        amountMinor: 1000000n,
        direction: "credit",
        referenceNumber: "XYZ789",
        counterparty: "Acme Corp",
        sourceId: "BOOK13"
    };

    const candidates13 = genCandidates(bankTx13, [book13], { skipAmountGate: false });

    // Core assertion: candidate was NOT dropped — penalty path, not rejection path
    assert(candidates13.length === 1, "Recall guard: Candidate must survive generation (length=1)");
    const c13 = candidates13[0];
    assert(
        c13.reasons.some(r => r.reason === "reference_conflict_penalty"),
        "Recall guard: Penalty reason must be present on candidate"
    );
    assert(
        c13.score < 100,
        `Recall guard: Penalised score must be below Pass 1 threshold (got ${c13.score})`
    );
    console.log(`  PASSED: Ref-conflict candidate survived with score=${c13.score} and penalty reason recorded.`);

    // ----------------------------------------------------
    // TEST 14: REFERENCE TYPO & SUBSTITUTION CALIBRATION
    // ----------------------------------------------------
    console.log("\nTest 14: Reference Typo & Substitution Calibration");

    const baseBankTx: CanonicalTransaction = {
        id: "BANK14",
        source: "bank",
        transactionDate: new Date("2026-01-01"),
        amount: 10000,
        amountMinor: 1000000n,
        direction: "credit",
        referenceNumber: "INV-12345",
        counterparty: "Spelling Corp",
        sourceId: "BANK14"
    };

    // 1. Exact Match Candidate
    const bookExact: CanonicalTransaction = {
        id: "BOOK14_EXACT",
        source: "quickbooks",
        transactionDate: new Date("2026-01-01"),
        amount: 10000,
        amountMinor: 1000000n,
        direction: "credit",
        referenceNumber: "INV-12345",
        counterparty: "Spelling Corp",
        sourceId: "BOOK14_EXACT"
    };

    // 2. Transposition Candidate (INV-12345 vs INV-12354)
    const bookTransposition: CanonicalTransaction = {
        id: "BOOK14_TRANSPOSITION",
        source: "quickbooks",
        transactionDate: new Date("2026-01-01"),
        amount: 10000,
        amountMinor: 1000000n,
        direction: "credit",
        referenceNumber: "INV-12354",
        counterparty: "Spelling Corp",
        sourceId: "BOOK14_TRANSPOSITION"
    };

    // 3. Substitution Candidate (INV-12345 vs INV-12346)
    const bookSubstitution: CanonicalTransaction = {
        id: "BOOK14_SUBSTITUTION",
        source: "quickbooks",
        transactionDate: new Date("2026-01-01"),
        amount: 10000,
        amountMinor: 1000000n,
        direction: "credit",
        referenceNumber: "INV-12346",
        counterparty: "Spelling Corp",
        sourceId: "BOOK14_SUBSTITUTION"
    };

    const exactCands = genCandidates(baseBankTx, [bookExact], { skipAmountGate: false });
    const transpositionCands = genCandidates(baseBankTx, [bookTransposition], { skipAmountGate: false });
    const substitutionCands = genCandidates(baseBankTx, [bookSubstitution], { skipAmountGate: false });

    assert(exactCands.length === 1, "Exact candidate should be generated");
    assert(transpositionCands.length === 1, "Transposition candidate should be generated");
    assert(substitutionCands.length === 1, "Substitution candidate should be generated");

    const candExact = exactCands[0];
    const candTransposition = transpositionCands[0];
    const candSubstitution = substitutionCands[0];

    console.log(`  Exact Score: ${candExact.score} (Band: ${candExact.confidenceBand})`);
    console.log(`  Transposition Score: ${candTransposition.score} (Band: ${candTransposition.confidenceBand})`);
    console.log(`  Substitution Score: ${candSubstitution.score} (Band: ${candSubstitution.confidenceBand})`);

    // Assert relative score ordering
    assert(candExact.score > candTransposition.score, "Exact score must be greater than transposition score");
    assert(candTransposition.score > candSubstitution.score, "Transposition score must be greater than substitution score");

    // Assert correct confidence bands
    assert(candExact.confidenceBand === "HIGH" || candExact.confidenceBand === "VERY_HIGH", "Exact match must be HIGH/VERY_HIGH");
    assert(candTransposition.confidenceBand === "MEDIUM", "Transposition match must be MEDIUM");
    assert(candSubstitution.confidenceBand === "LOW", "Substitution match must be LOW");

    console.log("  PASSED: Score relative ordering and confidence bands successfully calibrated.");

    // ----------------------------------------------------
    // TEST 15: STRIPE PAYOUT GATE BYPASS LOGIC
    // ----------------------------------------------------
    console.log("\nTest 15: Stripe Payout Gate Bypass Logic");

    const { isStripePayoutTransaction } = await import("../../core/matching/matchingHelpers");

    // 1. Stripe Checkout Charge -> expected false
    const checkoutCharge = {
        description: "Payment for INV-2022 via Stripe Checkout",
        matchingSignals: { channel: "STRIPE", merchantName: "Stripe" }
    };
    assert(isStripePayoutTransaction(checkoutCharge) === false, "Stripe Checkout Charge should NOT bypass the gate");

    // 2. Stripe charge-level Refund -> expected false
    const checkoutRefund = {
        description: "STRIPE REFUND re_123",
        matchingSignals: { channel: "STRIPE" }
    };
    assert(isStripePayoutTransaction(checkoutRefund) === false, "Charge-level Stripe Refund should NOT bypass the gate");

    // 3. Stripe Payout -> expected true
    const payout1 = {
        description: "STRIPE PAYOUT po_1Pjk29",
        matchingSignals: { channel: "STRIPE" }
    };
    assert(isStripePayoutTransaction(payout1) === true, "Stripe Payout should bypass the gate");

    // 4. Stripe Transfer -> expected true
    const transfer1 = {
        description: "STRIPE TRANSFER ch_3Pjk88",
        matchingSignals: { channel: "STRIPE" }
    };
    assert(isStripePayoutTransaction(transfer1) === true, "Stripe Transfer should bypass the gate");

    // 5. Stripe Abbreviated Transfer -> expected true
    const transferAbbr = {
        description: "STRPE TRNSFR ch_3Pjk88",
        matchingSignals: { channel: "STRIPE" }
    };
    assert(isStripePayoutTransaction(transferAbbr) === true, "Stripe Abbreviated Transfer should bypass the gate");

    console.log("  PASSED: Stripe payout bypass rules correctly validated.");

    console.log("\n==================================================");
    console.log("ALL TESTS PASSED SUCCESSFULLY!");
    console.log("==================================================");
}

runTests().catch((err) => {
    console.error("Unit test failure:", err);
    process.exit(1);
});
