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

export interface AIReasoning {
    logicSteps: string[];
    suggestedAction: string;
    flaggedAnomalies?: string[];
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