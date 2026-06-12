import { MatchData } from "@/types/match";

// Shared data simulating a backend state
export const sharedMatches: MatchData[] = [
  {
    id: "m_1",
    bankRow: { amount: 45000, date: "10 Oct 2023", description: "STRIPE PAYMENTS", reference: "STR-001" },
    ledgerRow: { amount: 45000, memo: "Invoice INV-2023-042", invoiceRef: "INV-2023-042" },
    confidenceScore: 1.0,
    matchType: "exact",
    reasonText: "Exact match",
    status: "pending",
  },
  {
    id: "m_2",
    bankRow: { amount: -12450.5, date: "11 Oct 2023", description: "AWS SERVICES", reference: "AWS-EMEA" },
    ledgerRow: { amount: -12450.5, memo: "Amazon Web Services", invoiceRef: "BILL-882" },
    confidenceScore: 0.98,
    matchType: "fuzzy",
    reasonText: "Fuzzy amount match",
    status: "pending",
  },
  {
    id: "m_3",
    bankRow: { amount: -124000, date: "12 Oct 2023", description: "GUSTO PAYROLL", reference: "ACH-GUSTO" },
    ledgerRow: null,
    ledgerRows: [
      { amount: -62000, memo: "Payroll clearing account 1", invoiceRef: "PAY-1" },
      { amount: -62000, memo: "Payroll clearing account 2", invoiceRef: "PAY-2" },
    ],
    confidenceScore: 0.95,
    matchType: "bulk",
    reasonText: "Sum of entries matches",
    status: "pending",
  },
  {
    id: "m_4",
    bankRow: { amount: 5000, date: "12 Oct 2023", description: "UNKNOWN WIRE REF 8829", reference: "WIRE-8829" },
    ledgerRow: null,
    confidenceScore: 0.1,
    matchType: "none",
    reasonText: "No similar ledger entries found",
    status: "pending",
  },
  {
    id: "m_5",
    bankRow: { amount: 88200, date: "13 Oct 2023", description: "RAZORPAY SETTLEMENT", reference: "RZPAY-SETTLE" },
    ledgerRow: { amount: 88200, memo: "Razorpay Daily Settlement", invoiceRef: "DEP-RZP-1310" },
    confidenceScore: 0.99,
    matchType: "exact",
    reasonText: "High confidence exact sync",
    status: "pending",
  },
];
