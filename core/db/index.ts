import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import pg from "pg";

const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  throw new Error("DATABASE_URL environment variable is exactly required. Please set it.");
}

export const db = dbUrl.includes("neon.tech")
  ? drizzleNeon(neon(dbUrl))
  : drizzlePg(new pg.Pool({ connectionString: dbUrl }));
