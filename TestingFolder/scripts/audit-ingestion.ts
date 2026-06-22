import "dotenv/config";
import path from "path";
import fs from "fs";
import { db } from "../../core/db";
import { organizations, financialAccounts, fxRates, canonicalTransactions, imports, rawRecords, matches, reconRuns } from "../../schema";
import { IngestionService } from "../../services/ingestion.service";
import { CleaningService } from "../../services/cleaning.service";
import { runMatcher } from "../matching/runMatcher";
import { eq, and } from "drizzle-orm";
import { CanonicalTransaction } from "../types/CanonicalTransaction";

async function main() {
  console.log("\n==================================================");
  console.log("RECONFLOW INGESTION & MATCHING AUDIT HARNESS");
  console.log("==================================================\n");

  // --------------------------------------------------------------------------
  // PART 1: Parser unit tests for CleaningService.normalizeAmount
  // --------------------------------------------------------------------------
  console.log("--------------------------------------------------");
  console.log("1. Running amount normalization parser tests...");
  console.log("--------------------------------------------------");
  
  const cleaningService = new CleaningService({
    defaultCurrency: "INR",
    inferredDateFormat: "YYYY-MM-DD",
    accountLocale: "en-IN",
    accountCurrency: "INR",
    orgCurrency: "INR",
  });

  const checkNormalized = (amountVal: string, expectedMinor: bigint, expectedDirection: "inflow" | "outflow") => {
    const res = cleaningService.normalizeAmount(amountVal);
    if (res.amountMinor !== expectedMinor || res.direction !== expectedDirection) {
      throw new Error(`Assertion failed: normalizeAmount('${amountVal}') expected amountMinor=${expectedMinor} and direction=${expectedDirection}, got amountMinor=${res.amountMinor} and direction=${res.direction}`);
    }
    console.log(`  PASSED: normalizeAmount('${amountVal}') -> amountMinor=${res.amountMinor}, direction=${res.direction}`);
  };

  checkNormalized("Rs. 9,450.00", 945000n, "inflow");
  checkNormalized("(9,450.00)", 945000n, "outflow");
  checkNormalized("Rs.(9,450.00)", 945000n, "outflow");
  checkNormalized("-Rs. 9,450.00", 945000n, "outflow");
  checkNormalized("0", 0n, "inflow");

  // Test loud failure for invalid amount "ABCXYZ"
  try {
    cleaningService.normalizeAmount("ABCXYZ");
    throw new Error("Assertion failed: normalizeAmount('ABCXYZ') should have thrown but didn't");
  } catch (err: any) {
    if (err.message.includes("AmountParseError")) {
      console.log("  PASSED: normalizeAmount('ABCXYZ') correctly threw AmountParseError");
    } else {
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // PART 2: Isolated DB Setup (Fresh Organization)
  // --------------------------------------------------------------------------
  console.log("\n--------------------------------------------------");
  console.log("2. Setting up fresh organization and accounts...");
  console.log("--------------------------------------------------");
  
  const orgName = "Audit Org - " + Date.now();
  const [org] = await db.insert(organizations).values({
    name: orgName,
    baseCurrency: "INR",
  }).returning();
  console.log(`  Created Organization: "${org.name}" (ID: ${org.id})`);

  const [hdfcAccount] = await db.insert(financialAccounts).values({
    organizationId: org.id,
    accountType: "bank",
    name: "HDFC Bank Statement Account",
    baseCurrency: "INR",
    metadata: { locale: "en-IN" },
  }).returning();
  console.log(`  Created Bank Account: "${hdfcAccount.name}" (ID: ${hdfcAccount.id})`);

  const [qbAccount] = await db.insert(financialAccounts).values({
    organizationId: org.id,
    accountType: "quickbooks",
    name: "QuickBooks Ledger Account",
    baseCurrency: "INR",
    metadata: { locale: "en-US" }, // MM/DD/YYYY parsing locale
  }).returning();
  console.log(`  Created QuickBooks Account: "${qbAccount.name}" (ID: ${qbAccount.id})`);

  const [stripeAccount] = await db.insert(financialAccounts).values({
    organizationId: org.id,
    accountType: "stripe",
    name: "Stripe Processor Account",
    baseCurrency: "INR",
    metadata: { locale: "en-US" },
  }).returning();
  console.log(`  Created Stripe Account: "${stripeAccount.name}" (ID: ${stripeAccount.id})`);

  // Insert System FX rates for USD/INR on relevant dates
  // rate stored in baseCurrency = INR, quoteCurrency = USD represents price of 1 INR in USD.
  // 1 USD = 83.1 INR -> 1 INR = 0.01203369 USD.
  // 1 USD = 83.2 INR -> 1 INR = 0.01201923 USD.
  await db.insert(fxRates).values([
    { baseCurrency: "INR", quoteCurrency: "USD", rateDate: "2026-01-14", exchangeRate: "0.01203369" },
    { baseCurrency: "INR", quoteCurrency: "USD", rateDate: "2026-01-17", exchangeRate: "0.01201923" }
  ]).onConflictDoNothing();
  console.log("  Populated FX rate mappings for USD/INR conversion.");

  // --------------------------------------------------------------------------
  // PART 3: CSV File Ingestion and Duplicate Protection Assertions
  // --------------------------------------------------------------------------
  console.log("\n--------------------------------------------------");
  console.log("3. Ingesting raw CSV statement files...");
  console.log("--------------------------------------------------");

  const hdfcPath = path.join(__dirname, "..", "data", "HDFC_Bluepeak_CurrentAC_Jan2026.csv");
  const qbPath = path.join(__dirname, "..", "data", "QuickBooks_Invoices_Bills_Export_Jan2026.csv");
  const stripePath = path.join(__dirname, "..", "data", "Stripe_Balance_Itemized_Jan2026.csv");

  const hdfcBuffer = fs.readFileSync(hdfcPath);
  const qbBuffer = fs.readFileSync(qbPath);
  const stripeBuffer = fs.readFileSync(stripePath);

  const hdfcColumnMap = {
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

  const stripeColumnMap = {
    date: "created_utc",
    description: "description",
    amount: "net",
    reference: "balance_transaction_id",
    counterparty: "customer_email"
  };

  console.log("  Ingesting HDFC bank statement...");
  const hdfcIngest1 = await IngestionService.importFileTransactions(org.id, hdfcAccount.id, hdfcBuffer, "HDFC_Bluepeak_CurrentAC_Jan2026.csv", "bank_csv", hdfcColumnMap);
  console.log(`    Success: ${hdfcIngest1.successCount}, Skipped: ${hdfcIngest1.skippedCount}, Failed: ${hdfcIngest1.failureCount}`);

  console.log("  Ingesting QuickBooks ledger export...");
  const qbIngest1 = await IngestionService.importFileTransactions(org.id, qbAccount.id, qbBuffer, "QuickBooks_Invoices_Bills_Export_Jan2026.csv", "qbo_export", qbColumnMap);
  console.log(`    Success: ${qbIngest1.successCount}, Skipped: ${qbIngest1.skippedCount}, Failed: ${qbIngest1.failureCount}`);

  console.log("  Ingesting Stripe balance itemized...");
  const stripeIngest1 = await IngestionService.importFileTransactions(org.id, stripeAccount.id, stripeBuffer, "Stripe_Balance_Itemized_Jan2026.csv", "stripe_export", stripeColumnMap);
  console.log(`    Success: ${stripeIngest1.successCount}, Skipped: ${stripeIngest1.skippedCount}, Failed: ${stripeIngest1.failureCount}`);

  // Fetch initial transaction lists to confirm unique deterministic hashes and scaling
  const allTxnsRun1 = await db.select().from(canonicalTransactions).where(eq(canonicalTransactions.organizationId, org.id));
  console.log(`  Total transactions ingested: ${allTxnsRun1.length}`);

  // Assert scaling for INV-2001 is exactly 118500.00 -> 11850000 paise (scaled once)
  const inv2001 = allTxnsRun1.find(t => t.referenceNumber === "INV-2001");
  if (!inv2001) throw new Error("Could not find INV-2001 row in database");
  if (inv2001.amountMinor !== 11850000n) {
    throw new Error(`INV-2001 amountMinor scaling error: expected 11850000n, got ${inv2001.amountMinor}`);
  }
  console.log("  PASSED: INV-2001 scaled exactly once to 11850000 paise.");

  // Assert duplicate protection on running ingestion a second time
  console.log("  Running second ingestion run to assert duplicate protection...");
  const hdfcIngest2 = await IngestionService.importFileTransactions(org.id, hdfcAccount.id, hdfcBuffer, "HDFC_Bluepeak_CurrentAC_Jan2026.csv", "bank_csv", hdfcColumnMap).catch(err => {
    // If it throws an error that file is already uploaded, that is correct behavior!
    return { successCount: 0, skippedCount: 0, failureCount: 0, error: err.message };
  });
  
  const allTxnsRun2 = await db.select().from(canonicalTransactions).where(eq(canonicalTransactions.organizationId, org.id));
  if (allTxnsRun2.length !== allTxnsRun1.length) {
    throw new Error(`Assertion failed: Ingestion run 2 added ${allTxnsRun2.length - allTxnsRun1.length} duplicate transactions!`);
  }
  console.log("  PASSED: Deduplication protection verified (no duplicates inserted).");

  // --------------------------------------------------------------------------
  // PART 4: Verification of Direction & Currency Mappings
  // --------------------------------------------------------------------------
  console.log("\n--------------------------------------------------");
  console.log("4. Verifying direction and currency mappings...");
  console.log("--------------------------------------------------");

  // Sample transactions for direction audit
  const atmWdl = allTxnsRun1.find(t => t.description && t.description.includes("ATM CASH WDL"));
  const gstPay = allTxnsRun1.find(t => t.description && t.description.includes("GST PAYMENT"));
  const e1Bank = allTxnsRun1.find(t => t.description && t.description.includes("E1 TEST"));
  const bill3001 = allTxnsRun1.find(t => t.referenceNumber === "BILL-3001");

  if (!atmWdl || atmWdl.direction !== "outflow") throw new Error(`ATM Withdrawal direction expected 'outflow', got '${atmWdl?.direction}'`);
  if (!gstPay || gstPay.direction !== "outflow") throw new Error(`GST Payment direction expected 'outflow', got '${gstPay?.direction}'`);
  if (!e1Bank || e1Bank.direction !== "inflow") throw new Error(`E1 Bank row direction expected 'inflow', got '${e1Bank?.direction}'`);
  if (!bill3001 || bill3001.direction !== "outflow") throw new Error(`BILL-3001 ledger bill direction expected 'outflow', got '${bill3001?.direction}'`);
  if (!inv2001 || inv2001.direction !== "inflow") throw new Error(`INV-2001 ledger invoice direction expected 'inflow', got '${inv2001?.direction}'`);

  console.log("  PASSED: Direction mappings correct (debits/bills -> outflow, deposits/invoices -> inflow).");

  // Currency populating audit
  const usdInvoice = allTxnsRun1.find(t => t.referenceNumber === "INV-2060");
  if (!usdInvoice || usdInvoice.currency !== "USD") throw new Error(`INV-2060 currency expected 'USD', got '${usdInvoice?.currency}'`);
  if (usdInvoice.baseCurrency !== "INR" || !usdInvoice.convertedAmountMinor || usdInvoice.fxStatus !== "CONVERTED") {
    throw new Error(`INV-2060 conversion mapping failed: baseCurrency=${usdInvoice?.baseCurrency}, fxStatus=${usdInvoice?.fxStatus}, convertedAmountMinor=${usdInvoice?.convertedAmountMinor}`);
  }
  console.log("  PASSED: Currency populating and conversion mapped correctly.");

  // --------------------------------------------------------------------------
  // PART 5: Execute Matching Engine & Verification Against Ground Truth Outcome
  // --------------------------------------------------------------------------
  console.log("\n--------------------------------------------------");
  console.log("5. Running matching engine and auditing outcomes...");
  console.log("--------------------------------------------------");

  const bankTxns = allTxnsRun1.filter(t => t.side === "money").map(mapDbRowToCanonical);
  const bookTxns = allTxnsRun1.filter(t => t.side === "books").map(mapDbRowToCanonical);
  console.log("X4 bank txns:", bankTxns.filter(t => t.description && t.description.includes("X4")));
  console.log("X4 book txns:", bookTxns.filter(t => t.referenceNumber && t.referenceNumber.includes("INV-207")));

  console.log(`  Matching ${bankTxns.length} bank transactions against ${bookTxns.length} book transactions...`);
  const generatedMatches = runMatcher(bankTxns, bookTxns);
  console.log(`  Generated ${generatedMatches.length} match records.`);
  for (const m of generatedMatches) {
    const bankDesc = m.bankTransactionIds.map(id => bankTxns.find(t => t.id === id)?.description).join(", ");
    const bookRefs = m.bookTransactionIds.map(id => bookTxns.find(t => t.id === id)?.referenceNumber).join(", ");
    console.log(`    Match: type=${m.matchType}, score=${m.score}, bank=[${bankDesc}], book=[${bookRefs}]`);
  }

  // Load ground truth
  const groundTruthPath = path.join(__dirname, "..", "data", "ground_truth (1).json");
  const groundTruth = JSON.parse(fs.readFileSync(groundTruthPath, "utf-8"));
  const scenarios = groundTruth.primary_pair.matching_scenarios;

  let passedScenarios = 0;
  let failedScenarios = 0;

  for (const sc of scenarios) {
    const id = sc.id;
    const expectedOutcome = sc.outcome;

    // Find the db transactions
    const dbBank = bankTxns.find(t => t.description && t.description.includes(id + " "));
    const dbLedgerRows = bookTxns.filter(t => {
      if (Array.isArray(sc.ledger_id)) {
        return sc.ledger_id.includes(t.referenceNumber || "");
      } else {
        return t.referenceNumber === sc.ledger_id;
      }
    });

    console.log(`\nScenario ${id}: "${sc.desc}"`);
    console.log(`  Expected outcome: ${expectedOutcome}`);

    if (expectedOutcome === "unmatched_ledger_only") {
      // Confirm ledger row is unmatched (no match containing its ID)
      const matchesWithLedger = generatedMatches.filter(m => m.bookTransactionIds.some(bid => dbLedgerRows.some(l => l.id === bid)));
      if (matchesWithLedger.length === 0) {
        console.log(`  PASSED: Ledger row ${sc.ledger_id} remained correctly unmatched.`);
        passedScenarios++;
      } else {
        console.error(`  FAILED: Ledger row ${sc.ledger_id} was matched incorrectly!`, matchesWithLedger);
        failedScenarios++;
      }
      continue;
    }

    if (!dbBank) {
      console.error(`  ERROR: Could not find bank transaction for scenario ${id}`);
      failedScenarios++;
      continue;
    }

    const match = generatedMatches.find(m => m.bankTransactionIds.includes(dbBank.id));

    if (expectedOutcome === "unmatched_bank_only" || expectedOutcome === "rejected_amount_too_far" || expectedOutcome === "excluded_not_revenue") {
      if (!match || match.matchType === "unmatched") {
        console.log("  PASSED: Bank transaction remained correctly unmatched.");
        passedScenarios++;
      } else {
        console.error(`  FAILED: Bank transaction was matched incorrectly! Match type: ${match.matchType}, book IDs: ${match.bookTransactionIds}`);
        failedScenarios++;
      }
      continue;
    }

    if (!match) {
      console.error(`  FAILED: No match generated for bank transaction.`);
      failedScenarios++;
      continue;
    }

    // Verify correct ledger rows were linked
    const expectedLedgerIds = dbLedgerRows.map(l => l.id).sort();
    const actualLedgerIds = [...match.bookTransactionIds].sort();
    const idsMatch = expectedLedgerIds.length === actualLedgerIds.length && expectedLedgerIds.every((val, idx) => val === actualLedgerIds[idx]);

    if (!idsMatch) {
      console.error(`  FAILED: Ledger entries mismatch. Expected: ${sc.ledger_id}, Got: ${match.bookTransactionIds.map(bid => bookTxns.find(l => l.id === bid)?.referenceNumber).join(", ")}`);
      failedScenarios++;
      continue;
    }

    // Check classification alignment
    let isAligned = false;
    if (expectedOutcome === "auto_approved" || expectedOutcome === "auto_approved_careful" || expectedOutcome === "auto_approved_or_medium") {
      // Must be high-confidence match
      isAligned = match.matchType === "exact" || match.matchType === "one_to_many" || match.matchType === "many_to_one" || match.matchType === "fee_adjustment";
    } else if (expectedOutcome === "medium_review" || expectedOutcome === "low_review_boundary") {
      isAligned = match.matchType !== "unmatched" && match.matchType !== "exact";
    }

    if (isAligned) {
      console.log(`  PASSED: Matched with type="${match.matchType}", score=${match.score}, band="${match.confidenceBand}"`);
      passedScenarios++;
    } else {
      console.error(`  FAILED: Mismatched classification. Engine returned matchType="${match.matchType}", score=${match.score}, band="${match.confidenceBand}"`);
      failedScenarios++;
    }
  }

  console.log("\n==================================================");
  console.log("AUDIT RESULTS SUMMARY");
  console.log("==================================================");
  console.log(`  Total scenarios tested: ${scenarios.length}`);
  console.log(`  Passed scenarios:       ${passedScenarios}`);
  console.log(`  Failed scenarios:       ${failedScenarios}`);
  console.log("==================================================");

  if (failedScenarios > 0) {
    console.error("\nAudit failed with scenario errors.");
    process.exit(1);
  } else {
    console.log("\nAll audits and validations completed successfully!");
  }
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
