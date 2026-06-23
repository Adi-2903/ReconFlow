export interface ClassificationEvidence {
  code: string;
  message: string;
}

export type MatchData = {
  id: string;
  bankRow: { amount: number; date: string; description: string; reference: string };
  ledgerRow: { amount: number; memo: string; invoiceRef: string } | null;
  ledgerRows?: Array<{ amount: number; memo: string; invoiceRef: string }>;
  confidenceScore: number;
  matchType: "exact" | "fuzzy" | "bulk" | "none" | string;
  matchOutcome?: "MATCHED" | "PARTIALLY_MATCHED" | "UNMATCHED" | string;
  discrepancyType?: "NONE" | "TIMING_DIFFERENCE" | "PROCESSING_FEE" | "FOREIGN_EXCHANGE" | "TYPO" | "DUPLICATE" | "MISSING_ENTRY" | string;
  evidenceList?: ClassificationEvidence[] | null;
  reasonText: string;
  riskScore: number; // 0 – 100 integer (Phase 8)
  status: "pending" | "approved" | "rejected";
};

