import "dotenv/config";
import { db } from "../core/db";
import { sql } from "drizzle-orm";

async function resetDatabase() {
  console.log("Connecting to the database and dropping the public schema...");
  try {
    // Drop public schema cascade
    await db.execute(sql.raw("DROP SCHEMA public CASCADE;"));
    // Re-create public schema
    await db.execute(sql.raw("CREATE SCHEMA public;"));
    // Restore default privileges
    await db.execute(sql.raw("GRANT ALL ON SCHEMA public TO postgres;"));
    await db.execute(sql.raw("GRANT ALL ON SCHEMA public TO public;"));

    console.log("✅ Database public schema dropped and recreated successfully!");
    console.log("Next, run standard Drizzle schema push and seeding commands to initialize it.");
  } catch (error) {
    console.error("❌ Error resetting database:", error);
    process.exit(1);
  }
}

resetDatabase();
