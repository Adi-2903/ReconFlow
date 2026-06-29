import "dotenv/config";
import { db } from "../core/db";
import { sql } from "drizzle-orm";

async function runMigration() {
  console.log("--------------------------------------------------");
  console.log("Applying idempotent CHECK constraint for matches.status (F-13)...");
  console.log("--------------------------------------------------");

  const query = `
    DO $$ BEGIN
      ALTER TABLE matches ADD CONSTRAINT chk_matches_status 
      CHECK (status IN ('pending', 'approved', 'rejected', 'superseded'));
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;
  `;

  try {
    await db.execute(sql.raw(query));
    console.log("CHECK constraint successfully applied or already exists.");
  } catch (e: any) {
    console.error("Migration failed:", e.message);
    process.exit(1);
  }

  console.log("F-13 Migration complete!");
}

runMigration().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
