import { detectColumns } from "../../services/mapping/column-detector";
import { generateCandidates } from "../../core/matching/candidateGenerator";
import type { BankTransaction, LedgerEntry } from "../../core/matching/engine";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ Test Failure: ${message}`);
    process.exit(1);
  }
}

console.log("\n==================================================");
console.log("RUNNING RECONFLOW IMPROVEMENTS VERIFICATION TESTS");
console.log("==================================================\n");

// ----------------------------------------------------
// Test 1: Column Detection Heuristics & Fallback Guards
// ----------------------------------------------------
console.log("Running Test 1: Column Detection Heuristics...");
const headers = ["Transaction Type", "Txn Date", "Reference Number", "Dr/Cr", "Narration", "UTR Number", "Invoice No"];
const detected = detectColumns(headers);

// Verify Txn Date -> Date
assert(detected.date === "Txn Date", `Expected Date to map to "Txn Date", got "${detected.date}"`);

// Verify Transaction Type did NOT overwrite Date or Direction
assert(detected.date !== "Transaction Type", "Transaction Type should not be matched as Date Column");
assert(detected.direction === "Dr/Cr", `Expected Direction to map to "Dr/Cr", got "${detected.direction}"`);

// Verify advanced columns are mapped
assert(detected.utr === "UTR Number", `Expected UTR to map to "UTR Number", got "${detected.utr}"`);
assert(detected.invoiceNumber === "Invoice No", `Expected Invoice Number to map to "Invoice No", got "${detected.invoiceNumber}"`);

// Verify fallback description guard (Issue 8)
// If headers only contain "Customer Name" or "Vendor Name", description should remain empty (not map to them)
const headersWithCounterpartyOnly = ["Txn Date", "Customer Name", "Vendor Name", "Party Name"];
const detectedWithCounterparty = detectColumns(headersWithCounterpartyOnly);
assert(detectedWithCounterparty.description === "", `Expected description fallback to remain empty when only counterparty fields are present, got "${detectedWithCounterparty.description}"`);

console.log("✅ Test 1 Passed: Column detection and fallback heuristics are correct.\n");

// ----------------------------------------------------
// Test 2: Case-Insensitive & Format-Tolerant UTR Matches (Issue 4)
// ----------------------------------------------------
console.log("Running Test 2: Normalized UTR Matching...");
const bankUtrTxn: BankTransaction = {
  id: "bank-utr",
  amount: 10000,
  date: new Date("2026-01-10"),
  description: "Utr test",
  referenceId: "",
  direction: "outflow",
  currency: "INR",
  matchingSignals: { utr: "UTR-123-abc" },
};

const bookUtrTxns: LedgerEntry[] = [
  {
    id: "book-utr-match",
    amount: 10000,
    date: new Date("2026-01-10"),
    memo: "Utr test",
    invoiceRef: "",
    direction: "outflow",
    currency: "INR",
    matchingSignals: { utr: " utr123ABC " }, // mismatched case, spaces, and separators
  },
];

const resUtr = generateCandidates(bankUtrTxn, bookUtrTxns);
assert(resUtr.length === 1, "Expected UTR candidate to be generated");
assert(resUtr[0].reasons.some(r => r.reason === "utr_match"), "Expected UTR match reason to be populated");
console.log("✅ Test 2 Passed: Case-insensitive and format-tolerant UTR matching verified.\n");

// ----------------------------------------------------
// Test 3: Case-Insensitive & Format-Tolerant Invoice Matches (Issue 5)
// ----------------------------------------------------
console.log("Running Test 3: Normalized Invoice Matching...");
const bankInvTxn: BankTransaction = {
  id: "bank-inv",
  amount: 20000,
  date: new Date("2026-01-10"),
  description: "Inv test",
  referenceId: "",
  direction: "inflow",
  currency: "INR",
  matchingSignals: { invoiceNumber: "INV-1001" },
};

const bookInvTxns: LedgerEntry[] = [
  {
    id: "book-inv-match",
    amount: 20000,
    date: new Date("2026-01-10"),
    memo: "Inv test",
    invoiceRef: "",
    direction: "inflow",
    currency: "INR",
    matchingSignals: { invoiceNumber: "inv1001" }, // different casing and hyphen
  },
];

const resInv = generateCandidates(bankInvTxn, bookInvTxns);
assert(resInv.length === 1, "Expected Invoice candidate to be generated");
assert(resInv[0].reasons.some(r => r.reason === "invoice_match"), "Expected Invoice match reason to be populated");
console.log("✅ Test 3 Passed: Case-insensitive and format-tolerant Invoice matching verified.\n");

// ----------------------------------------------------
// Test 4: Case-Insensitive & Format-Tolerant Voucher Matches (Issue 6)
// ----------------------------------------------------
console.log("Running Test 4: Normalized Voucher Matching...");
const bankVchTxn: BankTransaction = {
  id: "bank-vch",
  amount: 30000,
  date: new Date("2026-01-10"),
  description: "Voucher test",
  referenceId: "",
  direction: "outflow",
  currency: "INR",
  matchingSignals: { voucherNumber: "VCH-202" },
};

const bookVchTxns: LedgerEntry[] = [
  {
    id: "book-vch-match",
    amount: 30000,
    date: new Date("2026-01-10"),
    memo: "Voucher test",
    invoiceRef: "",
    direction: "outflow",
    currency: "INR",
    matchingSignals: { voucherNumber: "vch202" },
  },
];

const resVch = generateCandidates(bankVchTxn, bookVchTxns);
assert(resVch.length === 1, "Expected Voucher candidate to be generated");
assert(resVch[0].reasons.some(r => r.reason === "voucher_match"), "Expected Voucher match reason to be populated");
console.log("✅ Test 4 Passed: Case-insensitive and format-tolerant Voucher matching verified.\n");

// ----------------------------------------------------
// Test 5: Case-Insensitive & Format-Tolerant Related ID Matches (Issue 7)
// ----------------------------------------------------
console.log("Running Test 5: Normalized Related ID Matching...");
const bankRelTxn: BankTransaction = {
  id: "bank-rel",
  amount: 40000,
  date: new Date("2026-01-10"),
  description: "Related txn test",
  referenceId: "",
  direction: "inflow",
  currency: "INR",
  matchingSignals: { relatedTransactionId: "ch_ABC123" },
};

const bookRelTxns: LedgerEntry[] = [
  {
    id: "book-rel-match",
    amount: 40000,
    date: new Date("2026-01-10"),
    memo: "Related txn test",
    invoiceRef: "",
    direction: "inflow",
    currency: "INR",
    matchingSignals: { relatedTransactionId: "CH_ABC123" },
  },
];

const resRel = generateCandidates(bankRelTxn, bookRelTxns);
assert(resRel.length === 1, "Expected Related ID candidate to be generated");
assert(resRel[0].reasons.some(r => r.reason === "related_id_match"), "Expected Related ID match reason to be populated");
console.log("✅ Test 5 Passed: Case-insensitive Related Transaction ID matching verified.\n");

// ----------------------------------------------------
// Test 6: Case-Insensitive & Space-Trimmed Channel Matches (Issue 3)
// ----------------------------------------------------
console.log("Running Test 6: Normalized Channel Matching...");
const bankChanTxn: BankTransaction = {
  id: "bank-chan",
  amount: 15000,
  date: new Date("2026-01-10"),
  description: "Channel test",
  referenceId: "",
  direction: "outflow",
  currency: "INR",
  matchingSignals: { channel: "UPI" },
};

const bookChanTxns: LedgerEntry[] = [
  {
    id: "book-chan-match",
    amount: 15000,
    date: new Date("2026-01-10"),
    memo: "Channel test",
    invoiceRef: "",
    direction: "outflow",
    currency: "INR",
    matchingSignals: { channel: "  upi " },
  },
];

const resChan = generateCandidates(bankChanTxn, bookChanTxns);
assert(resChan.length === 1, "Expected Channel candidate to be generated");
assert(resChan[0].reasons.some(r => r.reason === "channel_match"), "Expected Channel match reason to be populated");
console.log("✅ Test 6 Passed: Case-insensitive and trimmed Channel matching verified.\n");

// ----------------------------------------------------
// Test 7: Mismatch Safeguards (Customer/Vendor/Merchant)
// ----------------------------------------------------
console.log("Running Test 7: Mismatch Safeguards...");
const bankMismatchTxn: BankTransaction = {
  id: "bank-mismatch",
  amount: 10000,
  date: new Date("2026-01-10"),
  description: "Mismatch test",
  referenceId: "",
  direction: "outflow",
  currency: "INR",
  matchingSignals: {
    customerName: "Acme Corp",
    vendorName: "Delta Suppliers",
    merchantName: "Stripe",
  },
};

const bookMismatchTxns: LedgerEntry[] = [
  {
    id: "book-mismatch",
    amount: 10000,
    date: new Date("2026-01-10"),
    memo: "Mismatch test",
    invoiceRef: "",
    direction: "outflow",
    currency: "INR",
    matchingSignals: {
      customerName: "Beta Corp", // Mismatched
      vendorName: "Gamma Suppliers", // Mismatched
      merchantName: "Razorpay", // Mismatched
    },
  },
];

const resMismatch = generateCandidates(bankMismatchTxn, bookMismatchTxns);
assert(resMismatch.length === 1, "Expected candidate to be generated");
const mismatchReasons = resMismatch[0].reasons.map(r => r.reason);
assert(!mismatchReasons.includes("customer_name_match"), "Should not match different customer names");
assert(!mismatchReasons.includes("vendor_name_match"), "Should not match different vendor names");
assert(!mismatchReasons.includes("merchant_name_match"), "Should not match different merchant names");
console.log("✅ Test 7 Passed: Mismatched optional signals do not get scoring boosts.\n");

// ----------------------------------------------------
// Test 8: Multiple Simultaneous Signals (Most Important Missing Test)
// ----------------------------------------------------
console.log("Running Test 8: Simultaneous Signal Integration...");
const bankMultiTxn: BankTransaction = {
  id: "bank-multi",
  amount: 80000,
  date: new Date("2026-01-10"), // Day diff = 0 -> date_match = 30 points
  description: "Payment transfer UPI",
  referenceId: "",
  direction: "inflow",
  currency: "INR",
  matchingSignals: {
    utr: "UTR999888777",
    relatedTransactionId: "ch_MultiTxn123",
    invoiceNumber: "INV-2060",
    voucherNumber: "VCH-777",
    customerName: "Bluepeak Enterprises Pvt Ltd",
    channel: "UPI",
  },
};

const bookMultiTxns: LedgerEntry[] = [
  {
    id: "book-multi-match",
    amount: 80000, // exact amount -> amount_match = 50 points
    date: new Date("2026-01-10"),
    memo: "Services for Bluepeak",
    invoiceRef: "",
    direction: "inflow",
    currency: "INR",
    matchingSignals: {
      utr: "UTR999888777", // +100 UTR match
      relatedTransactionId: "ch_MultiTxn123", // +80 Related ID match
      invoiceNumber: "INV-2060", // +80 Invoice match
      voucherNumber: "VCH-777", // +80 Voucher match
      customerName: "Bluepeak Enterprises", // +15 customer_name_match
      channel: "UPI", // +10 channel_match
    },
  },
];

const resMulti = generateCandidates(bankMultiTxn, bookMultiTxns);
assert(resMulti.length === 1, "Expected candidate to be generated");

const score = resMulti[0].score;
// Expected breakdown:
// - amount_match: 50
// - date_match: 30
// - utr_match: 100
// - related_id_match: 80
// - invoice_match: 80
// - voucher_match: 80
// - customer_name_match: 15
// - channel_match: 10
// Total expected score = 50 + 30 + 100 + 80 + 80 + 80 + 15 + 10 = 445.
assert(score === 445, `Expected simultaneous signal score to be 445, got ${score}`);
console.log(`✅ Test 8 Passed: Simultaneous UTR + Related ID + Invoice + Voucher + CustomerName + Channel matches score verified successfully at ${score}.\n`);

// ----------------------------------------------------
// Test 9: Confidence Band Transitions
// ----------------------------------------------------
console.log("Running Test 9: Confidence Band Transitions...");
const bankBandTxn: BankTransaction = {
  id: "bank-band",
  amount: 50000,
  date: new Date("2026-01-10"),
  description: "Test",
  referenceId: "",
  direction: "outflow",
  currency: "INR",
  matchingSignals: { utr: "UTR-CONF-BAND-TEST" },
};

// 1. High Confidence (Score >= 150 -> VERY_HIGH band)
const bookHigh: LedgerEntry = {
  id: "book-high",
  amount: 50000,
  date: new Date("2026-01-10"), // Amount + Date + UTR = 50 + 30 + 100 = 180 -> VERY_HIGH band
  memo: "Test",
  invoiceRef: "",
  direction: "outflow",
  currency: "INR",
  matchingSignals: { utr: "UTR-CONF-BAND-TEST" },
};

// 2. Medium Confidence (Score between 70 and 129 -> MEDIUM band)
const bookMedium: LedgerEntry = {
  id: "book-med",
  amount: 50000,
  date: new Date("2026-01-12"), // 2 days difference -> date points = 24. Total score = 50 + 24 = 74
  memo: "Test",
  invoiceRef: "",
  direction: "outflow",
  currency: "INR",
  matchingSignals: {},
};

// 3. Low Confidence (Score < 70 -> LOW band)
const bookLow: LedgerEntry = {
  id: "book-low",
  amount: 45000, // 10% amount difference -> amount points = 25. Date points = 24. Total score = 25 + 24 = 49
  date: new Date("2026-01-12"),
  memo: "Test",
  invoiceRef: "",
  direction: "outflow",
  currency: "INR",
  matchingSignals: {},
};

const resBands = generateCandidates(bankBandTxn, [bookHigh, bookMedium, bookLow]);
assert(resBands.length === 3, "Expected 3 candidates");

const cHigh = resBands.find(c => c.candidate.id === "book-high")!;
const cMed = resBands.find(c => c.candidate.id === "book-med")!;
const cLow = resBands.find(c => c.candidate.id === "book-low")!;

assert(cHigh.confidenceBand === "VERY_HIGH" || cHigh.confidenceBand === "HIGH", `Expected High confidence band for book-high (Score: ${cHigh.score}), got ${cHigh.confidenceBand}`);
assert(cMed.confidenceBand === "MEDIUM", `Expected MEDIUM confidence band for book-med (Score: ${cMed.score}), got ${cMed.confidenceBand}`);
assert(cLow.confidenceBand === "LOW", `Expected LOW confidence band for book-low (Score: ${cLow.score}), got ${cLow.confidenceBand}`);
console.log("✅ Test 9 Passed: Confidence band transitions mapped correctly.\n");

console.log("🎉 ALL EXTENSIVE RECONFLOW VERIFICATION TESTS PASSED SUCCESSFULLY!\n");
