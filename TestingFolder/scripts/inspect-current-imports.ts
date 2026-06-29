import { db } from "../../core/db";
import { canonicalTransactions, imports, rawRecords } from "../../core/db/schema";
import { desc, eq } from "drizzle-orm";

async function main() {
  const recentImports = await db.select().from(imports).orderBy(desc(imports.createdAt)).limit(5);
  console.log("RECENT IMPORTS:");
  console.log(recentImports.map(i => ({
    id: i.id,
    filename: i.filename,
    sourceType: i.sourceType,
    status: i.status,
    successCount: i.successCount,
    skippedCount: i.skippedCount,
    failureCount: i.failureCount
  })));

  for (const imp of recentImports) {
    const txns = await db.select({
      id: canonicalTransactions.id,
      side: canonicalTransactions.side,
      direction: canonicalTransactions.direction,
      amountMinor: canonicalTransactions.amountMinor,
      currency: canonicalTransactions.currency,
      referenceNumber: canonicalTransactions.referenceNumber,
      counterpartyName: canonicalTransactions.counterpartyName,
      description: canonicalTransactions.description,
      rawRecordId: canonicalTransactions.rawRecordId,
      importId: rawRecords.importId
    })
    .from(canonicalTransactions)
    .innerJoin(rawRecords, eq(canonicalTransactions.rawRecordId, rawRecords.id))
    .where(eq(rawRecords.importId, imp.id));
    
    console.log(`\nTransactions for import: ${imp.filename} (${imp.sourceType}) - Total: ${txns.length}`);
    if (txns.length > 0) {
      console.log(txns.slice(0, 15).map(t => ({
        id: t.id,
        side: t.side,
        direction: t.direction,
        amount: Number(t.amountMinor) / 100,
        currency: t.currency,
        referenceNumber: t.referenceNumber,
        counterparty: t.counterpartyName,
        desc: t.description?.substring(0, 30)
      })));
    }
  }
}

main().catch(console.error);
