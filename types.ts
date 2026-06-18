export interface TransactionMetadata {
    source?: string;
    layout?: string;
    importMethod?: string;
    originalHeaders?: string[];
    originalDescription?: string;
    bankCategory?: string;
    location?: string;
    [key: string]: any;
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