import { db } from "@/core/db";
import { connectors as dbConnectors, users } from "@/core/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrCreateUserOrganization, getOrCreateFinancialAccount } from "@/core/db/org-helper";
import { connectors } from "./connectors";
import { IngestionService } from "./ingestion.service";

export interface StripeSyncResult {
  count: number;
  message: string;
}

export interface StripeDisconnectResult {
  success: boolean;
}

export async function syncStripeTransactions(userId: string): Promise<StripeSyncResult> {
  // 1. Resolve multi-tenant organization context
  const orgId = await getOrCreateUserOrganization(userId);
  
  // 2. Resolve Stripe financial account
  const accountId = await getOrCreateFinancialAccount(orgId, "stripe", "Stripe Account");

  // 3. Retrieve or migrate credentials to connectors table
  let [conn] = await db
    .select()
    .from(dbConnectors)
    .where(
      and(
        eq(dbConnectors.organizationId, orgId),
        eq(dbConnectors.accountId, accountId)
      )
    )
    .limit(1);

  if (!conn) {
    // If not found, let's verify if user record has stripeAccessToken (from auth flow migration)
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    
    // In our new schema, users table does not store tokens. But next-auth authAccounts might have it
    // Wait, let's just throw error if not connected yet.
    throw new Error("Stripe not connected. Go to the Connect page and link your Stripe account.");
  }

  if (!conn.accessToken) {
    throw new Error("Stripe not connected. Go to the Connect page and link your Stripe account.");
  }

  // 4. Sync records via Stripe Connector (returns DTOs)
  const normalizedRecords = await connectors.stripe.sync(userId, orgId, accountId);

  // 5. Ingest records via central IngestionService
  const stats = await IngestionService.ingestConnectorRecords(orgId, accountId, "stripe", normalizedRecords);

  // Update stripeLastSync timestamp in connector settings or user profile
  await db
    .update(dbConnectors)
    .set({
      status: "connected",
    })
    .where(eq(dbConnectors.id, conn.id));

  return {
    count: stats.successCount,
    message: `Sync complete. ${stats.successCount} imported, ${stats.skippedCount} duplicates skipped, ${stats.failureCount} failed.`,
  };
}

export async function disconnectStripe(userId: string): Promise<StripeDisconnectResult> {
  const orgId = await getOrCreateUserOrganization(userId);
  const accountId = await getOrCreateFinancialAccount(orgId, "stripe", "Stripe Account");

  await connectors.stripe.disconnect(userId, orgId, accountId);
  return { success: true };
}
