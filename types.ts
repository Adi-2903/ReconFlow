export interface MatchingSignals {
    channel?: "UPI" | "NEFT" | "RTGS" | "IMPS" | "CASH" | "ACH" | "CARD" | "CHECK" | "STRIPE" | "WIRE";
    utr?: string;
    invoiceNumber?: string;
    voucherNumber?: string;
    referenceNumber?: string;
    customerName?: string;
    vendorName?: string;
    merchantName?: string;
    relatedTransactionId?: string;
}

export interface TransactionMetadata {
    matchingSignals?: MatchingSignals;
    intelligenceVersion?: "v1";
}

export interface ScoreBreakdown {
    exactMatchRule: number;
    dateProximity: number;
    textSimilarity: number;
    subsetCalculated: boolean;
}

// ── Phase 9: AI Reasoning Layer ─────────────────────────────────────────────

/**
 * Single source of truth for the prompt version.
 * Increment this string whenever the LLM prompt template changes.
 * All cache lookups filter on PROMPT_VERSION — a bump automatically
 * invalidates stale cache entries without deleting them.
 */
export const PROMPT_VERSION = "p9-v1" as const;

export type RecommendedAction =
  | "AUTO_APPROVE"
  | "MANUAL_REVIEW"
  | "REQUEST_DOCUMENTATION"
  | "CHECK_LEDGER"
  | "CHECK_BANK_STATEMENT"
  | "INVESTIGATE_DUPLICATE"
  | "FOLLOW_UP_VENDOR";

export interface AIReasoning {
    version: "v1";
    source: "STATIC" | "PARAMETERIZED" | "CACHE_HIT" | "LLM";
    /** Maps to DiscrepancyType from Phase 7 classifier. */
    rootCause: string;
    /** Confidence from the matching engine / classifier — NEVER from the LLM. */
    confidence: number;
    /**
     * Advisory only — does NOT control queue routing.
     * Actual workflow disposition is determined by Phase 8 riskScore and
     * Phase 7/8 confidenceBand. If the LLM hallucinates false here on a
     * flagged match, the authoritative riskScore still routes it correctly.
     */
    requiresHumanReview: boolean;
    /** Advisory only — see requiresHumanReview note above. */
    suggestedAction: RecommendedAction;
    /**
     * Stored with placeholders such as '{bankCounterparty}' and '{difference}'.
     * Rendered at display time via renderExplanation() — never stored as a
     * final string so wording changes don't require re-running inference.
     */
    explanationTemplate: string;
    evidenceCodes: string[];
    flags: string[];
    modelUsed?: string | null;
    tokenCount?: number | null;
    latencyMs?: number | null;
    /** Backward compat: legacy services (exceptions.service, reports.service) read this. */
    likelyReason?: string;
}

export interface ConnectorSettings {
    autoSync?: boolean;
    syncFrequency?: string;
    targetLedgerId?: string;
    qboRealmId?: string;
    stripeUserId?: string;
    [key: string]: any;
}

export interface FeeRuleConfig {
    percentage: number;
    fixedFeeMinor: number;
    currency: string;
}

export interface MappingTemplateConfig {
    columnMap: Record<string, string>;
    dateFormat: string;
    ignoreHeader: boolean;
    headerFingerprint?: string;
}