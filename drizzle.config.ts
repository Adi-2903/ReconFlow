import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";

dotenv.config();

// Aurora RDS uses self-signed certs — append sslmode=no-verify to bypass cert validation
const rawDbUrl = process.env.DATABASE_URL || "postgresql://postgres:RachitNisargAditya123@reconflow-db.cluster-cexsiacyin2y.us-east-1.rds.amazonaws.com:5432/reconflow";
const dbUrl = rawDbUrl.includes("rds.amazonaws.com") && !rawDbUrl.includes("sslmode")
  ? `${rawDbUrl}?sslmode=no-verify`
  : rawDbUrl;

export default defineConfig({
  schema: "./core/db/schema.ts",
  out: "./core/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: dbUrl,
  },
});
