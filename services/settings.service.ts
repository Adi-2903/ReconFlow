import { db } from "@/core/db";
import {
  auditEvents,
  matches,
  reconRuns,
  bankTransactions,
  ledgerEntries,
  users,
  canonicalTransactions,
  auditLogs,
  dailyMetrics,
  transactionCandidates,
  reconciliationRuns,
  imports,
} from "@/core/db/schema";
import { getOrCreateUserOrganization } from "@/core/db/org-helper";
import { eq } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ResetResult {
  message: string;
}

export interface DeleteAccountResult {
  message: string;
}

// ─── Service functions ────────────────────────────────────────────────────────

/**
 * Clears all reconciliation data for a user but keeps the user account intact.
 * Implements a true workspace reset by completely deleting all upload-derived data,
 * relying on ON DELETE CASCADE where configured in the schema.
 */
export async function resetReconData(userId: string): Promise<ResetResult> {
  const orgId = await getOrCreateUserOrganization(userId);

  // 1. Delete legacy tables first (they have references to canonicalTransactions without cascade)
  await db.delete(auditEvents).where(eq(auditEvents.userId, userId));
  await db.delete(matches).where(eq(matches.userId, userId));
  await db.delete(reconRuns).where(eq(reconRuns.userId, userId));
  await db.delete(bankTransactions).where(eq(bankTransactions.userId, userId));
  await db.delete(ledgerEntries).where(eq(ledgerEntries.userId, userId));

  // 2. Delete standalone upload-derived tables
  await db.delete(auditLogs).where(eq(auditLogs.organizationId, orgId));
  await db.delete(dailyMetrics).where(eq(dailyMetrics.organizationId, orgId));

  // 3. transactionCandidates references canonicalTransactions with NO CASCADE. Must delete first.
  await db.delete(transactionCandidates).where(eq(transactionCandidates.organizationId, orgId));

  // 4. reconciliationRuns cascades to: matchGroups -> matchItems, reviewQueue, aiExplanations, matchGroupClassifications
  // It also cascades to reconciliationRunTransactions.
  await db.delete(reconciliationRuns).where(eq(reconciliationRuns.organizationId, orgId));

  // 5. Now safe to delete canonicalTransactions since child references (matches, transactionCandidates, matchItems) are gone.
  await db.delete(canonicalTransactions).where(eq(canonicalTransactions.organizationId, orgId));

  // 6. imports cascades to rawRecords. Must delete AFTER canonicalTransactions since canonicalTransactions references rawRecords with NO CASCADE.
  await db.delete(imports).where(eq(imports.organizationId, orgId));

  return { message: "Reconciliation data reset successfully" };
}

/**
 * Permanently deletes a user account and all associated data.
 * This is irreversible.
 */
export async function deleteAccount(userId: string): Promise<DeleteAccountResult> {
  const orgId = await getOrCreateUserOrganization(userId);

  await resetReconData(userId);
  await db.delete(users).where(eq(users.id, userId));

  return { message: "Account deleted successfully" };
}
