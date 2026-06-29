import "dotenv/config";
import path from "path";
import fs from "fs";
import { db } from "../../core/db";
import { organizations, financialAccounts, canonicalTransactions } from "../../core/db/schema";
import { IngestionService } from "../../services/ingestion.service";
import { runMatcher } from "../matching/runMatcher";
import { eq } from "drizzle-orm";
import { CanonicalTransaction } from "../types/CanonicalTransaction";

async function main() {
  console.log("\n==================================================");
  console.log("RECONFLOW PIPELINE TEST DATA VALIDATION");
  console.log("==================================================\n");

  // 1. Setup isolated organization & accounts
  console.log("Setting up temporary test organization and accounts...");
  const orgName = "Pipeline Test Org - " + Date.now();
  const [org] = await db.insert(organizations).values({
    name: orgName,
    baseCurrency: "INR",
  }).returning();
  console.log(`  Created Test Org: "${org.name}" (ID: ${org.id})`);

  const [hdfcAccount] = await db.insert(financialAccounts).values({
    organizationId: org.id,
    accountType: "bank",
    name: "HDFC Test Account",
    baseCurrency: "INR",
    metadata: { locale: "en-IN" },
  }).returning();
  console.log(`  Created Bank Account: "${hdfcAccount.name}" (ID: ${hdfcAccount.id})`);

  const [qbAccount] = await db.insert(financialAccounts).values({
    organizationId: org.id,
    accountType: "quickbooks",
    name: "QuickBooks Test Account",
    baseCurrency: "INR",
    metadata: { locale: "en-US" },
  }).returning();
  console.log(`  Created QuickBooks Account: "${qbAccount.name}" (ID: ${qbAccount.id})`);

  // 2. Ingest CSV Files
  console.log("\nIngesting test CSV files...");
  const bankPath = path.join(__dirname, "..", "data", "test_pipeline_bank.csv");
  const ledgerPath = path.join(__dirname, "..", "data", "test_pipeline_ledger.csv");

  const bankBuffer = fs.readFileSync(bankPath);
  const ledgerBuffer = fs.readFileSync(ledgerPath);

  const bankColumnMap = {
    date: "Date",
    description: "Narration",
    reference: "Chq./Ref.No.",
    debit: "Withdrawal Amt.",
    credit: "Deposit Amt."
  };

  const qbColumnMap = {
    date: "TxnDate",
    description: "Memo",
    reference: "DocNumber",
    amount: "TotalAmt",
    counterparty: "CustomerVendorRef"
  };

  console.log("  Ingesting test_pipeline_bank.csv...");
  const bankIngest = await IngestionService.importFileTransactions(
    org.id,
    hdfcAccount.id,
    bankBuffer,
    "test_pipeline_bank.csv",
    "bank_csv",
    bankColumnMap
  );
  console.log(`    Success: ${bankIngest.successCount}, Skipped: ${bankIngest.skippedCount}, Failed: ${bankIngest.failureCount}`);

  console.log("  Ingesting test_pipeline_ledger.csv...");
  const ledgerIngest = await IngestionService.importFileTransactions(
    org.id,
    qbAccount.id,
    ledgerBuffer,
    "test_pipeline_ledger.csv",
    "qbo_export",
    qbColumnMap
  );
  console.log(`    Success: ${ledgerIngest.successCount}, Skipped: ${ledgerIngest.skippedCount}, Failed: ${ledgerIngest.failureCount}`);

  // 3. Retrieve Canonical Transactions
  const allTxns = await db.select({
    id: canonicalTransactions.id,
    organizationId: canonicalTransactions.organizationId,
    accountId: canonicalTransactions.accountId,
    sourceSystem: canonicalTransactions.sourceSystem,
    side: canonicalTransactions.side,
    direction: canonicalTransactions.direction,
    transactionDate: canonicalTransactions.transactionDate,
    amountMinor: canonicalTransactions.amountMinor,
    currency: canonicalTransactions.currency,
    referenceNumber: canonicalTransactions.referenceNumber,
    counterpartyName: canonicalTransactions.counterpartyName,
    description: canonicalTransactions.description,
    sourceTransactionId: canonicalTransactions.sourceTransactionId,
    baseCurrency: canonicalTransactions.baseCurrency,
    convertedAmountMinor: canonicalTransactions.convertedAmountMinor,
    fxStatus: canonicalTransactions.fxStatus,
    metadata: canonicalTransactions.metadata
  }).from(canonicalTransactions).where(eq(canonicalTransactions.organizationId, org.id));
  console.log(`\nRetrieved ${allTxns.length} canonical transactions from database.`);

  const bankTxns = allTxns.filter(t => t.side === "money").map(mapDbRowToCanonical);
  const bookTxns = allTxns.filter(t => t.side === "books").map(mapDbRowToCanonical);

  console.log(`  Bank (Money) Side: ${bankTxns.length} transactions`);
  console.log(`  Ledger (Books) Side: ${bookTxns.length} transactions`);

  // 4. Run matching engine
  console.log("\nRunning Matching Engine...");
  const matches = runMatcher(bankTxns, bookTxns);
  console.log(`  Generated ${matches.length} matches.\n`);

  // 5. Verify the matches
  console.log("--------------------------------------------------");
  console.log("DETAILED MATCH AUDIT REPORT");
  console.log("--------------------------------------------------");

  let exactMatchCount = 0;
  let partialMatchCount = 0;
  let timingMatchCount = 0;
  let feeAdjustmentMatchCount = 0;
  let typoMatchCount = 0;

  for (const match of matches) {
    const bankDetails = match.bankTransactionIds.map(id => {
      const t = bankTxns.find(x => x.id === id);
      return `${t?.referenceNumber || "N/A"} (${t?.description || "N/A"}, Amt: ${t?.amount})`;
    }).join(", ");

    const bookDetails = match.bookTransactionIds.map(id => {
      const t = bookTxns.find(x => x.id === id);
      return `${t?.referenceNumber || "N/A"} (Vendor/Cust: ${t?.counterparty || "N/A"}, Amt: ${t?.amount})`;
    }).join(", ");

    console.log(`Match Type: ${match.matchType.toUpperCase()}`);
    console.log(`  Score: ${match.score} (${match.confidenceBand} confidence)`);
    console.log(`  Bank Side:   [${bankDetails}]`);
    console.log(`  Ledger Side: [${bookDetails}]`);
    console.log(`  Explanation: ${match.explanation || "None"}\n`);

    if (match.matchType === "exact") {
      exactMatchCount++;
    } else if (match.matchType === "one_to_many" || match.matchType === "many_to_one") {
      // Depending on rules, partial payments could be categorized under other types or fee adjustments
      partialMatchCount++;
    } else if (match.matchType === "fee_adjustment") {
      feeAdjustmentMatchCount++;
    } else {
      // Check if typo/timing matches occurred
      const bankRef = bankTxns.find(x => x.id === match.bankTransactionIds[0])?.referenceNumber;
      const bookRef = bookTxns.find(x => x.id === match.bookTransactionIds[0])?.referenceNumber;
      if (bankRef === "INV-9008" || bookRef === "INV-9008") {
        typoMatchCount++;
      } else if (bankRef === "INV-9006" || bookRef === "INV-9006") {
        timingMatchCount++;
      }
    }
  }

  // Find unmatched items
  const matchedBankIds = new Set(matches.flatMap(m => m.bankTransactionIds));
  const matchedBookIds = new Set(matches.flatMap(m => m.bookTransactionIds));

  const unmatchedBank = bankTxns.filter(t => !matchedBankIds.has(t.id));
  const unmatchedBook = bookTxns.filter(t => !matchedBookIds.has(t.id));

  console.log("--------------------------------------------------");
  console.log("UNMATCHED EXCEPTIONS");
  console.log("--------------------------------------------------");
  console.log("Unmatched Bank Transactions:");
  if (unmatchedBank.length === 0) {
    console.log("  None");
  } else {
    unmatchedBank.forEach(t => {
      console.log(`  - Ref: ${t.referenceNumber || "N/A"} | Narration: "${t.description}" | Amt: ${t.amount}`);
    });
  }

  console.log("\nUnmatched Ledger Transactions:");
  if (unmatchedBook.length === 0) {
    console.log("  None");
  } else {
    unmatchedBook.forEach(t => {
      console.log(`  - Ref: ${t.referenceNumber || "N/A"} | Memo: "${t.description}" | Amt: ${t.amount}`);
    });
  }

  console.log("\n==================================================");
  console.log("VALIDATION SUMMARY");
  console.log("==================================================");
  console.log(`  Exact Matches (100% Match): ${exactMatchCount} (Expected: 5)`);
  console.log(`  Unmatched Bank Exceptions:  ${unmatchedBank.length} (Expected: 1)`);
  console.log(`  Unmatched Ledger Exceptions: ${unmatchedBook.length} (Expected: 1)`);
  console.log(`  Total Ingested Bank:        ${bankTxns.length}`);
  console.log(`  Total Ingested Ledger:      ${bookTxns.length}`);
  console.log("==================================================\n");
}

function mapDbRowToCanonical(row: any): CanonicalTransaction {
  return {
    id: row.id,
    source: row.sourceSystem === "quickbooks" ? "quickbooks" : (row.sourceSystem === "tally" ? "tally" : "bank"),
    transactionDate: new Date(row.transactionDate),
    amount: Number(row.amountMinor) / 100,
    amountMinor: row.amountMinor,
    direction: row.direction === "inflow" ? "credit" : "debit",
    counterparty: row.counterpartyName || undefined,
    referenceNumber: row.referenceNumber || undefined,
    description: row.description || undefined,
    sourceId: row.sourceTransactionId || row.id,
    currency: row.currency || undefined,
    baseCurrency: row.baseCurrency || undefined,
    convertedAmountMinor: row.convertedAmountMinor ? BigInt(row.convertedAmountMinor) : undefined,
    fxStatus: row.fxStatus as any,
    metadata: row.metadata || {},
    matchingSignals: row.metadata?.matchingSignals || {}
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
