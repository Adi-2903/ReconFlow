import "../env"; // Validate environment variables early
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import pg from "pg";

const dbUrl = process.env.DATABASE_URL!;

if (!dbUrl) {
  throw new Error("DATABASE_URL is required. Check your .env file.");
}

const isNeon = dbUrl.includes("neon.tech");
const isAurora = dbUrl.includes(".rds.amazonaws.com");

// Only bypass TLS for Aurora — local Postgres does not need this
if (isAurora) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const cleanDbUrl = dbUrl.replace("?sslmode=require", "");

export const db = isNeon
  ? drizzleNeon(neon(dbUrl))
  : drizzlePg(
    new pg.Pool({
      connectionString: cleanDbUrl,
      // Disable SSL/TLS for local Postgres, keep it enabled for remote AWS Aurora
      ssl: isAurora ? { rejectUnauthorized: false } : false,
    })
  );
