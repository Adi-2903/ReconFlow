import "dotenv/config";
import { db } from "../core/db";
import { sql } from "drizzle-orm";

async function runMigration() {
  console.log("[Auth & Onboarding Migration] Starting…\n");

  const queries = [
    {
      description: "Add password_hash column to users table",
      sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;`,
    },
    {
      description: "Add onboarded column to users table (default false)",
      sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarded boolean NOT NULL DEFAULT false;`,
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

  console.log("\n[Auth & Onboarding Migration] Complete ✓");
}

runMigration().catch((err) => {
  console.error("\n[Auth & Onboarding Migration] Fatal error:", err);
  process.exit(1);
});
