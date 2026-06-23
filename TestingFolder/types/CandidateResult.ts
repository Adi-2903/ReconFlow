import { CanonicalTransaction } from "./CanonicalTransaction";

export type ConfidenceBand = "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW";

export type CandidateReasonType =
    | "amount_match"
    | "amount_near_match"
    | "date_match"
    | "utr_match"
    | "utr_deterministic_match"
    | "invoice_match"
    | "voucher_match"
    | "related_id_match"
    | "reference_match"
    | "reference_typo_transposition"
    | "reference_mismatch_penalty"
    | "reference_conflict_penalty"
    | "counterparty_match"
    | "counterparty_typo_match"
    | "source_alignment"
    | "exact_match_validated"
    | "tolerance_match_validated"
    | "fee_match_validated"
    | "subset_match_validated"
    | "partial_payment_validated"
    | "partial_payment_valid"
    | "overpayment_detected"
    | "advance_payment_detected"
    | "fx_difference_validated";

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
