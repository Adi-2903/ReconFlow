import "dotenv/config";
import { db } from "./core/db";
import { sql } from "drizzle-orm";

async function runMigration() {
  console.log("Applying manual SQL migration for Phase 4A...");

  const queries = [
    // 1. Create Enums if they don't exist
    `DO $$ BEGIN
      CREATE TYPE fx_status AS ENUM ('NOT_REQUIRED', 'SOURCE_PROVIDED', 'CONVERTED', 'MISSING_RATE');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;`,

    `DO $$ BEGIN
      CREATE TYPE source_system AS ENUM ('bank', 'quickbooks', 'tally', 'stripe', 'xero', 'netsuite');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;`,

    // 2. Alter canonical_transactions table columns
    `ALTER TABLE canonical_transactions ADD COLUMN IF NOT EXISTS source_system source_system DEFAULT 'bank';`,
    // If table has existing rows, we set source_system to 'bank' by default, then drop default
    `ALTER TABLE canonical_transactions ALTER COLUMN source_system SET NOT NULL;`,
    `ALTER TABLE canonical_transactions ALTER COLUMN source_system DROP DEFAULT;`,
    
    `ALTER TABLE canonical_transactions ADD COLUMN IF NOT EXISTS external_id text;`,
    
    // Change date type to timestamptz
    `ALTER TABLE canonical_transactions ALTER COLUMN transaction_date TYPE timestamptz USING transaction_date::timestamptz;`,

    `ALTER TABLE canonical_transactions ADD COLUMN IF NOT EXISTS base_currency char(3);`,
    `ALTER TABLE canonical_transactions ADD COLUMN IF NOT EXISTS converted_amount_minor bigint;`,
    `ALTER TABLE canonical_transactions ADD COLUMN IF NOT EXISTS exchange_rate numeric(18,8);`,
    `ALTER TABLE canonical_transactions ADD COLUMN IF NOT EXISTS exchange_rate_source text;`,
    `ALTER TABLE canonical_transactions ADD COLUMN IF NOT EXISTS fx_rate_provider text;`,
    `ALTER TABLE canonical_transactions ADD COLUMN IF NOT EXISTS exchange_rate_date date;`,
    `ALTER TABLE canonical_transactions ADD COLUMN IF NOT EXISTS fx_status fx_status NOT NULL DEFAULT 'NOT_REQUIRED';`,
    `ALTER TABLE canonical_transactions ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();`,

    // Add Check constraint
    `ALTER TABLE canonical_transactions DROP CONSTRAINT IF EXISTS chk_fx_consistency;`,
    `ALTER TABLE canonical_transactions ADD CONSTRAINT chk_fx_consistency CHECK (
      (fx_status = 'NOT_REQUIRED' AND exchange_rate IS NULL) OR
      (fx_status IN ('SOURCE_PROVIDED', 'CONVERTED') AND exchange_rate IS NOT NULL) OR
      (fx_status = 'MISSING_RATE')
    );`,

    // Indexes
    `CREATE INDEX IF NOT EXISTS idx_canonical_currency ON canonical_transactions(currency);`,
    `CREATE INDEX IF NOT EXISTS idx_canonical_fx_status ON canonical_transactions(fx_status);`,
    `CREATE INDEX IF NOT EXISTS idx_canonical_source_system ON canonical_transactions(source_system);`,
    `CREATE INDEX IF NOT EXISTS idx_canonical_txn_date ON canonical_transactions(transaction_date);`,

    // 3. Alter fx_rates table
    // Delete any duplicates in fx_rates before we add the primary key to prevent key conflict
    `DELETE FROM fx_rates a USING fx_rates b 
     WHERE a.id > b.id 
     AND a.base_currency = b.base_currency 
     AND a.quote_currency = b.quote_currency 
     AND a.rate_date = b.rate_date;`,

    `ALTER TABLE fx_rates DROP CONSTRAINT IF EXISTS uq_fx_rate_date;`,
    `ALTER TABLE fx_rates DROP CONSTRAINT IF EXISTS fx_rates_pkey;`,
    
    // Rename rate to exchange_rate if rate column exists
    `DO $$ BEGIN
      ALTER TABLE fx_rates RENAME COLUMN rate TO exchange_rate;
    EXCEPTION
      WHEN undefined_column THEN null;
    END $$;`,

    `ALTER TABLE fx_rates DROP COLUMN IF EXISTS id;`,
    `ALTER TABLE fx_rates ADD PRIMARY KEY (base_currency, quote_currency, rate_date);`
  ];

  for (const q of queries) {
    try {
      console.log(`Executing: ${q.substring(0, 100).trim()}...`);
      await db.execute(sql.raw(q));
    } catch (e: any) {
      console.error(`Query failed:`, e.message);
      throw e;
    }
  }

  console.log("SQL Migration applied successfully!");
}

runMigration().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
