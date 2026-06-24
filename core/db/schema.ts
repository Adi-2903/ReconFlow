import {
    pgTable, uuid, text, timestamp, boolean, integer,
    jsonb, numeric, primaryKey, index, uniqueIndex, vector,
    pgEnum, char, bigint, date, unique, check
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import type {
    TransactionMetadata, ScoreBreakdown, AIReasoning,
    ConnectorSettings, FeeRuleConfig, MappingTemplateConfig
} from "./types";

// ============================================================================
// 1. STATE MACHINES & ENUMS
// ============================================================================

export const memberRoleEnum = pgEnum("member_role", ["owner", "admin", "accountant", "viewer"]);
export const accountTypeEnum = pgEnum("account_type", ["bank", "quickbooks", "tally", "stripe", "xero", "netsuite"]);
export const transactionSideEnum = pgEnum("transaction_side", ["money", "books"]);
export const transactionDirectionEnum = pgEnum("transaction_direction", ["inflow", "outflow"]);

export const transactionStatusEnum = pgEnum("transaction_status", [
    "RAW", "CLEANED", "MAPPED", "ENRICHED", "AVAILABLE",
    "LOCKED_CANDIDATE", "MATCHED_PENDING", "LOCKED_APPROVED"
]);

export const matchStatusEnum = pgEnum("match_status", [
    "DRAFT", "AUTO_MATCHED", "SUGGESTED", "NEEDS_REVIEW", "REJECTED", "APPROVED"
]);

export const matchOutcomeEnum = pgEnum("match_outcome", [
    "MATCHED", "PARTIALLY_MATCHED", "UNMATCHED"
]);

export const discrepancyTypeEnum = pgEnum("discrepancy_type", [
    "NONE", "TIMING_DIFFERENCE", "PROCESSING_FEE", "FOREIGN_EXCHANGE", "TYPO", "DUPLICATE", "MISSING_ENTRY",
    "AMOUNT_DIFFERENCE", "COUNTERPARTY_DIFFERENCE", "REFERENCE_DIFFERENCE", "DUPLICATE_INVOICE", "MANUAL_REVIEW"
]);

export const runStatusEnum = pgEnum("run_status", [
    "INITIALIZED", "DATA_GATHERING", "CANDIDATE_GENERATION",
    "MATCHING_EXECUTION", "CLASSIFICATION_SCORING", "AI_REASONING",
    "REVIEW_READY", "COMPLETED"
]);

export const importStatusEnum = pgEnum("import_status", [
    "UPLOADED", "PARSING", "CLEANING", "MAPPING", "ENRICHING", "COMPLETED", "FAILED"
]);

export const embeddingStatusEnum = pgEnum("embedding_status", [
    "PENDING", "GENERATED", "FAILED"
]);

export const fxStatusEnum = pgEnum("fx_status", [
    "NOT_REQUIRED", "SOURCE_PROVIDED", "CONVERTED", "MISSING_RATE"
]);

export const sourceSystemEnum = pgEnum("source_system", [
    "bank", "quickbooks", "tally", "stripe", "xero", "netsuite"
]);

// ============================================================================
// 2. AUTH.JS & IDENTITY LAYER
// ============================================================================

export const users = pgTable("users", {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").unique().notNull(),
    name: text("name"),
    image: text("image"),
    emailVerified: timestamp("email_verified", { mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const authAccounts = pgTable("auth_accounts", {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
}, (table) => {
    return {
        pk: primaryKey({ columns: [table.provider, table.providerAccountId] }),
    };
});

export const sessions = pgTable("sessions", {
    sessionToken: text("session_token").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable("verification_tokens", {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
}, (table) => {
    return {
        pk: primaryKey({ columns: [table.identifier, table.token] }),
    };
});

// ============================================================================
// 3. MULTI-TENANT & ORGANIZATIONS
// ============================================================================

export const organizations = pgTable("organizations", {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    baseCurrency: char("base_currency", { length: 3 }).notNull().default("USD"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const organizationMembers = pgTable("organization_members", {
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").notNull(),
}, (table) => {
    return {
        pk: primaryKey({ columns: [table.organizationId, table.userId] }),
    };
});

// ============================================================================
// 4. FINANCIAL SOURCES & INGESTION
// ============================================================================

export const financialAccounts = pgTable("financial_accounts", {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    accountType: accountTypeEnum("account_type").notNull(),
    name: text("name").notNull(),
    baseCurrency: char("base_currency", { length: 3 }).notNull(),
    externalId: text("external_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const connectors = pgTable("connectors", {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull().references(() => financialAccounts.id, { onDelete: "cascade" }),
    connectorType: accountTypeEnum("connector_type").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    status: text("status"),
    settings: jsonb("settings").$type<ConnectorSettings>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const imports = pgTable("imports", {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").references(() => financialAccounts.id),
    sourceType: text("source_type"),
    filename: text("filename"),
    status: importStatusEnum("status").notNull().default("UPLOADED"),
    rowCount: integer("row_count"),
    sha256: text("sha256"),
    errorMessage: text("error_message"),
    successCount: integer("success_count").default(0),
    failureCount: integer("failure_count").default(0),
    skippedCount: integer("skipped_count").default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const rawRecords = pgTable("raw_records", {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    importId: uuid("import_id").notNull().references(() => imports.id, { onDelete: "cascade" }),
    rowNumber: integer("row_number"),
    rawPayload: jsonb("raw_payload").notNull(),
    sourceHash: text("source_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const mappingTemplates = pgTable("mapping_templates", {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    templateName: text("template_name"),
    mapping: jsonb("mapping").$type<MappingTemplateConfig>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ============================================================================
// 5. CANONICAL LEDGER & AI VECTORIZATION
// ============================================================================

export const canonicalTransactions = pgTable("canonical_transactions", {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull().references(() => financialAccounts.id),
    rawRecordId: uuid("raw_record_id").references(() => rawRecords.id),

    sourceSystem: sourceSystemEnum("source_system").notNull(),
    externalId: text("external_id"),

    side: transactionSideEnum("side").notNull(),
    direction: transactionDirectionEnum("direction").notNull(),
    status: transactionStatusEnum("status").notNull().default("RAW"),

    transactionDate: timestamp("transaction_date", { withTimezone: true }).notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),

    referenceNumber: text("reference_number"),
    counterpartyName: text("counterparty_name"),
    counterpartyNormalized: text("counterparty_normalized"),
    description: text("description"),
    transactionType: text("transaction_type"),
    sourceTransactionId: text("source_transaction_id"),

    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedByMatchGroupId: uuid("locked_by_match_group_id"),
    activeRunId: uuid("active_run_id"),

    baseCurrency: char("base_currency", { length: 3 }),
    convertedAmountMinor: bigint("converted_amount_minor", { mode: "bigint" }),
    exchangeRate: numeric("exchange_rate", { precision: 18, scale: 8 }),
    exchangeRateSource: text("exchange_rate_source"),
    fxRateProvider: text("fx_rate_provider"),
    exchangeRateDate: date("exchange_rate_date"),
    fxStatus: fxStatusEnum("fx_status").notNull().default("NOT_REQUIRED"),

    metadata: jsonb("metadata").$type<TransactionMetadata>().default({}),
    // embeddingStatus: embeddingStatusEnum("embedding_status").default("PENDING").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => {
    return {
        orgDateStatusIdx: index("idx_txn_org_date_status").on(table.organizationId, table.transactionDate, table.status),
        matchingIdx: index("idx_txn_matching").on(table.organizationId, table.amountMinor, table.transactionDate, table.direction),
        uniqueAccountSourceTxn: unique("uq_account_source_txn").on(table.accountId, table.sourceTransactionId),
        idxCanonicalCurrency: index("idx_canonical_currency").on(table.currency),
        idxCanonicalFxStatus: index("idx_canonical_fx_status").on(table.fxStatus),
        idxCanonicalSourceSystem: index("idx_canonical_source_system").on(table.sourceSystem),
        idxCanonicalTxnDate: index("idx_canonical_txn_date").on(table.transactionDate),
        fxConsistency: check(
            "chk_fx_consistency",
            sql`(
                (fx_status = 'NOT_REQUIRED' AND exchange_rate IS NULL) OR
                (fx_status IN ('SOURCE_PROVIDED', 'CONVERTED') AND exchange_rate IS NOT NULL) OR
                (fx_status = 'MISSING_RATE')
            )`
        )
    };
});


// ISOLATED EMBEDDINGS (Performance Upgrade)
// export const transactionEmbeddings = pgTable("transaction_embeddings", {
//     id: uuid("id").primaryKey().defaultRandom(),
//     organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
//     transactionId: uuid("transaction_id").notNull().references(() => canonicalTransactions.id, { onDelete: "cascade" }),
//     model: text("model").notNull().default("all-MiniLM-L6-v2"),
//     embedding: vector("embedding", { dimensions: 384 }).notNull(),
//     createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
// }, (table) => {
//     return {
//         embeddingIdx: index("idx_txn_embedding").using("hnsw", table.embedding.op("vector_cosine_ops")),
//         txnUniqueIdx: uniqueIndex("idx_unique_txn_embedding").on(table.transactionId),
//     };
// });


export const counterpartyProfiles = pgTable("counterparty_profiles", {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    normalizedName: text("normalized_name").notNull(),
    avgProcessingDays: numeric("avg_processing_days", { precision: 5, scale: 2 }),
    avgFeePercentage: numeric("avg_fee_percentage", { precision: 5, scale: 2 }),
    totalTransactions: integer("total_transactions").default(0),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => {
    return {
        uniqueCounterparty: unique("uq_counterparty_org_name").on(table.organizationId, table.normalizedName),
    };
});

export const learnedPatterns = pgTable("learned_patterns", {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    counterpartyProfileId: uuid("counterparty_profile_id").references(() => counterpartyProfiles.id),
    patternType: text("pattern_type"),
    confidence: numeric("confidence", { precision: 5, scale: 2 }),
    patternData: jsonb("pattern_data"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ============================================================================
// 6. RECONCILIATION ENGINE
// ============================================================================

export const reconciliationRuns = pgTable("reconciliation_runs", {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name"),
    status: runStatusEnum("status").notNull().default("INITIALIZED"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
});

// RUN HISTORY JUNCTION (Audit Upgrade)
export const reconciliationRunTransactions = pgTable("reconciliation_run_transactions", {
    runId: uuid("run_id").notNull().references(() => reconciliationRuns.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id").notNull().references(() => canonicalTransactions.id, { onDelete: "cascade" }),
    lockedAt: timestamp("locked_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => {
    return {
        pk: primaryKey({ columns: [table.runId, table.transactionId] }),
    };
});

export const transactionCandidates = pgTable("transaction_candidates", {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    sourceTransactionId: uuid("source_transaction_id").notNull().references(() => canonicalTransactions.id),
    candidateTransactionId: uuid("candidate_transaction_id").notNull().references(() => canonicalTransactions.id),
    score: numeric("score", { precision: 5, scale: 2 }),
    scoreBreakdown: jsonb("score_breakdown").$type<ScoreBreakdown>(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => {
    return {
        uniqueCandidatePair: unique("uq_candidate_pair").on(table.sourceTransactionId, table.candidateTransactionId),
    };
});

// MATCH VERSIONING INCLUDED
export const matchGroups = pgTable("match_groups", {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull().references(() => reconciliationRuns.id, { onDelete: "cascade" }),
    status: matchStatusEnum("status").notNull(),
    version: integer("version").default(1).notNull(),
    supersededByMatchGroupId: uuid("superseded_by_match_group_id"), // Self-referencing

    confidenceScore: numeric("confidence_score", { precision: 5, scale: 2 }),
    scoreBreakdown: jsonb("score_breakdown").$type<ScoreBreakdown>(),

    totalMoneyAmountMinor: bigint("total_money_amount_minor", { mode: "bigint" }).default(sql`0`).notNull(),
    totalBooksAmountMinor: bigint("total_books_amount_minor", { mode: "bigint" }).default(sql`0`).notNull(),
    residualAmountMinor: bigint("residual_amount_minor", { mode: "bigint" }).default(sql`0`).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const matchItems = pgTable("match_items", {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    matchGroupId: uuid("match_group_id").notNull().references(() => matchGroups.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id").notNull().references(() => canonicalTransactions.id),
    role: transactionSideEnum("role").notNull(),

    contributionAmountMinor: bigint("contribution_amount_minor", { mode: "bigint" }).notNull(),
    allocatedAmountMinor: bigint("allocated_amount_minor", { mode: "bigint" }).notNull(),
    confidenceScore: numeric("confidence_score", { precision: 5, scale: 2 }),
    matchReason: text("match_reason"),
    metadata: jsonb("metadata"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => {
    return {
        txnIdx: index("idx_match_items_txn").on(table.transactionId),
    };
});

export const classifications = pgTable("classifications", {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").unique().notNull(),
    name: text("name").notNull(),
    description: text("description"),
});

export const matchGroupClassifications = pgTable("match_group_classifications", {
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    matchGroupId: uuid("match_group_id").notNull().references(() => matchGroups.id, { onDelete: "cascade" }),
    classificationId: uuid("classification_id").notNull().references(() => classifications.id, { onDelete: "cascade" }),
    confidence: numeric("confidence", { precision: 5, scale: 2 }),
}, (table) => {
    return {
        pk: primaryKey({ columns: [table.matchGroupId, table.classificationId] }),
    };
});

// ============================================================================
// 7. REVIEW QUEUE & AI REASONING
// ============================================================================

export const reviewQueue = pgTable("review_queue", {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    matchGroupId: uuid("match_group_id").notNull().references(() => matchGroups.id, { onDelete: "cascade" }),
    priorityScore: integer("priority_score"),
    assignedTo: uuid("assigned_to").references(() => users.id),
    status: text("status"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => {
    return {
        statusPriorityIdx: index("idx_review_queue_status_priority").on(table.status, table.priorityScore),
    };
});

export const aiExplanations = pgTable("ai_explanations", {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    matchGroupId: uuid("match_group_id").references(() => matchGroups.id, { onDelete: "cascade" }),
    // nullable — not set for STATIC/PARAMETERIZED sources
    prompt: text("prompt"),
    response: text("response"),
    confidence: numeric("confidence", { precision: 5, scale: 2 }),
    reasoning: jsonb("reasoning").$type<AIReasoning>(),
    // PROMPT_VERSION constant — used for cache invalidation on prompt changes
    promptVersion: text("prompt_version").notNull(),
    // 'STATIC' | 'PARAMETERIZED' | 'CACHE_HIT' | 'LLM'
    source: text("source").notNull(),
    modelUsed: text("model_used"),
    tokenCount: integer("token_count"),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Persistent LLM explanation cache.
 * Composite unique index on (reason_hash, prompt_version) ensures:
 *   - One cache row per structural scenario per prompt version.
 *   - A PROMPT_VERSION bump invalidates stale entries automatically
 *     (old rows remain but are never returned; prunable by a background job).
 *   - onConflictDoNothing() is safe — hash collision under the same version
 *     is astronomically unlikely with SHA-256. A structured warning log is
 *     emitted so this blind spot is visible in the observability dashboard.
 */
export const aiExplanationCache = pgTable("ai_explanation_cache", {
    id: uuid("id").primaryKey().defaultRandom(),
    reasonHash: text("reason_hash").notNull(),
    promptVersion: text("prompt_version").notNull(),
    suggestedAction: text("suggested_action").notNull(),
    explanationTemplate: text("explanation_template").notNull(),
    model: text("model").notNull(),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    hashVersionIdx: uniqueIndex("idx_ai_reason_hash_version").on(
        table.reasonHash,
        table.promptVersion
    ),
}));

// ============================================================================
// 8. METADATA & AUDIT
// ============================================================================

export const fxRates = pgTable("fx_rates", {
    baseCurrency: char("base_currency", { length: 3 }).notNull(),
    quoteCurrency: char("quote_currency", { length: 3 }).notNull(),
    rateDate: date("rate_date").notNull(),
    exchangeRate: numeric("exchange_rate", { precision: 18, scale: 8 }).notNull(),
}, (table) => ({
    pk: primaryKey({ columns: [table.baseCurrency, table.quoteCurrency, table.rateDate] }),
}));

export const feeRules = pgTable("fee_rules", {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    ruleName: text("rule_name").notNull(),
    feeConfig: jsonb("fee_config").$type<FeeRuleConfig>().notNull(),
    active: boolean("active").default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const auditLogs = pgTable("audit_logs", {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    action: text("action"),
    beforeState: jsonb("before_state"),
    afterState: jsonb("after_state"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ============================================================================
// 9. DRIZZLE RELATIONS
// ============================================================================

export const canonicalTransactionsRelations = relations(canonicalTransactions, ({ one, many }) => ({
    account: one(financialAccounts, {
        fields: [canonicalTransactions.accountId],
        references: [financialAccounts.id],
    }),
    activeRun: one(reconciliationRuns, {
        fields: [canonicalTransactions.activeRunId],
        references: [reconciliationRuns.id],
    }),
    lockedByGroup: one(matchGroups, {
        fields: [canonicalTransactions.lockedByMatchGroupId],
        references: [matchGroups.id]
    }),
//     embedding: one(transactionEmbeddings, {
//         fields: [canonicalTransactions.id],
//         references: [transactionEmbeddings.transactionId],
//     }),
    runHistory: many(reconciliationRunTransactions),
}));

export const reconciliationRunsRelations = relations(reconciliationRuns, ({ many }) => ({
    transactionHistory: many(reconciliationRunTransactions),
}));

export const matchGroupsRelations = relations(matchGroups, ({ one, many }) => ({
    items: many(matchItems),
    classifications: many(matchGroupClassifications),
    aiExplanations: many(aiExplanations),
    supersededBy: one(matchGroups, {
        fields: [matchGroups.supersededByMatchGroupId],
        references: [matchGroups.id],
    }),
}));

export const matchItemsRelations = relations(matchItems, ({ one }) => ({
    group: one(matchGroups, {
        fields: [matchItems.matchGroupId],
        references: [matchGroups.id],
    }),
    transaction: one(canonicalTransactions, {
        fields: [matchItems.transactionId],
        references: [canonicalTransactions.id],
    }),
}));

// Legacy table definitions kept for compatibility with untouched services
export const bankTransactions = pgTable("bank_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  amount: numeric("amount").notNull(),
  currency: text("currency").default("INR"),
  date: date("date").notNull(),
  description: text("description"),
  referenceId: text("reference_id"),
  source: text("source"),
  status: text("status").default("unmatched"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const ledgerEntries = pgTable("ledger_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  amount: numeric("amount").notNull(),
  date: date("date").notNull(),
  memo: text("memo"),
  invoiceRef: text("invoice_ref"),
  accountCode: text("account_code"),
  status: text("status").default("unmatched"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const matches = pgTable("matches", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  bankTransactionId: uuid("bank_transaction_id").references(() => canonicalTransactions.id),
  ledgerEntryIds: text("ledger_entry_ids").array(),
  confidenceScore: numeric("confidence_score"),
  matchType: text("match_type"),
  matchOutcome: matchOutcomeEnum("match_outcome"),
  discrepancyType: discrepancyTypeEnum("discrepancy_type"),
  classificationEvidence: jsonb("classification_evidence"),
  reasonText: text("reason_text"),
  evidence: jsonb("evidence"), // Added for AI explanations
  riskScore: integer("risk_score").notNull().default(0),
  status: text("status").default("pending"),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  matchId: uuid("match_id").references(() => matches.id),
  action: text("action").notNull(),
  actorEmail: text("actor_email"),
  timestamp: timestamp("timestamp").defaultNow(),
  metadata: jsonb("metadata"),
});

export const reconRuns = pgTable("recon_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  periodStart: date("period_start"),
  periodEnd: date("period_end"),
  totalTransactions: integer("total_transactions"),
  autoMatched: integer("auto_matched"),
  needsReview: integer("needs_review"),
  exceptions: integer("exceptions"),
  status: text("status").default("running"),
  createdAt: timestamp("created_at").defaultNow(),
});

