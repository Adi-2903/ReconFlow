import { db } from "@/core/db";
import {
  auditEvents,
  matches,
  reconRuns,
  bankTransactions,
  ledgerEntries,
  users,
} from "@/core/db/schema";
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
 * Resets bank transaction and ledger statuses back to 'unmatched'.
 */
export async function resetReconData(userId: string): Promise<ResetResult> {
  // Must delete in dependency order (foreign keys)
  await db.delete(auditEvents).where(eq(auditEvents.userId, userId));
  await db.delete(matches).where(eq(matches.userId, userId));
  await db.delete(reconRuns).where(eq(reconRuns.userId, userId));
  await db.update(bankTransactions).set({ status: "unmatched" }).where(eq(bankTransactions.userId, userId));
  await db.update(ledgerEntries).set({ status: "unmatched" }).where(eq(ledgerEntries.userId, userId));

  return { message: "Reconciliation data reset successfully" };
}

/**
 * Permanently deletes a user account and all associated data.
 * This is irreversible.
 */
export async function deleteAccount(userId: string): Promise<DeleteAccountResult> {
  // Must delete in dependency order (foreign keys)
  await db.delete(auditEvents).where(eq(auditEvents.userId, userId));
  await db.delete(matches).where(eq(matches.userId, userId));
  await db.delete(reconRuns).where(eq(reconRuns.userId, userId));
  await db.delete(bankTransactions).where(eq(bankTransactions.userId, userId));
  await db.delete(ledgerEntries).where(eq(ledgerEntries.userId, userId));
  await db.delete(users).where(eq(users.id, userId));

  return { message: "Account deleted successfully" };
}
