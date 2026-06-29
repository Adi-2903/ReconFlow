import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";

dotenv.config();

const dbUrl = process.env.DATABASE_URL || "";
const isAurora = dbUrl.includes(".rds.amazonaws.com");

if (isAurora) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

export default defineConfig({
  schema: "./core/db/schema.ts",
  out: "./core/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: dbUrl,
    ssl: isAurora ? { rejectUnauthorized: false } : undefined,
  },
});
