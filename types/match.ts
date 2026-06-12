// Canonical match type used across the entire application.
// All components and contexts should import from here.
export type MatchData = {
  id: string;
  bankRow: { amount: number; date: string; description: string; reference: string };
  ledgerRow: { amount: number; memo: string; invoiceRef: string } | null;
  ledgerRows?: Array<{ amount: number; memo: string; invoiceRef: string }>;
  confidenceScore: number;
  matchType: "exact" | "fuzzy" | "bulk" | "none";
  reasonText: string;
  status: "pending" | "approved" | "rejected";
};
