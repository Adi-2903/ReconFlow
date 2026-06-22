// TestingFolder/tests/classifier.test.ts
import { classifyMatch } from "../../core/matching/classifier";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runClassifierTests() {
  console.log("==================================================");
  console.log("RUNNING CLASSIFIER ENGINE UNIT TESTS");
  console.log("==================================================\n");

  // 1. EXACT_MATCH TEST
  console.log("Test 1: Exact Match (No discrepancy)");
  const exactBank = {
    amount: 100000, // ₹1,000 in paise
    date: new Date("2026-03-01T12:00:00Z"),
    description: "NEFT FROM CUSTOMER A",
    referenceId: "INV-1001",
    counterparty: "Customer A",
    currency: "INR",
  };
  const exactLedger = {
    amount: 100000,
    date: new Date("2026-03-01T12:00:00Z"),
    memo: "Invoice INV-1001 payment",
    invoiceRef: "INV-1001",
    counterparty: "Customer A",
    currency: "INR",
  };
  const res1 = classifyMatch(exactBank, [exactLedger], "exact", [{ reason: "exact_match", points: 100 }]);
  assert(res1.matchOutcome === "MATCHED", "Should be MATCHED");
  assert(res1.discrepancyType === "NONE", "Should have no discrepancy (NONE)");
  assert(res1.confidenceBand === "HIGH", "Band should be HIGH");
  assert(res1.evidence.some(e => e.code === "FX_CONVERSION_STABLE"), "Evidence should include clean match");
  console.log("  PASSED: Clean exact match classified.");

  // 2. TIMING_DIFFERENCE TEST
  console.log("\nTest 2: Timing Difference (Date delay > 1 day)");
  const timingBank = {
    ...exactBank,
    date: new Date("2026-03-05T12:00:00Z"), // 4 days later
  };
  const res2 = classifyMatch(timingBank, [exactLedger], "tolerance", [{ reason: "amount_match", points: 50 }, { reason: "date_match", points: 10 }]);
  assert(res2.matchOutcome === "MATCHED", "Should be MATCHED");
  assert(res2.discrepancyType === "TIMING_DIFFERENCE", "Should be TIMING_DIFFERENCE");
  assert(res2.evidence.some(e => e.code === "TIMING_LAG_DETECTED"), "Should log timing lag evidence");
  console.log("  PASSED: Timing difference classified.");

  // 3. PROCESSING_FEE TEST (Stripe payout)
  console.log("\nTest 3: Processing Fee (Stripe fee check)");
  const feeBank = {
    amount: 94600, // ₹946 (₹1,000 minus 2.9% + Rs.25 Stripe fee = ₹946)
    date: new Date("2026-03-01T12:00:00Z"),
    description: "STRIPE PAYOUT po_99",
    referenceId: "po_99",
    counterparty: "Stripe",
    currency: "INR",
  };
  const feeLedger = {
    amount: 100000, // ₹1,000 gross
    date: new Date("2026-03-01T12:00:00Z"),
    memo: "Invoice INV-1002 payment",
    invoiceRef: "INV-1002",
    counterparty: "Stripe",
    currency: "INR",
  };
  const res3 = classifyMatch(feeBank, [feeLedger], "fee_adjustment", [{ reason: "fee_match_validated", points: 70 }]);
  assert(res3.matchOutcome === "MATCHED", "Should be MATCHED");
  assert(res3.discrepancyType === "PROCESSING_FEE", "Should be PROCESSING_FEE");
  assert(res3.evidence.some(e => e.code === "STRIPE_FEE_FORMULA"), "Should log Stripe fee formula code");
  console.log("  PASSED: Processing fee classified.");

  // 4. FOREIGN_EXCHANGE TEST
  console.log("\nTest 4: Foreign Exchange conversion variance (abs diff <= 100 paise)");
  const fxBank = {
    amount: 8300, // $83.00
    date: new Date("2026-03-01T12:00:00Z"),
    description: "INWARD REMITTANCE USD",
    referenceId: "FC-88",
    counterparty: "Foreign Client",
    currency: "USD",
    baseCurrency: "INR",
    convertedAmountMinor: 689000, // $83 converted to INR 6,890.00
  };
  const fxLedger = {
    amount: 689050, // Booked at INR 6,890.50 (50 paise difference)
    date: new Date("2026-03-01T12:00:00Z"),
    memo: "Invoice INV-1003",
    invoiceRef: "INV-1003",
    counterparty: "Foreign Client",
    currency: "INR",
    baseCurrency: "INR",
    convertedAmountMinor: 689050,
  };
  const res4 = classifyMatch(fxBank, [fxLedger], "fx_difference", [{ reason: "fx_difference_validated", points: 80 }]);
  assert(res4.matchOutcome === "MATCHED", "Should be MATCHED");
  assert(res4.discrepancyType === "FOREIGN_EXCHANGE", "Should be FOREIGN_EXCHANGE");
  assert(res4.evidence.some(e => e.code === "FX_CONVERSION_STABLE"), "Should log FX conversion code");
  console.log("  PASSED: Foreign exchange rate discrepancy classified.");

  // 5. TYPO TEST
  console.log("\nTest 5: Typo check (Reference transposition and name spelling typo)");
  const typoBank = {
    amount: 100000,
    date: new Date("2026-03-01T12:00:00Z"),
    description: "NEFT FROM CUSTOMER A",
    referenceId: "INV-1010", // book reference has INV-1001 (digit difference)
    counterparty: "Customeer A", // name typo (Customeer vs Customer)
    currency: "INR",
  };
  const typoLedger = {
    amount: 100000,
    date: new Date("2026-03-01T12:00:00Z"),
    memo: "Invoice INV-1001",
    invoiceRef: "INV-1001",
    counterparty: "Customer A",
    currency: "INR",
  };
  const res5 = classifyMatch(typoBank, [typoLedger], "near", [{ reason: "amount_match", points: 50 }]);
  assert(res5.matchOutcome === "MATCHED", "Should be MATCHED");
  assert(res5.discrepancyType === "TYPO", "Should be TYPO");
  assert(res5.evidence.some(e => e.code === "NAME_SPELLING_TYPO"), "Should log name spelling typo evidence");
  console.log("  PASSED: Typo exceptions classified.");

  // 6. DUPLICATE TEST
  console.log("\nTest 6: Duplicate Payment received");
  const dupBank = {
    amount: 50000,
    date: new Date("2026-03-01T12:00:00Z"),
    description: "NEFT DUP PAYMENT INV-20",
    referenceId: "INV-20",
    counterparty: "Customer B",
  };
  const res6 = classifyMatch(dupBank, [], "none", [], []);
  assert(res6.matchOutcome === "UNMATCHED", "Should be UNMATCHED");
  assert(res6.discrepancyType === "DUPLICATE", "Should be DUPLICATE due to duplicate text");
  assert(res6.confidenceBand === "VERY_HIGH", "Duplicate flag confidence should be high");
  assert(res6.evidence.some(e => e.code === "DUPLICATE_PAYMENT_ROW"), "Should log duplicate payment code");
  console.log("  PASSED: Duplicate payment row classified.");

  // 7. MISSING_ENTRY TEST
  console.log("\nTest 7: Missing Invoice reference in books");
  const missingBank = {
    amount: 25000,
    date: new Date("2026-03-01T12:00:00Z"),
    description: "PAYMENT FOR INV-9009",
    referenceId: "INV-9009",
    counterparty: "Customer C",
  };
  const res7 = classifyMatch(missingBank, [], "none", [], []);
  assert(res7.matchOutcome === "UNMATCHED", "Should be UNMATCHED");
  assert(res7.discrepancyType === "MISSING_ENTRY", "Should be MISSING_ENTRY");
  assert(res7.evidence.some(e => e.code === "MISSING_INVOICE_REF"), "Should log missing invoice code");
  console.log("  PASSED: Missing entry classified.");

  console.log("\n==================================================");
  console.log("ALL CLASSIFIER TESTS PASSED SUCCESSFULLY!");
  console.log("==================================================");
}

runClassifierTests().catch((err) => {
  console.error("Classifier unit test failure:", err);
  process.exit(1);
});
