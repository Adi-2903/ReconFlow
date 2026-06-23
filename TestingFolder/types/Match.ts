import { ConfidenceBand, CandidateReason } from "./CandidateResult";

export type MatchType =
    | "exact"
    | "utr_exact"
    | "tolerance"
    | "near"
    | "fee_adjustment"
    | "one_to_many"
    | "many_to_one"
    | "partial_payment"
    | "fx_difference"
    | "unmatched_ledger"
    | "unmatched";

export interface Match {
    bankTransactionIds: string[];
    bookTransactionIds: string[];

    score: number;
    confidenceBand: ConfidenceBand | "NONE";

    matchType: MatchType;

    matchOutcome?: string;
    discrepancyType?: string;
    evidence?: Array<{ code: string; message: string }>;

    riskScore: number; // 0 – 100 integer (Phase 8)
    explanation?: string;
    reasons?: CandidateReason[];
}