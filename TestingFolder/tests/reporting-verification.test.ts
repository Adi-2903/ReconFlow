import "dotenv/config";
import { db } from "../../core/db";
import { dailyMetrics, matches, canonicalTransactions, users } from "../../core/db/schema";
import {
  getReconciliationSummaryReport,
  getExceptionReport,
  getFeeReport,
  getFXReport,
  getRiskReport
} from "../../services/reports.service";
import { getOrCreateUserOrganization, getOrCreateFinancialAccount } from "../../core/db/org-helper";
import { eq, and, sql } from "drizzle-orm";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`[PASS] ${message}`);
    passed++;
  } else {
    console.error(`[FAIL] ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log("Starting Automated Verification Tests for Reporting API...");
  
  try {
    // Locate the test user we created/updated
    const email = "testuser@example.com";
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user) {
      console.error(`[FAIL] Test user ${email} not found. Please make sure scratch-create-test-user.ts ran first.`);
      process.exit(1);
    }
    
    const userId = user.id;
    const orgId = await getOrCreateUserOrganization(userId);
    const bankAccountId = await getOrCreateFinancialAccount(orgId, "bank", "Verification Test Bank");

    const futureStart = "2099-01-01T00:00:00.000Z";
    const futureEnd = "2099-01-31T23:59:59.999Z";
    const futureDateStr = "2099-01-15";
    const futureDateTime = new Date("2099-01-15T12:00:00.000Z");

    // =========================================================================
    // Test 3: Empty Dataset Verification
    // =========================================================================
    console.log("\n--- Test 3: Empty Dataset Verification ---");
    // Ensure clean state in the future period
    await db.delete(dailyMetrics).where(and(eq(dailyMetrics.organizationId, orgId), eq(dailyMetrics.metricDate, futureDateStr)));
    
    const emptySummary = await getReconciliationSummaryReport(userId, futureStart, futureEnd);
    
    assert(typeof emptySummary.totalCount === "number" && emptySummary.totalCount === 0, "empty totalCount is number 0");
    assert(typeof emptySummary.matchedCount === "number" && emptySummary.matchedCount === 0, "empty matchedCount is number 0");
    assert(typeof emptySummary.pendingCount === "number" && emptySummary.pendingCount === 0, "empty pendingCount is number 0");
    assert(typeof emptySummary.unmatchedCount === "number" && emptySummary.unmatchedCount === 0, "empty unmatchedCount is number 0");
    assert(typeof emptySummary.highRiskCount === "number" && emptySummary.highRiskCount === 0, "empty highRiskCount is number 0");
    assert(typeof emptySummary.totalVolumeMinor === "string" && emptySummary.totalVolumeMinor === "0", "empty totalVolumeMinor is string '0'");
    assert(typeof emptySummary.feeVolumeMinor === "string" && emptySummary.feeVolumeMinor === "0", "empty feeVolumeMinor is string '0'");
    assert(typeof emptySummary.fxVolumeMinor === "string" && emptySummary.fxVolumeMinor === "0", "empty fxVolumeMinor is string '0'");

    // Test 1: JSON Serialization on Empty Dataset
    let emptyStringified = "";
    try {
      emptyStringified = JSON.stringify(emptySummary);
      assert(true, "JSON.stringify succeeds on empty dataset summary");
    } catch (e: any) {
      assert(false, `JSON.stringify failed on empty dataset summary: ${e.message}`);
    }

    // =========================================================================
    // Test 2 & Test 4: Large Money Precision & Single-Row Dataset
    // =========================================================================
    console.log("\n--- Test 2 & 4: Large Money Precision & Single-Row Dataset ---");
    const largeVolume = 999999999999999n;
    
    await db.insert(dailyMetrics).values({
      organizationId: orgId,
      metricDate: futureDateStr,
      totalCount: 15,
      matchedCount: 10,
      pendingCount: 3,
      unmatchedCount: 2,
      highRiskCount: 1,
      totalVolumeMinor: largeVolume,
      feeVolumeMinor: 500n,
      fxVolumeMinor: 100n
    });

    const populatedSummary = await getReconciliationSummaryReport(userId, futureStart, futureEnd);
    
    assert(typeof populatedSummary.totalCount === "number" && populatedSummary.totalCount === 15, "populated totalCount is number 15");
    assert(typeof populatedSummary.matchedCount === "number" && populatedSummary.matchedCount === 10, "populated matchedCount is number 10");
    assert(typeof populatedSummary.pendingCount === "number" && populatedSummary.pendingCount === 3, "populated pendingCount is number 3");
    assert(typeof populatedSummary.unmatchedCount === "number" && populatedSummary.unmatchedCount === 2, "populated unmatchedCount is number 2");
    assert(typeof populatedSummary.highRiskCount === "number" && populatedSummary.highRiskCount === 1, "populated highRiskCount is number 1");
    
    // Check BigInt -> String conversion and precision
    assert(typeof populatedSummary.totalVolumeMinor === "string" && populatedSummary.totalVolumeMinor === "999999999999999", "populated totalVolumeMinor is string '999999999999999' (precision preserved)");
    assert(typeof populatedSummary.feeVolumeMinor === "string" && populatedSummary.feeVolumeMinor === "500", "populated feeVolumeMinor is string '500'");
    assert(typeof populatedSummary.fxVolumeMinor === "string" && populatedSummary.fxVolumeMinor === "100", "populated fxVolumeMinor is string '100'");

    // Test 1: JSON Serialization on Populated Dataset
    try {
      const json = JSON.stringify(populatedSummary);
      assert(json.includes('"totalVolumeMinor":"999999999999999"'), "JSON.stringify succeeds and contains precise string value of largeVolume");
    } catch (e: any) {
      assert(false, `JSON.stringify failed on populated dataset summary: ${e.message}`);
    }

    // Clean up daily metric
    await db.delete(dailyMetrics).where(and(eq(dailyMetrics.organizationId, orgId), eq(dailyMetrics.metricDate, futureDateStr)));

    // =========================================================================
    // Test Details Reports (Exceptions, Fee, FX, Risk)
    // =========================================================================
    console.log("\n--- Test Details Reports (BigInt to String in data rows) ---");
    const largeMoney = 888888888888888n;

    // Insert mock canonical transaction with a large amount minor
    const [mockTx] = await db.insert(canonicalTransactions).values({
      organizationId: orgId,
      accountId: bankAccountId,
      sourceSystem: "stripe",
      side: "money",
      direction: "inflow",
      status: "RAW",
      transactionDate: futureDateTime,
      amountMinor: largeMoney,
      currency: "INR"
    }).returning();

    // Insert mock matches referencing the transaction
    const [mockMatch] = await db.insert(matches).values({
      userId: userId,
      bankTransactionId: mockTx.id,
      ledgerEntryIds: [],
      confidenceScore: "0.45", // Low confidence -> high risk
      matchType: "none",
      discrepancyType: "PROCESSING_FEE", // For fee report
      riskScore: 3,
      status: "pending",
      reasonText: "Verification test discrepancy"
    }).returning();

    // 1. Exception Report
    console.log("Checking Exception Report...");
    const exceptionReport = await getExceptionReport(userId, futureStart, futureEnd, 1, 10);
    assert(exceptionReport.data.length > 0, "Exception report returns mock transaction");
    if (exceptionReport.data.length > 0) {
      const item = exceptionReport.data.find(d => d.id === mockMatch.id);
      assert(!!item, "Mock match found in Exception Report");
      if (item) {
        assert(typeof item.amountMinor === "string" && item.amountMinor === "888888888888888", "Exception report amountMinor is string '888888888888888' (precision preserved)");
      }
    }
    try {
      JSON.stringify(exceptionReport);
      assert(true, "Exception report is fully serializable to JSON");
    } catch (e: any) {
      assert(false, `Exception report JSON stringify failed: ${e.message}`);
    }

    // 2. Fee Report
    console.log("Checking Fee Report...");
    const feeReport = await getFeeReport(userId, futureStart, futureEnd, 1, 10);
    assert(feeReport.data.length > 0, "Fee report returns mock transaction");
    if (feeReport.data.length > 0) {
      const item = feeReport.data.find(d => d.id === mockMatch.id);
      assert(!!item, "Mock match found in Fee Report");
      if (item) {
        assert(typeof item.amountMinor === "string" && item.amountMinor === "888888888888888", "Fee report amountMinor is string '888888888888888'");
      }
    }
    try {
      JSON.stringify(feeReport);
      assert(true, "Fee report is fully serializable to JSON");
    } catch (e: any) {
      assert(false, `Fee report JSON stringify failed: ${e.message}`);
    }

    // 3. FX Report
    console.log("Checking FX Report (with discrepancy type updated)...");
    await db.update(matches).set({ discrepancyType: "FOREIGN_EXCHANGE" }).where(eq(matches.id, mockMatch.id));
    const fxReport = await getFXReport(userId, futureStart, futureEnd, 1, 10);
    assert(fxReport.data.length > 0, "FX report returns mock transaction");
    if (fxReport.data.length > 0) {
      const item = fxReport.data.find(d => d.id === mockMatch.id);
      assert(!!item, "Mock match found in FX Report");
      if (item) {
        assert(typeof item.amountMinor === "string" && item.amountMinor === "888888888888888", "FX report amountMinor is string '888888888888888'");
      }
    }
    try {
      JSON.stringify(fxReport);
      assert(true, "FX report is fully serializable to JSON");
    } catch (e: any) {
      assert(false, `FX report JSON stringify failed: ${e.message}`);
    }

    // 4. Risk Report
    console.log("Checking Risk Report...");
    const riskReport = await getRiskReport(userId, futureStart, futureEnd, 1, 10);
    assert(riskReport.data.length > 0, "Risk report returns mock transaction");
    if (riskReport.data.length > 0) {
      const item = riskReport.data.find(d => d.id === mockMatch.id);
      assert(!!item, "Mock match found in Risk Report");
      if (item) {
        assert(typeof item.amountMinor === "string" && item.amountMinor === "888888888888888", "Risk report amountMinor is string '888888888888888'");
      }
    }
    try {
      JSON.stringify(riskReport);
      assert(true, "Risk report is fully serializable to JSON");
    } catch (e: any) {
      assert(false, `Risk report JSON stringify failed: ${e.message}`);
    }

    // Clean up matches and transactions
    console.log("\nCleaning up seeded mock records...");
    await db.delete(matches).where(eq(matches.id, mockMatch.id));
    await db.delete(canonicalTransactions).where(eq(canonicalTransactions.id, mockTx.id));
    console.log("Cleanup finished.");

  } catch (error) {
    console.error("Test execution failed with error:", error);
    failed++;
  }

  console.log(`\nVerification completed: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
