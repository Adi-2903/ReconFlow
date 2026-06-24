import "dotenv/config";
import { db } from "./core/db";
import { sql } from "drizzle-orm";

/**
 * Phase 11 — Daily Metrics Migration
 *
 * Changes applied:
 *   1. ALTER organizations ADD COLUMN timezone           — DEFAULT 'Asia/Kolkata' NOT NULL
 *   2. CREATE TABLE daily_metrics                      — Idempotent with IF NOT EXISTS
 *   3. ADD CONSTRAINT uq_daily_metric_org_date         — Idempotent DO block
 *
 * ⚠️  WARNING: Run this script manually via:
 *     npx tsx --env-file=.env scratch-apply-phase11-migration.ts
 */
async function runMigration() {
  console.log("[Phase 11 Migration] Starting…\n");

  const queries: Array<{ description: string; sql: string }> = [
    // ──────────────────────────────────────────────────────────────────────────
    // 1. Add timezone column to organizations
    // ──────────────────────────────────────────────────────────────────────────
    {
      description: "Add timezone column to organizations (DEFAULT 'Asia/Kolkata')",
      sql: `ALTER TABLE organizations
              ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Kolkata';`,
    },

    // ──────────────────────────────────────────────────────────────────────────
    // 2. Create daily_metrics table
    // ──────────────────────────────────────────────────────────────────────────
    {
      description: "Create daily_metrics table",
      sql: `CREATE TABLE IF NOT EXISTS daily_metrics (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        metric_date date NOT NULL,
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        total_count integer NOT NULL DEFAULT 0,
        matched_count integer NOT NULL DEFAULT 0,
        pending_count integer NOT NULL DEFAULT 0,
        unmatched_count integer NOT NULL DEFAULT 0,
        high_risk_count integer NOT NULL DEFAULT 0,
        total_volume_minor bigint NOT NULL DEFAULT 0,
        fee_volume_minor bigint NOT NULL DEFAULT 0,
        fx_volume_minor bigint NOT NULL DEFAULT 0,
        created_at timestamp with time zone NOT NULL DEFAULT now(),
        updated_at timestamp with time zone NOT NULL DEFAULT now()
      );`,
    },

    // ──────────────────────────────────────────────────────────────────────────
    // 3. Create unique constraint on (organization_id, metric_date)
    // ──────────────────────────────────────────────────────────────────────────
    {
      description: "Create unique constraint uq_daily_metric_org_date",
      sql: `DO $$ BEGIN
        ALTER TABLE daily_metrics
          ADD CONSTRAINT uq_daily_metric_org_date UNIQUE (organization_id, metric_date);
      EXCEPTION
        WHEN duplicate_table THEN null;
        WHEN duplicate_object THEN null;
        WHEN invalid_table_definition THEN null;
      END $$;`,
    }
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

  console.log("\n[Phase 11 Migration] Complete ✓");
  console.log("\n⚠️  Reminder: Do NOT run drizzle-kit push after this migration.");
}

runMigration().catch((err) => {
  console.error("\n[Phase 11 Migration] Fatal error:", err);
  process.exit(1);
});
