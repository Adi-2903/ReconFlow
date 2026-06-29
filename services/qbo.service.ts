import { db } from "@/core/db";
import { connectors as dbConnectors } from "@/core/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrCreateUserOrganization, getOrCreateFinancialAccount } from "@/core/db/org-helper";
import { connectors } from "./connectors";
import { IngestionService } from "./ingestion.service";

export interface QboSyncResult {
  count: number;
  message: string;
  breakdown?: {
    invoices: number;
    payments: number;
    deposits: number;
  };
}

export interface QboDisconnectResult {
  success: boolean;
}

export async function syncQboData(
  userId: string,
  appBaseUrl: string
): Promise<QboSyncResult> {
  // 1. Resolve multi-tenant organization context
  const orgId = await getOrCreateUserOrganization(userId);
  
  // 2. Resolve QuickBooks financial account
  const accountId = await getOrCreateFinancialAccount(orgId, "quickbooks", "QuickBooks Ledger");

  // 3. Verify connection
  const [conn] = await db
    .select()
    .from(dbConnectors)
    .where(
      and(
        eq(dbConnectors.organizationId, orgId),
        eq(dbConnectors.accountId, accountId)
      )
    )
    .limit(1);

  if (!conn || !conn.accessToken) {
    throw new Error("QuickBooks is not connected");
  }

  // 4. Sync QBO records via Connector (returns DTOs)
  const normalizedRecords = await connectors.quickbooks.sync(userId, orgId, accountId, { appBaseUrl });

  // 5. Ingest records via central IngestionService
  const stats = await IngestionService.ingestConnectorRecords(orgId, accountId, "quickbooks", normalizedRecords);

  // Parse breakdown details from normalizedRecords types
  const invoicesCount = normalizedRecords.filter((r) => r.transactionType === "INVOICE").length;
  const paymentsCount = normalizedRecords.filter((r) => r.transactionType === "PAYMENT").length;
  const depositsCount = normalizedRecords.filter((r) => r.transactionType === "DEPOSIT").length;

  return {
    count: stats.successCount,
    message: `Sync complete. ${stats.successCount} imported, ${stats.skippedCount} duplicates skipped, ${stats.failureCount} failed.`,
    breakdown: {
      invoices: invoicesCount,
      payments: paymentsCount,
      deposits: depositsCount,
    },
  };
}

export async function disconnectQbo(userId: string): Promise<QboDisconnectResult> {
  const orgId = await getOrCreateUserOrganization(userId);
  const accountId = await getOrCreateFinancialAccount(orgId, "quickbooks", "QuickBooks Ledger");

  await connectors.quickbooks.disconnect(userId, orgId, accountId);
  return { success: true };
}
