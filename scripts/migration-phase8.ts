// scripts/migration-phase8.ts
//
// Phase 8 — Risk Scoring Engine: database migration and historical backfill.
//
// BACKFILL NOTE: frequencyScore is set to 0 for all historical rows.
// The original reconciliation run population is not available for past matches.
// This is Option B (accepted tradeoff) — see implementation_plan.md §Known Limitations.
// Re-run this migration once counterpartyProfiles is populated (Phase 9+) if
// session-frequency anomaly scoring for historical rows is required.

import "dotenv/config";
import { db } from "../core/db";
import { sql, inArray, eq } from "drizzle-orm";
import { matches, canonicalTransactions } from "../core/db/schema";
import { computeRiskScore } from "../core/matching/riskEngine";

async function runMigration() {
  console.log("--------------------------------------------------");
  console.log("Phase 8 — Risk Scoring Engine Migration");
  console.log("--------------------------------------------------");

  // ── Step 1: Alter table ──────────────────────────────────────────────────
  console.log("\n1. Running database alteration...");

  const alterQuery = `
    ALTER TABLE matches
    ADD COLUMN IF NOT EXISTS risk_score integer NOT NULL DEFAULT 0;
  `;

  try {
    await db.execute(sql.raw(alterQuery));
    console.log("   ✓ risk_score column added (NOT NULL DEFAULT 0).");
  } catch (e: any) {
    console.error("   ✗ Alteration failed:", e.message);
    throw e;
  }

  // ── Step 2: Batched backfill ─────────────────────────────────────────────
  console.log("\n2. Running historical backfill (frequencyScore = 0 per Option B)...");

  const BATCH_SIZE = 500;
  let offset = 0;
  let hasMore = true;
  let totalProcessed = 0;
  let totalSkipped = 0;

  while (hasMore) {
    console.log(`   Fetching matches from offset ${offset}...`);

    const matchBatch = await db
      .select()
      .from(matches)
      .orderBy(matches.id)   // deterministic pagination — prevents double-processing on restart
      .limit(BATCH_SIZE)
      .offset(offset);

    if (matchBatch.length === 0) {
      hasMore = false;
      break;
    }

    // Collect all transaction IDs needed in this batch
    const bankIds = matchBatch
      .map(m => m.bankTransactionId)
      .filter(Boolean) as string[];

    const ledgerIds: string[] = [];
    matchBatch.forEach(m => {
      if (m.ledgerEntryIds) {
        m.ledgerEntryIds.forEach(id => ledgerIds.push(id));
      }
    });

    const uniqueTxIds = Array.from(new Set([...bankIds, ...ledgerIds]));
    const txRows = uniqueTxIds.length > 0
      ? await db
          .select()
          .from(canonicalTransactions)
          .where(inArray(canonicalTransactions.id, uniqueTxIds))
      : [];

    const txMap = new Map<string, any>();
    txRows.forEach(r => txMap.set(r.id, r));

    await db.transaction(async (tx) => {
      for (const match of matchBatch) {
        const bankRow = match.bankTransactionId
          ? txMap.get(match.bankTransactionId)
          : null;

        if (!bankRow) {
          // No bank transaction — unmatched ledger entry; risk score stays 0.
          totalSkipped++;
          continue;
        }

        const matchLedgers = (match.ledgerEntryIds || [])
          .map(id => txMap.get(id))
          .filter(Boolean);

        const ledgerDates = matchLedgers.map((l: any) =>
          new Date(l.transactionDate)
        );

        // Derive confidence from stored confidenceScore (string from numeric column)
        const matchingConfidence = Math.min(
          1,
          Math.max(0, parseFloat(match.confidenceScore ?? "0"))
        );

        // Option B: pass empty arrays so frequencyScore = 0 for all historical rows.
        const breakdown = computeRiskScore({
          amountMinor: Number(bankRow.amountMinor),
          matchingConfidence,
          matchType: match.matchType ?? "none",
          discrepancyType: match.discrepancyType ?? "NONE",
          bankDate: new Date(bankRow.transactionDate),
          ledgerDates,
          allBankDescriptions: [],    // Option B — no run population available
          allBankCounterparties: [],  // Option B
          thisBankDescription: bankRow.description ?? "",
          thisBankCounterparty: bankRow.counterpartyName ?? undefined,
        });

        await tx
          .update(matches)
          .set({ riskScore: breakdown.compositeScore })
          .where(eq(matches.id, match.id));
      }
    });

    totalProcessed += matchBatch.length;
    offset += BATCH_SIZE;
    console.log(`   Processed ${totalProcessed} matches (skipped ${totalSkipped} ledger-only rows)...`);
  }

  console.log(`\n✓ Backfill complete.`);
  console.log(`  Total matches processed : ${totalProcessed}`);
  console.log(`  Ledger-only rows skipped: ${totalSkipped}`);
  console.log("\nPhase 8 Migration complete!");
}

runMigration().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
