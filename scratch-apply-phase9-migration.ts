import "dotenv/config";
import { db } from "./core/db";
import { sql } from "drizzle-orm";

/**
 * Phase 9 — AI Reasoning Layer Migration
 *
 * Changes applied:
 *   1. ALTER ai_explanations — make prompt/response nullable, add audit columns
 *   2. CREATE ai_explanation_cache — new table with composite (hash, promptVersion) unique index
 *
 * Run with: npx tsx --env-file=.env scratch-apply-phase9-migration.ts
 */
async function runMigration() {
  console.log("[Phase 9 Migration] Starting...\n");

  const queries: Array<{ description: string; sql: string }> = [
    // ──────────────────────────────────────────────────────────────────────────
    // 1. Alter ai_explanations
    // ──────────────────────────────────────────────────────────────────────────
    {
      description: "Make ai_explanations.prompt nullable",
      sql: `ALTER TABLE ai_explanations ALTER COLUMN prompt DROP NOT NULL;`,
    },
    {
      description: "Make ai_explanations.response nullable",
      sql: `ALTER TABLE ai_explanations ALTER COLUMN response DROP NOT NULL;`,
    },
    {
      description: "Add ai_explanations.prompt_version",
      sql: `ALTER TABLE ai_explanations
              ADD COLUMN IF NOT EXISTS prompt_version text NOT NULL DEFAULT 'p9-v1';`,
    },
    {
      description: "Add ai_explanations.source",
      sql: `ALTER TABLE ai_explanations
              ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'STATIC';`,
    },
    {
      description: "Add ai_explanations.model_used",
      sql: `ALTER TABLE ai_explanations
              ADD COLUMN IF NOT EXISTS model_used text;`,
    },
    {
      description: "Add ai_explanations.token_count",
      sql: `ALTER TABLE ai_explanations
              ADD COLUMN IF NOT EXISTS token_count integer;`,
    },
    {
      description: "Add ai_explanations.latency_ms",
      sql: `ALTER TABLE ai_explanations
              ADD COLUMN IF NOT EXISTS latency_ms integer;`,
    },
    // Remove transient defaults after backfilling existing rows
    {
      description: "Drop DEFAULT on ai_explanations.prompt_version (was only for backfill)",
      sql: `ALTER TABLE ai_explanations
              ALTER COLUMN prompt_version DROP DEFAULT;`,
    },
    {
      description: "Drop DEFAULT on ai_explanations.source (was only for backfill)",
      sql: `ALTER TABLE ai_explanations
              ALTER COLUMN source DROP DEFAULT;`,
    },

    // ──────────────────────────────────────────────────────────────────────────
    // 2. Create ai_explanation_cache
    // ──────────────────────────────────────────────────────────────────────────
    {
      description: "Create ai_explanation_cache table",
      sql: `CREATE TABLE IF NOT EXISTS ai_explanation_cache (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        reason_hash         text NOT NULL,
        prompt_version      text NOT NULL,
        suggested_action    text NOT NULL,
        explanation_template text NOT NULL,
        model               text NOT NULL,
        version             integer NOT NULL DEFAULT 1,
        created_at          timestamptz NOT NULL DEFAULT now()
      );`,
    },
    {
      description: "Create composite unique index on (reason_hash, prompt_version)",
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_reason_hash_version
              ON ai_explanation_cache (reason_hash, prompt_version);`,
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

  console.log("\n[Phase 9 Migration] Complete ✓");
}

runMigration().catch((err) => {
  console.error("\n[Phase 9 Migration] Fatal error:", err);
  process.exit(1);
});
