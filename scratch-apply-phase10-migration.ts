import "dotenv/config";
import { db } from "./core/db";
import { sql } from "drizzle-orm";

/**
 * Phase 10 — Human Review Workflow Migration
 *
 * Changes applied:
 *   1. CREATE TYPE review_type AS ENUM ('AUTO', 'MANUAL')  — idempotent DO block
 *   2. ALTER matches ADD COLUMN review_type                — DEFAULT 'AUTO' NOT NULL
 *   3. ALTER audit_events ADD COLUMN reason               — stores reviewer justification
 *   4. CREATE INDEX idx_canonical_org_status              — speeds up AVAILABLE queries under lock
 *
 * ⚠️  WARNING: Run this script manually via:
 *     npx tsx --env-file=.env scratch-apply-phase10-migration.ts
 *
 *     Do NOT run `drizzle-kit push` after this migration — Drizzle will attempt
 *     to recreate the review_type enum type and may fail or corrupt the schema.
 *     Drizzle schema types are kept in sync locally for type-checking only.
 */
async function runMigration() {
  console.log("[Phase 10 Migration] Starting…\n");

  const queries: Array<{ description: string; sql: string }> = [
    // ──────────────────────────────────────────────────────────────────────────
    // 1. Create review_type enum (idempotent)
    // ──────────────────────────────────────────────────────────────────────────
    {
      description: "Create review_type enum (idempotent)",
      sql: `DO $$ BEGIN
        CREATE TYPE review_type AS ENUM ('AUTO', 'MANUAL');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;`,
    },

    // ──────────────────────────────────────────────────────────────────────────
    // 2. Add review_type column to matches
    // ──────────────────────────────────────────────────────────────────────────
    {
      description: "Add review_type column to matches (DEFAULT 'AUTO')",
      sql: `ALTER TABLE matches
              ADD COLUMN IF NOT EXISTS review_type review_type NOT NULL DEFAULT 'AUTO';`,
    },

    // ──────────────────────────────────────────────────────────────────────────
    // 2b. Add risk_score column to matches
    // ──────────────────────────────────────────────────────────────────────────
    {
      description: "Add risk_score column to matches (DEFAULT 0)",
      sql: `ALTER TABLE matches
              ADD COLUMN IF NOT EXISTS risk_score integer NOT NULL DEFAULT 0;`,
    },

    // ──────────────────────────────────────────────────────────────────────────
    // 3. Add reason column to audit_events
    //    Stores the reviewer's written justification for approve/reject/manual.
    // ──────────────────────────────────────────────────────────────────────────
    {
      description: "Add reason column to audit_events",
      sql: `ALTER TABLE audit_events
              ADD COLUMN IF NOT EXISTS reason text;`,
    },

    // ──────────────────────────────────────────────────────────────────────────
    // 4. Create composite index on (organization_id, status) for canonicalTransactions.
    //    Required for performant AVAILABLE transaction lookups inside locked
    //    transactions during approveMatch / manualMatch calls.
    // ──────────────────────────────────────────────────────────────────────────
    {
      description: "Create idx_canonical_org_status on canonical_transactions(organization_id, status)",
      sql: `CREATE INDEX IF NOT EXISTS idx_canonical_org_status
              ON canonical_transactions (organization_id, status);`,
    },
  ];

  for (const { description, sql: query } of queries) {
    try {
      process.stdout.write(`  → ${description}... `);
      await db.execute(sql.raw(query));
      console.log("OK");
    } catch (err: any) {
      console.error(`FAILED\n    ${err.message}`);
      throw err;
    }
  }

  console.log("\n[Phase 10 Migration] Complete ✓");
  console.log("\n⚠️  Reminder: Do NOT run drizzle-kit push after this migration.");
}

runMigration().catch((err) => {
  console.error("\n[Phase 10 Migration] Fatal error:", err);
  process.exit(1);
});
