import { CanonicalTransaction } from "./CanonicalTransaction";

export type ConfidenceBand = "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW";

export type CandidateReasonType =
    | "amount_match"
    | "amount_near_match"
    | "date_match"
    | "utr_match"
    | "invoice_match"
    | "voucher_match"
    | "related_id_match"
    | "reference_match"
    | "counterparty_match"
    | "source_alignment";

export interface CandidateReason {
    reason: CandidateReasonType;
    points: number;
}

export interface CandidateResult {
    candidate: CanonicalTransaction;
    score: number;
    confidenceBand: ConfidenceBand;
    reasons: CandidateReason[];
}
