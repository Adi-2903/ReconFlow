import { db } from "../../core/db";
import { canonicalTransactions, imports, rawRecords, matchItems, matchGroups, reconciliationRuns, reconciliationRunTransactions, transactionCandidates, reconRuns, matches } from "../../schema";
import { desc, eq, inArray, gt } from "drizzle-orm";

async function main() {
  console.log("Locating imports created in the last 2 hours...");
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  
  const recentImports = await db.select().from(imports).where(gt(imports.createdAt, twoHoursAgo));
  if (recentImports.length === 0) {
    console.log("No recent imports found.");
    return;
  }

  console.log(`Found ${recentImports.length} recent imports to delete:`);
  console.log(recentImports.map(i => `${i.filename} (${i.sourceType}, ID: ${i.id})`));

  const importIds = recentImports.map(i => i.id);

  // 1. Get raw records
  const rawRecs = await db.select({ id: rawRecords.id }).from(rawRecords).where(inArray(rawRecords.importId, importIds));
  const rawRecordIds = rawRecs.map(r => r.id);

  if (rawRecordIds.length > 0) {
    // 2. Get canonical transactions
    const txns = await db.select({ id: canonicalTransactions.id }).from(canonicalTransactions).where(inArray(canonicalTransactions.rawRecordId, rawRecordIds));
    const txnIds = txns.map(t => t.id);

    if (txnIds.length > 0) {
      console.log(`Deleting references for ${txnIds.length} canonical transactions...`);
      
      // Delete match items
      await db.delete(matchItems).where(inArray(matchItems.transactionId, txnIds));
      
      // Delete run transaction links
      await db.delete(reconciliationRunTransactions).where(inArray(reconciliationRunTransactions.transactionId, txnIds));
      
      // Delete candidates
      await db.delete(transactionCandidates).where(inArray(transactionCandidates.sourceTransactionId, txnIds));
      await db.delete(transactionCandidates).where(inArray(transactionCandidates.candidateTransactionId, txnIds));
      
      // Delete legacy matches if any link to them
      await db.delete(matches).where(inArray(matches.bankTransactionId, txnIds));
      
      // Delete canonical transactions
      await db.delete(canonicalTransactions).where(inArray(canonicalTransactions.id, txnIds));
    }

    console.log(`Deleting ${rawRecordIds.length} raw records...`);
    await db.delete(rawRecords).where(inArray(rawRecords.id, rawRecordIds));
  }

  console.log("Deleting matches, match groups and reconciliation runs from last 2 hours...");
  // Clear reconciliation runs and match groups created in last 2 hours
  await db.delete(matchGroups).where(gt(matchGroups.createdAt, twoHoursAgo));
  await db.delete(reconciliationRuns).where(gt(reconciliationRuns.startedAt, twoHoursAgo));
  await db.delete(reconRuns).where(gt(reconRuns.createdAt, twoHoursAgo));

  console.log(`Deleting ${importIds.length} imports...`);
  await db.delete(imports).where(inArray(imports.id, importIds));

  console.log("Cleanup completed successfully! You can now re-upload and re-run reconciliation.");
}

main().catch(console.error);
