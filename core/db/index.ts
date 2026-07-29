/**
 * core/db/index.ts — Database connection for Vercel + Neon
 *
 * Uses the Neon serverless driver in WebSocket mode (not HTTP) so that
 * db.transaction(), FOR UPDATE NOWAIT, and pg_advisory_xact_lock all work
 * correctly on Vercel's serverless platform.
 *
 * The HTTP driver (neon()) is stateless and does NOT support transactions.
 * The WebSocket driver (Pool from @neondatabase/serverless) does.
 */
import "../env"; // Validate environment variables early
import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import { drizzle as drizzlePg } from "drizzle-orm/neon-serverless";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import pg from "pg";
import ws from "ws";

// Enable WebSocket connections for Neon serverless driver in Node.js
neonConfig.webSocketConstructor = ws;

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

/**
 * Neon WebSocket mode: supports db.transaction(), FOR UPDATE, advisory locks.
 * Falls back to standard pg.Pool for Aurora or local Postgres.
 */
export const db = isNeon
  ? drizzlePg(new NeonPool({ connectionString: dbUrl }))
  : drizzleNodePg(
    new pg.Pool({
      connectionString: dbUrl,
      // Disable SSL/TLS for local Postgres, keep it enabled for remote AWS Aurora
      ssl: isAurora ? { rejectUnauthorized: false } : false,
    })
  );
