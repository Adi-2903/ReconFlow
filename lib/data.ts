import { MatchData } from "@/types/match";

// Shared data simulating a backend state
export const sharedMatches: MatchData[] = [
  {
    id: "m_1",
    bankRow: { amount: 15000, date: "10 Oct 2023", description: "STRIPE PAYMENTS", reference: "STR-001" },
    ledgerRow: { amount: 15000, memo: "Invoice #001", invoiceRef: "INV-001" },
    confidenceScore: 1.0,
    matchType: "exact",
    reasonText: "Exact match on amount and date.",
    status: "pending",
  },
  {
    id: "m_2",
    bankRow: { amount: 8000, date: "15 Dec 2023", description: "LATE PAYMENT DELAYED", reference: "STR-002" },
    ledgerRow: { amount: 8000, memo: "Invoice #002", invoiceRef: "INV-002" },
    confidenceScore: 0.92,
    matchType: "exact",
    reasonText: "Amount matches perfectly. Date gap of 66 days identified, but customer name match confirms relation.",
    status: "pending",
  },
  {
    id: "m_3",
    bankRow: { amount: 9768, date: "12 Oct 2023", description: "STRIPE PAYOUT", reference: "STR-003" },
    ledgerRow: { amount: 10000, memo: "Invoice #003", invoiceRef: "INV-003" },
    confidenceScore: 0.96,
    matchType: "fuzzy",
    reasonText: "AI identified a ₹232.00 processing fee difference typical of Stripe payouts.",
    status: "pending",
  },
  {
    id: "m_4",
    bankRow: { amount: 35000, date: "13 Oct 2023", description: "AMAZON SETTLEMENT", reference: "AMZ-004" },
    ledgerRow: null,
    ledgerRows: [
      { amount: 10000, memo: "Order A", invoiceRef: "ORD-A" },
      { amount: 15000, memo: "Order B", invoiceRef: "ORD-B" },
      { amount: 10000, memo: "Order C", invoiceRef: "ORD-C" },
    ],
    confidenceScore: 0.99,
    matchType: "bulk",
    reasonText: "Sum of 3 ledger entries (10k + 15k + 10k) exactly matches the single bank deposit.",
    status: "pending",
  },
  {
    id: "m_5",
    bankRow: { amount: 4500, date: "14 Oct 2023", description: "VENDOR REFUND", reference: "REF-005" },
    ledgerRow: { amount: 4500, memo: "Supplier Payment", invoiceRef: "BILL-005" },
    confidenceScore: 0.25,
    matchType: "none",
    reasonText: "Amount matches, but AI flagged a critical mismatch: Bank shows a REFUND (deposit), but ledger shows a BILL PAYMENT (withdrawal). Opposite directions.",
    status: "pending",
  },
];
