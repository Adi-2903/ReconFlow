// scripts/migration-phase7.ts
import "dotenv/config";
import { db } from "../core/db";
import { sql, inArray, eq } from "drizzle-orm";
import { matches, canonicalTransactions } from "../core/db/schema";
import { classifyMatch } from "../core/matching/classifier";

async function runMigration() {
  console.log("--------------------------------------------------");
  console.log("1. Running database alterations for Phase 7...");
  console.log("--------------------------------------------------");

  const queries = [
    // Create Match Outcome enum
    `DO $$ BEGIN
      CREATE TYPE match_outcome AS ENUM ('MATCHED', 'PARTIALLY_MATCHED', 'UNMATCHED');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;`,

    // Create Discrepancy Type enum
    `DO $$ BEGIN
      CREATE TYPE discrepancy_type AS ENUM ('NONE', 'TIMING_DIFFERENCE', 'PROCESSING_FEE', 'FOREIGN_EXCHANGE', 'TYPO', 'DUPLICATE', 'MISSING_ENTRY');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;`,

    // Add matchOutcome column
    `ALTER TABLE matches ADD COLUMN IF NOT EXISTS match_outcome match_outcome;`,

    // Add discrepancyType column
    `ALTER TABLE matches ADD COLUMN IF NOT EXISTS discrepancy_type discrepancy_type;`,

    // Add classificationEvidence column
    `ALTER TABLE matches ADD COLUMN IF NOT EXISTS classification_evidence jsonb;`
  ];

  for (const q of queries) {
    try {
      console.log(`Executing: ${q.substring(0, 100).trim()}...`);
      await db.execute(sql.raw(q));
    } catch (e: any) {
      console.error(`Query failed:`, e.message);
      throw e;
    }
  }
  console.log("Database alterations completed successfully.");

  console.log("\n--------------------------------------------------");
  console.log("2. Running historical matches backfill job...");
  console.log("--------------------------------------------------");

  const BATCH_SIZE = 500;
  let offset = 0;
  let hasMore = true;
  let totalProcessed = 0;

  // Retrieve all bank transactions to help with duplicate checks
  const allBanksData = await db
    .select({
      id: canonicalTransactions.id,
      amountMinor: canonicalTransactions.amountMinor,
      transactionDate: canonicalTransactions.transactionDate,
      description: canonicalTransactions.description,
      referenceNumber: canonicalTransactions.referenceNumber,
      counterpartyName: canonicalTransactions.counterpartyName,
    })
    .from(canonicalTransactions)
    .where(eq(canonicalTransactions.side, "money"));

  const allBanksForDuplicate = allBanksData.map(b => ({
    amount: Number(b.amountMinor),
    date: new Date(b.transactionDate),
    description: b.description || "",
    referenceId: b.referenceNumber || "",
    counterparty: b.counterpartyName || undefined
  }));

  while (hasMore) {
    console.log(`Fetching matches from offset ${offset}...`);
    const matchBatch = await db
      .select()
      .from(matches)
      .limit(BATCH_SIZE)
      .offset(offset);

    if (matchBatch.length === 0) {
      hasMore = false;
      break;
    }

    // Collect all canonical transaction IDs needed
    const bankIds = matchBatch.map(m => m.bankTransactionId).filter(Boolean) as string[];
    const ledgerIds: string[] = [];
    matchBatch.forEach(m => {
      if (m.ledgerEntryIds) {
        m.ledgerEntryIds.forEach(id => ledgerIds.push(id));
      }
    });

    // Batch-query canonical transactions in this chunk
    const uniqueTxIds = Array.from(new Set([...bankIds, ...ledgerIds]));
    const txRows = uniqueTxIds.length > 0
      ? await db
          .select()
          .from(canonicalTransactions)
          .where(inArray(canonicalTransactions.id, uniqueTxIds))
      : [];

    const txMap = new Map<string, any>();
    txRows.forEach(r => txMap.set(r.id, r));

    // Update matches in a single transaction per batch for speed
    await db.transaction(async (tx) => {
      for (const match of matchBatch) {
        const bankRow = match.bankTransactionId ? txMap.get(match.bankTransactionId) : null;
        if (!bankRow) {
          // If no bank row found, skip or set defaults
          await tx
            .update(matches)
            .set({
              matchOutcome: "UNMATCHED",
              discrepancyType: "NONE",
              classificationEvidence: []
            })
            .where(eq(matches.id, match.id));
          continue;
        }

        const matchLedgers = (match.ledgerEntryIds || [])
          .map(id => txMap.get(id))
          .filter(Boolean);

        const classifierBank = {
          amount: Number(bankRow.amountMinor),
          date: new Date(bankRow.transactionDate),
          description: bankRow.description || "",
          referenceId: bankRow.referenceNumber || "",
          counterparty: bankRow.counterpartyName || undefined,
          currency: bankRow.currency || undefined,
          baseCurrency: bankRow.baseCurrency || undefined,
          convertedAmountMinor: bankRow.convertedAmountMinor ? Number(bankRow.convertedAmountMinor) : undefined,
          matchingSignals: bankRow.metadata?.matchingSignals || undefined
        };

        const classifierLedgers = matchLedgers.map(l => ({
          amount: Number(l.amountMinor),
          date: new Date(l.transactionDate),
          memo: l.description || "",
          invoiceRef: l.referenceNumber || "",
          counterparty: l.counterpartyName || undefined,
          currency: l.currency || undefined,
          baseCurrency: l.baseCurrency || undefined,
          convertedAmountMinor: l.convertedAmountMinor ? Number(l.convertedAmountMinor) : undefined,
          matchingSignals: l.metadata?.matchingSignals || undefined
        }));

        const classification = classifyMatch(
          classifierBank,
          classifierLedgers,
          match.matchType || "none",
          [], // backfill does not have raw matching reasons
          allBanksForDuplicate
        );

        await tx
          .update(matches)
          .set({
            matchOutcome: classification.matchOutcome,
            discrepancyType: classification.discrepancyType,
            classificationEvidence: classification.evidence
          })
          .where(eq(matches.id, match.id));
      }
    });

    totalProcessed += matchBatch.length;
    offset += BATCH_SIZE;
    console.log(`Processed ${totalProcessed} matches so far.`);
  }

  console.log(`\nBackfill completed successfully. Total matches updated: ${totalProcessed}`);
  console.log("Phase 7 Migration complete!");
}

runMigration().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
