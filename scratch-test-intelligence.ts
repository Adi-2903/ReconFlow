import "dotenv/config";
import { db } from "./core/db";
import { IntelligenceService } from "./services/intelligence.service";
import {
  organizations,
  imports,
  rawRecords,
  canonicalTransactions,
  counterpartyProfiles,
  financialAccounts,
} from "./core/db/schema";
import { eq, and } from "drizzle-orm";

async function runTests() {
  console.log("====================================");
  console.log("RUNNING ENRICHMENT & INTELLIGENCE TESTS");
  console.log("====================================\n");

  const [org] = await db.select().from(organizations);
  if (!org) {
    throw new Error("No organization found. Run the seeder first!");
  }

  // Get or create test financial account
  let accList = await db.select().from(financialAccounts).where(eq(financialAccounts.organizationId, org.id));
  if (accList.length === 0) {
    const [newAcc] = await db.insert(financialAccounts).values({
      organizationId: org.id,
      accountType: "bank",
      name: "Test Bank Account",
      baseCurrency: "USD",
    }).returning();
    accList = [newAcc];
  }
  const account = accList[0];

  // 1. RELATIONSHIP & SIGNAL EXTRACTION HARNESS
  console.log("1. Testing Field & Relationship Extraction...");

  const testCases = [
    {
      description: "Stripe Fee payment fee_ch_12345",
      referenceNumber: "fee_ch_12345",
      expected: { relatedTransactionId: "ch_12345", channel: "STRIPE" },
    },
    {
      description: "Refund order re_ch_54321 via Stripe",
      referenceNumber: "re_ch_54321",
      expected: { relatedTransactionId: "ch_54321", channel: "STRIPE" },
    },
    {
      description: "Payment for INV-2026-001 from customer",
      referenceNumber: "REF9998",
      expected: { invoiceNumber: "INV-2026-001" },
    },
    {
      description: "NEFT transfer with UTR SBIN0001234N99",
      referenceNumber: "",
      expected: { utr: "SBIN0001234N99", channel: "NEFT" },
    },
    {
      description: "Voucher S-1001 Daybook entry",
      referenceNumber: "",
      expected: { voucherNumber: "S-1001" },
    },
  ];

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    const rawTxn = {
      organizationId: org.id,
      accountId: account.id,
      sourceSystem: "bank",
      description: tc.description,
      referenceNumber: tc.referenceNumber,
      currency: "USD",
      amountMinor: 10000,
      transactionDate: "2026-01-15",
    };

    const enriched = await IntelligenceService.enrichTransaction(org.id, rawTxn);
    const signals = enriched.metadata.matchingSignals;
    
    console.log(`Test Case ${i + 1}: "${tc.description}"`);
    for (const [key, expectedVal] of Object.entries(tc.expected)) {
      const actualVal = (signals as any)[key];
      if (actualVal === expectedVal) {
        console.log(`  PASS: ${key} = ${actualVal}`);
      } else {
        console.error(`  FAIL: ${key} = ${actualVal} (expected: ${expectedVal})`);
        process.exit(1);
      }
    }
  }

  // 2. FX CONVERSION TESTING
  console.log("\n2. Testing FX Historical Conversion...");
  const rawFxTxn = {
    organizationId: org.id,
    accountId: account.id,
    sourceSystem: "bank",
    description: "Inward Remittance",
    referenceNumber: "FX-8899",
    currency: "EUR",
    amountMinor: 10000, // 100.00 EUR
    transactionDate: "2026-01-10",
  };
  const fxEnriched = await IntelligenceService.enrichTransaction(org.id, rawFxTxn);
  if (fxEnriched.convertedAmountMinor && fxEnriched.exchangeRate) {
    console.log(`  PASS: Converted 100.00 EUR to ${Number(fxEnriched.convertedAmountMinor) / 100} ${fxEnriched.baseCurrency} (Rate: ${fxEnriched.exchangeRate} on ${fxEnriched.exchangeRateDate})`);
  } else {
    console.error("  FAIL: FX Conversion not executed!");
    process.exit(1);
  }

  // 3. FEE RULES ENGINE TESTING
  console.log("\n3. Testing Fee Rules Engine...");
  const stripeTxn = {
    organizationId: org.id,
    accountId: account.id,
    sourceSystem: "stripe",
    description: "Charge fee payment via Stripe Checkout",
    referenceNumber: "txn_charge_1",
    currency: "USD",
    amountMinor: 10000, // 100.00 USD
    transactionDate: "2026-01-10",
  };
  const stripeEnriched = await IntelligenceService.enrichTransaction(org.id, stripeTxn);
  const stripeFee = stripeEnriched.metadata.expectedFeeMinor;
  // Expected Stripe fee: 2.9% of 10000 + 30 = 290 + 30 = 320
  if (stripeFee === 320) {
    console.log(`  PASS: Stripe fee rule applied. Expected Fee: ${stripeFee} (rule: ${stripeEnriched.metadata.feeRuleApplied})`);
  } else {
    console.error(`  FAIL: Stripe fee calculated as ${stripeFee} (expected: 320)`);
    process.exit(1);
  }

  // 4. COUNTERPARTY THRESHOLD GUARDRAILS
  console.log("\n4. Testing Counterparty Creation Guardrails...");
  const counterpartyName = "Unique Cafe " + Date.now();
  const normalizedName = counterpartyName.toLowerCase();

  // Create temporary imports for threshold testing
  const [imp1] = await db.insert(imports).values({ organizationId: org.id, sourceType: "test", status: "COMPLETED" }).returning();
  const [imp2] = await db.insert(imports).values({ organizationId: org.id, sourceType: "test", status: "COMPLETED" }).returning();

  const makeTxnInput = (importRunId: string) => ({
    organizationId: org.id,
    accountId: account.id,
    sourceSystem: "bank",
    description: "Lunch at " + counterpartyName,
    counterpartyName: counterpartyName,
    currency: "USD",
    amountMinor: 1500,
    transactionDate: "2026-01-10",
  });

  // Occurrence 1: Transaction in Import 1
  console.log("  Running occurrence 1...");
  const enriched1 = await IntelligenceService.enrichTransaction(org.id, makeTxnInput(imp1.id), imp1.id);
  if (enriched1.metadata.counterpartyProfileId) {
    console.error("  FAIL: Profile auto-created on 1st occurrence!");
    process.exit(1);
  }
  // Store 1st transaction to DB
  const [t1] = await db.insert(canonicalTransactions).values({
    organizationId: org.id,
    accountId: enriched1.accountId,
    sourceSystem: "bank",
    rawRecordId: null,
    side: "money",
    direction: "outflow",
    transactionDate: new Date(enriched1.transactionDate),
    amountMinor: BigInt(enriched1.amountMinor),
    currency: enriched1.currency,
    counterpartyName: enriched1.counterpartyName,
    counterpartyNormalized: enriched1.counterpartyNormalized,
    metadata: enriched1.metadata,
  }).returning();
  // Create mock raw record
  const [rawRec1] = await db.insert(rawRecords).values({ organizationId: org.id, importId: imp1.id, rawPayload: {} }).returning();
  await db.update(canonicalTransactions).set({ rawRecordId: rawRec1.id }).where(eq(canonicalTransactions.id, t1.id));

  // Occurrence 2: Transaction in Import 1 (same import!)
  console.log("  Running occurrence 2 (same import)...");
  const enriched2 = await IntelligenceService.enrichTransaction(org.id, makeTxnInput(imp1.id), imp1.id);
  if (enriched2.metadata.counterpartyProfileId) {
    console.error("  FAIL: Profile auto-created on same import!");
    process.exit(1);
  }
  // Store 2nd transaction
  const [t2] = await db.insert(canonicalTransactions).values({
    organizationId: org.id,
    accountId: enriched2.accountId,
    sourceSystem: "bank",
    rawRecordId: null,
    side: "money",
    direction: "outflow",
    transactionDate: new Date(enriched2.transactionDate),
    amountMinor: BigInt(enriched2.amountMinor),
    currency: enriched2.currency,
    counterpartyName: enriched2.counterpartyName,
    counterpartyNormalized: enriched2.counterpartyNormalized,
    metadata: enriched2.metadata,
  }).returning();
  const [rawRec2] = await db.insert(rawRecords).values({ organizationId: org.id, importId: imp1.id, rawPayload: {} }).returning();
  await db.update(canonicalTransactions).set({ rawRecordId: rawRec2.id }).where(eq(canonicalTransactions.id, t2.id));

  // Occurrence 3: Transaction in Import 2 (distinct import!)
  console.log("  Running occurrence 3 (new import)...");
  const enriched3 = await IntelligenceService.enrichTransaction(org.id, makeTxnInput(imp2.id), imp2.id);
  if (enriched3.metadata.counterpartyProfileId) {
    console.log("  PASS: Profile successfully auto-created on meeting distinct import guardrail threshold!");
  } else {
    console.error("  FAIL: Profile NOT auto-created on 3rd occurrence spanning 2 imports!");
    process.exit(1);
  }

  // 5. DATABASE CONSTRAINT VERIFICATION TESTS
  console.log("\n5. Testing Database Constraints (chk_fx_consistency)...");

  // A. Verify that fxStatus = CONVERTED, exchangeRate = NULL fails
  try {
    await db.insert(canonicalTransactions).values({
      organizationId: org.id,
      accountId: account.id,
      sourceSystem: "bank",
      side: "money",
      direction: "outflow",
      transactionDate: new Date("2026-01-10"),
      amountMinor: BigInt(1000),
      currency: "EUR",
      fxStatus: "CONVERTED",
      exchangeRate: null, // should trigger CHECK violation!
    });
    console.error("  FAIL: fxStatus = CONVERTED with exchangeRate = NULL inserted successfully (should have failed)!");
    process.exit(1);
  } catch (err: any) {
    console.log("  PASS: Invalid row (fxStatus = CONVERTED, exchangeRate = NULL) failed constraint correctly.");
  }

  // B. Verify that fxStatus = NOT_REQUIRED, exchangeRate = NULL passes
  try {
    const [inserted] = await db.insert(canonicalTransactions).values({
      organizationId: org.id,
      accountId: account.id,
      sourceSystem: "bank",
      side: "money",
      direction: "outflow",
      transactionDate: new Date("2026-01-10"),
      amountMinor: BigInt(1000),
      currency: "USD",
      fxStatus: "NOT_REQUIRED",
      exchangeRate: null, // should pass!
    }).returning();
    console.log("  PASS: Valid row (fxStatus = NOT_REQUIRED, exchangeRate = NULL) inserted successfully.");
    // Cleanup the valid insert
    await db.delete(canonicalTransactions).where(eq(canonicalTransactions.id, inserted.id));
  } catch (err: any) {
    console.error("  FAIL: Valid row (fxStatus = NOT_REQUIRED, exchangeRate = NULL) failed to insert:", err.message);
    process.exit(1);
  }

  // Cleanup profiles and transactions
  await db.delete(counterpartyProfiles).where(eq(counterpartyProfiles.normalizedName, normalizedName));
  await db.delete(canonicalTransactions).where(eq(canonicalTransactions.counterpartyNormalized, normalizedName));
  await db.delete(imports).where(and(eq(imports.organizationId, org.id), eq(imports.sourceType, "test")));

  console.log("\nAll Phase 4A Intelligence Verification Tests PASSED successfully!");
}

runTests().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
