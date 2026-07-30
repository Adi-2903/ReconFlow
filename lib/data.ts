import { MatchData } from "@/types/match";

// ─── Shared Demo Data ────────────────────────────────────────────────────────
// Realistic mock transactions for demo mode.
// Covers: exact matches, fuzzy/fee matches, bulk settlements, timing delays,
// partial payments, FX conversions, refund mismatches, and unmatched items.

export const sharedMatches: MatchData[] = [
  // ─── 1. Clean exact match — Stripe payout ───
  {
    id: "m_1",
    bankRow: { amount: 15000, date: "10 Oct 2024", description: "STRIPE PAYMENTS", referenceId: "STR-001", source: "bank" },
    ledgerRow: { amount: 15000, memo: "Invoice #1001 — Acme Corp", invoiceRef: "INV-1001" },
    confidenceScore: 1.0,
    matchType: "exact",
    matchOutcome: "MATCHED",
    discrepancyType: "NONE",
    evidenceList: [{ code: "MATCHED_EXACT_CLEAN", message: "Clean exact match on amount ₹15,000 and date." }],
    reasonText: "Exact match on amount and date. Stripe reference STR-001 maps to Invoice #1001.",
    riskScore: 5,
    status: "approved",
  },
  // ─── 2. Timing delay — late customer payment ───
  {
    id: "m_2",
    bankRow: { amount: 8000, date: "15 Dec 2024", description: "NEFT-GLOBALTECH SOLUTIONS", referenceId: "NEFT-44821", source: "bank" },
    ledgerRow: { amount: 8000, memo: "Invoice #1002 — GlobalTech", invoiceRef: "INV-1002" },
    confidenceScore: 0.92,
    matchType: "exact",
    matchOutcome: "MATCHED",
    discrepancyType: "TIMING_DIFFERENCE",
    evidenceList: [
      { code: "TIMING_LAG_DETECTED", message: "Amount matches perfectly, but payment arrived 45 days after invoice date." },
      { code: "CUSTOMER_NAME_MATCH", message: "\"GLOBALTECH SOLUTIONS\" matches ledger customer \"GlobalTech\"." },
    ],
    reasonText: "Amount matches perfectly. 45-day payment delay identified. Customer name confirmed via fuzzy text match (93% similarity).",
    riskScore: 38,
    status: "approved",
  },
  // ─── 3. Processing fee — Stripe net payout ───
  {
    id: "m_3",
    bankRow: { amount: 9768, date: "12 Oct 2024", description: "STRIPE PAYOUT", referenceId: "STR-003", source: "bank" },
    ledgerRow: { amount: 10000, memo: "Invoice #1003 — TechStart Inc", invoiceRef: "INV-1003" },
    confidenceScore: 0.96,
    matchType: "fuzzy",
    matchOutcome: "MATCHED",
    discrepancyType: "PROCESSING_FEE",
    evidenceList: [
      { code: "STRIPE_FEE_FORMULA", message: "Discrepancy of ₹232.00 matches Stripe fee (2% + ₹32)." },
      { code: "AMOUNT_WITHIN_TOLERANCE", message: "Net amount after fee deduction: ₹9,768." },
    ],
    reasonText: "AI identified a ₹232.00 processing fee (Stripe 2% + ₹32 formula). Invoice gross ₹10,000 → bank net ₹9,768.",
    riskScore: 18,
    status: "pending",
  },
  // ─── 4. Bulk settlement — Amazon 3-order batch ───
  {
    id: "m_4",
    bankRow: { amount: 35000, date: "13 Oct 2024", description: "AMAZON SETTLEMENT", referenceId: "AMZ-SETTLE-Q4", source: "bank" },
    ledgerRow: null,
    ledgerRows: [
      { amount: 10000, memo: "Order #A-7741", invoiceRef: "ORD-A-7741" },
      { amount: 15000, memo: "Order #A-7742", invoiceRef: "ORD-A-7742" },
      { amount: 10000, memo: "Order #A-7743", invoiceRef: "ORD-A-7743" },
    ],
    confidenceScore: 0.99,
    matchType: "bulk",
    matchOutcome: "MATCHED",
    discrepancyType: "NONE",
    evidenceList: [
      { code: "MATCHED_EXACT_CLEAN", message: "Sum of 3 ledger orders (₹10k + ₹15k + ₹10k) = ₹35,000 matches bank deposit exactly." },
      { code: "SETTLEMENT_BATCH", message: "Amazon weekly settlement batch detected." },
    ],
    reasonText: "3 Amazon orders aggregated into a single settlement. Sum ₹35,000 matches bank deposit exactly.",
    riskScore: 8,
    status: "approved",
  },
  // ─── 5. Critical mismatch — direction reversal ───
  {
    id: "m_5",
    bankRow: { amount: 4500, date: "14 Oct 2024", description: "VENDOR REFUND — TECHSUPPLY", referenceId: "REF-005", source: "bank" },
    ledgerRow: { amount: 4500, memo: "Bill Payment — TechSupply Co", invoiceRef: "BILL-005" },
    confidenceScore: 0.25,
    matchType: "none",
    matchOutcome: "UNMATCHED",
    discrepancyType: "NONE",
    evidenceList: [
      { code: "DIRECTION_MISMATCH", message: "Bank shows REFUND (credit) but ledger shows BILL PAYMENT (debit). Opposite cash flow directions." },
      { code: "OPERATING_EXPENSE", message: "Critical direction mismatch flagged for manual review." },
    ],
    reasonText: "Amount matches ₹4,500, but AI flagged a critical mismatch: bank shows a REFUND (deposit) while ledger records a BILL PAYMENT (withdrawal). Opposite cash flow directions require manual investigation.",
    riskScore: 85,
    status: "pending",
  },
  // ─── 6. Partial payment — customer paid in installments ───
  {
    id: "m_6",
    bankRow: { amount: 25000, date: "18 Oct 2024", description: "IMPS-NEXWAVE DIGITAL", referenceId: "IMPS-98432", source: "bank" },
    ledgerRow: { amount: 50000, memo: "Invoice #1006 — NexWave Digital (50% advance)", invoiceRef: "INV-1006" },
    confidenceScore: 0.88,
    matchType: "fuzzy",
    matchOutcome: "MATCHED",
    discrepancyType: "PARTIAL_PAYMENT",
    evidenceList: [
      { code: "PARTIAL_PAYMENT_DETECTED", message: "Bank amount ₹25,000 is exactly 50% of invoice total ₹50,000." },
      { code: "CUSTOMER_NAME_MATCH", message: "\"NEXWAVE DIGITAL\" matches ledger customer." },
    ],
    reasonText: "Partial payment detected: ₹25,000 received is exactly 50% of ₹50,000 invoice. Memo confirms '50% advance'. Remaining ₹25,000 outstanding.",
    riskScore: 32,
    status: "pending",
  },
  // ─── 7. FX conversion — USD invoice paid in INR ───
  {
    id: "m_7",
    bankRow: { amount: 83450, date: "22 Oct 2024", description: "SWIFT-CLOUDBASE INC", referenceId: "SWIFT-7892", source: "bank" },
    ledgerRow: { amount: 83200, memo: "Invoice #1007 — CloudBase Inc ($1,000 USD)", invoiceRef: "INV-1007" },
    confidenceScore: 0.94,
    matchType: "fuzzy",
    matchOutcome: "MATCHED",
    discrepancyType: "FX_DIFFERENCE",
    evidenceList: [
      { code: "FX_RATE_VARIANCE", message: "₹250 difference attributed to exchange rate fluctuation (booked at 83.20, settled at 83.45)." },
      { code: "WITHIN_FX_TOLERANCE", message: "Variance is 0.3%, within 1% FX tolerance threshold." },
    ],
    reasonText: "USD invoice settled in INR. Exchange rate moved from ₹83.20 (booking) to ₹83.45 (settlement). ₹250 FX gain within configured 1% tolerance.",
    riskScore: 22,
    status: "approved",
  },
  // ─── 8. Duplicate detection — same amount, same day ───
  {
    id: "m_8",
    bankRow: { amount: 12000, date: "25 Oct 2024", description: "NEFT-BRIGHTPATH LABS", referenceId: "NEFT-55123", source: "bank" },
    ledgerRow: { amount: 12000, memo: "Invoice #1008 — BrightPath Labs", invoiceRef: "INV-1008" },
    confidenceScore: 0.78,
    matchType: "exact",
    matchOutcome: "MATCHED",
    discrepancyType: "POTENTIAL_DUPLICATE",
    evidenceList: [
      { code: "DUPLICATE_CANDIDATE", message: "Another transaction of ₹12,000 from the same customer found on the same date." },
      { code: "AMOUNT_DATE_MATCH", message: "Amount and date match perfectly, but duplicate risk flagged." },
    ],
    reasonText: "Exact match found, but AI detected another ₹12,000 payment from BrightPath Labs on the same day. Possible duplicate — requires human verification.",
    riskScore: 55,
    status: "pending",
  },
  // ─── 9. GST TDS deduction — government deduction ───
  {
    id: "m_9",
    bankRow: { amount: 47200, date: "28 Oct 2024", description: "NEFT-INFRA BUILDERS PVT LTD", referenceId: "NEFT-67890", source: "bank" },
    ledgerRow: { amount: 50000, memo: "Invoice #1009 — Infra Builders (₹50k less 2% TDS + 18% GST adj)", invoiceRef: "INV-1009" },
    confidenceScore: 0.91,
    matchType: "fuzzy",
    matchOutcome: "MATCHED",
    discrepancyType: "TAX_DEDUCTION",
    evidenceList: [
      { code: "TDS_DEDUCTION", message: "₹1,000 TDS (2% of ₹50,000) deducted at source." },
      { code: "GST_INPUT_CREDIT", message: "₹1,800 GST adjustment applied." },
    ],
    reasonText: "Invoice ₹50,000 less 2% TDS (₹1,000) and GST input credit adjustment (₹1,800) = ₹47,200 net payment received. Standard Indian business deduction pattern.",
    riskScore: 15,
    status: "approved",
  },
  // ─── 10. Subscription recurring — SaaS charge ───
  {
    id: "m_10",
    bankRow: { amount: 2999, date: "01 Nov 2024", description: "STRIPE SUBSCRIPTION", referenceId: "STR-SUB-044", source: "bank" },
    ledgerRow: { amount: 2999, memo: "Monthly Pro Plan — Customer #044", invoiceRef: "SUB-044-NOV" },
    confidenceScore: 1.0,
    matchType: "exact",
    matchOutcome: "MATCHED",
    discrepancyType: "NONE",
    evidenceList: [{ code: "RECURRING_PATTERN", message: "Matches recurring monthly subscription pattern. 6th consecutive match." }],
    reasonText: "Recurring Stripe subscription ₹2,999/month. 6th consecutive exact match with no variance.",
    riskScore: 3,
    status: "approved",
  },
  // ─── 11. Unmatched bank deposit — no ledger entry ───
  {
    id: "m_11",
    bankRow: { amount: 67500, date: "05 Nov 2024", description: "RTGS-UNKNOWN SENDER", referenceId: "RTGS-MISC-991", source: "bank" },
    ledgerRow: null,
    confidenceScore: 0.0,
    matchType: "none",
    matchOutcome: "UNMATCHED",
    discrepancyType: "NONE",
    evidenceList: [
      { code: "NO_MATCH_FOUND", message: "No ledger entry found within ±₹5,000 and ±7 day window." },
      { code: "UNKNOWN_COUNTERPARTY", message: "Sender name does not match any known customer or vendor." },
    ],
    reasonText: "₹67,500 RTGS deposit from unknown sender. No matching invoice, purchase order, or vendor record found. Requires manual identification.",
    riskScore: 90,
    status: "pending",
  },
  // ─── 12. Razorpay settlement with platform fee ───
  {
    id: "m_12",
    bankRow: { amount: 19410, date: "08 Nov 2024", description: "RAZORPAY SETTLEMENT", referenceId: "RZP-SETTLE-2281", source: "bank" },
    ledgerRow: { amount: 20000, memo: "Invoice #1012 — Online Sales Week 44", invoiceRef: "INV-1012" },
    confidenceScore: 0.95,
    matchType: "fuzzy",
    matchOutcome: "MATCHED",
    discrepancyType: "PROCESSING_FEE",
    evidenceList: [
      { code: "RAZORPAY_FEE", message: "₹590 deduction matches Razorpay fee (2% + ₹200 settlement + GST on fee)." },
    ],
    reasonText: "Razorpay settlement: ₹20,000 gross → ₹19,410 net after 2% gateway fee (₹400) + ₹200 settlement fee + GST on fees. Standard Razorpay deduction.",
    riskScore: 12,
    status: "approved",
  },
  // ─── 13. Credit note / refund issued ───
  {
    id: "m_13",
    bankRow: { amount: -3500, date: "10 Nov 2024", description: "REFUND-CUSTOMER-PATEL", referenceId: "REF-PATEL-01", source: "bank" },
    ledgerRow: { amount: -3500, memo: "Credit Note CN-2024-089 — Patel Enterprises", invoiceRef: "CN-2024-089" },
    confidenceScore: 0.98,
    matchType: "exact",
    matchOutcome: "MATCHED",
    discrepancyType: "NONE",
    evidenceList: [{ code: "CREDIT_NOTE_MATCH", message: "Refund amount matches credit note CN-2024-089 exactly." }],
    reasonText: "Customer refund ₹3,500 matches credit note CN-2024-089 for Patel Enterprises. Both sides show outflow.",
    riskScore: 10,
    status: "approved",
  },
  // ─── 14. Multi-currency bulk — Shopify international ───
  {
    id: "m_14",
    bankRow: { amount: 142800, date: "12 Nov 2024", description: "SHOPIFY PAYOUT-INTL", referenceId: "SHOP-INTL-Q4-W2", source: "bank" },
    ledgerRow: null,
    ledgerRows: [
      { amount: 41500, memo: "Shopify Order #SH-8841 (USD)", invoiceRef: "SH-8841" },
      { amount: 58300, memo: "Shopify Order #SH-8842 (EUR)", invoiceRef: "SH-8842" },
      { amount: 43000, memo: "Shopify Order #SH-8843 (GBP)", invoiceRef: "SH-8843" },
    ],
    confidenceScore: 0.97,
    matchType: "bulk",
    matchOutcome: "MATCHED",
    discrepancyType: "FX_DIFFERENCE",
    evidenceList: [
      { code: "MULTI_CURRENCY_BATCH", message: "3 international orders in USD/EUR/GBP settled as single INR payout." },
      { code: "FX_WITHIN_TOLERANCE", message: "Combined FX variance ₹0 (Shopify handles conversion). Exact match." },
    ],
    reasonText: "Shopify international payout: 3 orders across USD, EUR, GBP currencies settled as ₹1,42,800 INR. Ledger sum ₹1,42,800 matches exactly after Shopify's FX conversion.",
    riskScore: 14,
    status: "pending",
  },
  // ─── 15. High-value wire — large enterprise invoice ───
  {
    id: "m_15",
    bankRow: { amount: 750000, date: "15 Nov 2024", description: "RTGS-TATA CONSULTANCY SVCS", referenceId: "RTGS-TCS-2024-Q4", source: "bank" },
    ledgerRow: { amount: 750000, memo: "Invoice #1015 — TCS Annual License Renewal", invoiceRef: "INV-1015" },
    confidenceScore: 1.0,
    matchType: "exact",
    matchOutcome: "MATCHED",
    discrepancyType: "NONE",
    evidenceList: [
      { code: "MATCHED_EXACT_CLEAN", message: "High-value exact match ₹7,50,000. RTGS reference verified." },
      { code: "HIGH_VALUE_FLAG", message: "Transaction exceeds ₹5,00,000 threshold — auto-flagged for compliance review." },
    ],
    reasonText: "₹7,50,000 exact match for TCS annual license renewal. High-value transaction auto-flagged per compliance policy. RTGS reference cross-verified.",
    riskScore: 20,
    status: "approved",
  },
];
