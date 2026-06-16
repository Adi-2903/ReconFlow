import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  date,
  integer,
  jsonb,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("passwordHash"),
  companyName: text("company_name"),
  qboAccessToken: text("qbo_access_token"),
  qboRefreshToken: text("qbo_refresh_token"),
  qboRealmId: text("qbo_realm_id"),
  qboTokenExpiresAt: timestamp("qbo_token_expires_at"),
  qboLastSync: timestamp("qbo_last_sync"),
  
  // Stripe Connect OAuth
  stripeAccessToken: text("stripe_access_token"),
  stripeUserId: text("stripe_user_id"),
  stripeLastSync: timestamp("stripe_last_sync"),
  
  createdAt: timestamp("created_at").defaultNow(),
});


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
  bankTransactionId: uuid("bank_transaction_id").references(() => bankTransactions.id),
  ledgerEntryIds: text("ledger_entry_ids").array(),
  confidenceScore: numeric("confidence_score"),
  matchType: text("match_type"),
  reasonText: text("reason_text"),
  evidence: jsonb("evidence"), // Added for AI explanations
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
