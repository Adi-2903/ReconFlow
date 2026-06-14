import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import pg from "pg";

const dbUrl = process.env.DATABASE_URL;

// Force Node.js to ignore self-signed or missing issuer certificates
// This fixes the 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' error in Next.js development
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

if (!dbUrl) {
  throw new Error("DATABASE_URL environment variable is exactly required. Please set it.");
}

// Remove sslmode=require from the string because it overrides our manual SSL config below
const cleanDbUrl = dbUrl.replace("?sslmode=require", "");

export const db = dbUrl.includes("neon.tech")
  ? drizzleNeon(neon(dbUrl))
  : drizzlePg(new pg.Pool({ 
      connectionString: cleanDbUrl,
      ssl: { rejectUnauthorized: false } 
    }));
