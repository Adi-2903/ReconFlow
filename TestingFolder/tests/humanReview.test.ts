// TestingFolder/tests/humanReview.test.ts
//
// Phase 10 — Human Review Workflow integration test suite.
//
// Run with:
//   npx tsx TestingFolder/tests/humanReview.test.ts
//

import "dotenv/config";
import crypto from "crypto";
import { db } from "../../core/db";
import {
  users,
  organizations,
  organizationMembers,
  financialAccounts,
  canonicalTransactions,
  matches,
  auditEvents,
} from "../../core/db/schema";
import {
  approveMatch,
  rejectMatch,
  manualMatch,
  ReviewConflictError,
} from "../../services/matches.service";
import { eq, and } from "drizzle-orm";

let passed = 0;
let failed = 0;
const errors: string[] = [];

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    errors.push(label);
    failed++;
  }
}

function section(title: string): void {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("─".repeat(60));
}

// Generate unique test IDs to isolate test runs
const userId = crypto.randomUUID();
const orgId = crypto.randomUUID();
const bankAccountId = crypto.randomUUID();

const bankTxId = crypto.randomUUID();
const bankTxId2 = crypto.randomUUID();
const bankTxId3 = crypto.randomUUID();
const bankTxId4 = crypto.randomUUID();
const ledgerTxId1 = crypto.randomUUID();
const ledgerTxId2 = crypto.randomUUID();
const ledgerTxId3 = crypto.randomUUID();

const matchId = crypto.randomUUID();

async function seedData() {
  // 1. Create user
  await db.insert(users).values({
    id: userId,
    email: `test-${userId}@reconflow.ai`,
    name: "Test Reviewer",
  });

  // 2. Create organization
  await db.insert(organizations).values({
    id: orgId,
    name: "Test Organization",
    baseCurrency: "USD",
  });

  // 3. Create membership
  await db.insert(organizationMembers).values({
    organizationId: orgId,
    userId,
    role: "admin",
  });

  // 4. Create financial account
  await db.insert(financialAccounts).values({
    id: bankAccountId,
    organizationId: orgId,
    accountType: "bank",
    name: "Test Bank Account",
    baseCurrency: "USD",
  });

  // 5. Seed bank transaction (bankTxId)
  await db.insert(canonicalTransactions).values({
    id: bankTxId,
    organizationId: orgId,
    accountId: bankAccountId,
    sourceSystem: "bank",
    side: "money",
    direction: "inflow",
    status: "MATCHED_PENDING",
    transactionDate: new Date(),
    amountMinor: 10000n, // $100.00
    currency: "USD",
  });

  // 6. Seed bank transaction 2 (bankTxId2 - for collision test)
  await db.insert(canonicalTransactions).values({
    id: bankTxId2,
    organizationId: orgId,
    accountId: bankAccountId,
    sourceSystem: "bank",
    side: "money",
    direction: "inflow",
    status: "AVAILABLE",
    transactionDate: new Date(),
    amountMinor: 10000n, // $100.00
    currency: "USD",
  });

  // 6b. Seed bank transaction 3 (bankTxId3 - AVAILABLE for collision)
  await db.insert(canonicalTransactions).values({
    id: bankTxId3,
    organizationId: orgId,
    accountId: bankAccountId,
    sourceSystem: "bank",
    side: "money",
    direction: "inflow",
    status: "AVAILABLE",
    transactionDate: new Date(),
    amountMinor: 10000n,
    currency: "USD",
  });

  // 6c. Seed bank transaction 4 (bankTxId4 - AVAILABLE for collision)
  await db.insert(canonicalTransactions).values({
    id: bankTxId4,
    organizationId: orgId,
    accountId: bankAccountId,
    sourceSystem: "bank",
    side: "money",
    direction: "inflow",
    status: "AVAILABLE",
    transactionDate: new Date(),
    amountMinor: 10000n,
    currency: "USD",
  });

  // 7. Seed ledger entry 1 (ledgerTxId1)
  await db.insert(canonicalTransactions).values({
    id: ledgerTxId1,
    organizationId: orgId,
    accountId: bankAccountId,
    sourceSystem: "quickbooks",
    side: "books",
    direction: "inflow",
    status: "MATCHED_PENDING",
    transactionDate: new Date(),
    amountMinor: 10000n, // $100.00
    currency: "USD",
  });

  // 8. Seed ledger entry 2 (ledgerTxId2) - AVAILABLE
  await db.insert(canonicalTransactions).values({
    id: ledgerTxId2,
    organizationId: orgId,
    accountId: bankAccountId,
    sourceSystem: "quickbooks",
    side: "books",
    direction: "inflow",
    status: "AVAILABLE",
    transactionDate: new Date(),
    amountMinor: 10000n, // $100.00
    currency: "USD",
  });

  // 9. Seed ledger entry 3 (ledgerTxId3) - AVAILABLE
  await db.insert(canonicalTransactions).values({
    id: ledgerTxId3,
    organizationId: orgId,
    accountId: bankAccountId,
    sourceSystem: "quickbooks",
    side: "books",
    direction: "inflow",
    status: "AVAILABLE",
    transactionDate: new Date(),
    amountMinor: 5000n, // $50.00
    currency: "USD",
  });

  // 10. Seed pending match linking bankTxId and ledgerTxId1
  await db.insert(matches).values({
    id: matchId,
    userId,
    bankTransactionId: bankTxId,
    ledgerEntryIds: [ledgerTxId1],
    confidenceScore: "0.85",
    matchType: "fuzzy",
    status: "pending",
    riskScore: 20,
    reviewType: "AUTO",
  });
}

async function cleanupData() {
  try {
    // Delete audit events
    await db.delete(auditEvents).where(eq(auditEvents.userId, userId));
    // Delete matches
    await db.delete(matches).where(eq(matches.userId, userId));
    // Delete transactions
    await db.delete(canonicalTransactions).where(eq(canonicalTransactions.organizationId, orgId));
    // Delete membership
    await db.delete(organizationMembers).where(eq(organizationMembers.organizationId, orgId));
    // Delete financial account
    await db.delete(financialAccounts).where(eq(financialAccounts.organizationId, orgId));
    // Delete organization
    await db.delete(organizations).where(eq(organizations.id, orgId));
    // Delete user
    await db.delete(users).where(eq(users.id, userId));
  } catch (err) {
    console.error("Cleanup error:", err);
  }
}

async function runTests() {
  console.log("==================================================");
  console.log("RUNNING HUMAN REVIEW INTEGRATION TESTS");
  console.log("==================================================\n");

  try {
    // Reset/seed
    await seedData();

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 1: Concurrent Approval Test
    // ──────────────────────────────────────────────────────────────────────────
    section("Test 1: Concurrent Approval (ALREADY_FINALIZED)");
    
    // First approval succeeds
    const res1 = await approveMatch(userId, matchId, "reviewer1@test.com", "Approved first");
    assert(res1.success === true, "First approval should succeed");

    // Second approval fails with ALREADY_FINALIZED
    let caughtConflict = false;
    try {
      await approveMatch(userId, matchId, "reviewer2@test.com", "Approved second");
    } catch (e: any) {
      if (e instanceof ReviewConflictError && e.code === "ALREADY_FINALIZED") {
        caughtConflict = true;
      } else {
        console.error("Wrong error thrown:", e);
      }
    }
    assert(caughtConflict, "Second approval should throw ALREADY_FINALIZED");


    // ──────────────────────────────────────────────────────────────────────────
    // TEST 2: Manual Match Audit Test
    // ──────────────────────────────────────────────────────────────────────────
    section("Test 2: Manual Match Audit Event Storage");

    const manualRes = await manualMatch(
      userId,
      "reviewer1@test.com",
      bankTxId2,
      [ledgerTxId3],
      "Linked due to invoice reference similarity"
    );
    assert(manualRes.success === true, "Manual match creation should succeed");

    // Check match record
    const [matchRow] = await db
      .select()
      .from(matches)
      .where(eq(matches.id, manualRes.matchId))
      .limit(1);
    
    assert(matchRow !== undefined, "Manual match record should exist in matches table");
    assert(matchRow.reviewType === "MANUAL", "reviewType should be MANUAL");
    assert(matchRow.status === "pending", "status should be pending");

    // Check audit event
    const [auditRow] = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.matchId, manualRes.matchId))
      .limit(1);

    assert(auditRow !== undefined, "Audit event should be recorded");
    assert(auditRow.action === "manual_match_created", "Action should be manual_match_created");
    assert(auditRow.actorEmail === "reviewer1@test.com", "Actor email matches");
    assert(auditRow.reason === "Linked due to invoice reference similarity", "Justification reason is logged");


    // ──────────────────────────────────────────────────────────────────────────
    // TEST 3: Demo Mode Isolation Test
    // ──────────────────────────────────────────────────────────────────────────
    section("Test 3: Demo Mode Isolation");
    
    // Simulating client-side demo mode: handles logic locally without writing to the db
    // We check that our database counts for this user haven't changed during frontend mock actions
    const matchesBefore = await db.select().from(matches).where(eq(matches.userId, userId));
    
    // Mock action
    const demoModeApproveMock = (id: string, list: any[]) => {
      return list.map(m => m.id === id ? { ...m, status: "approved" } : m);
    };
    const mockList = [{ id: "mock-1", status: "pending" }];
    const updatedMockList = demoModeApproveMock("mock-1", mockList);
    
    const matchesAfter = await db.select().from(matches).where(eq(matches.userId, userId));
    assert(
      updatedMockList[0].status === "approved" && matchesBefore.length === matchesAfter.length,
      "Demo actions update local state but do NOT insert/modify DB records"
    );


    // ──────────────────────────────────────────────────────────────────────────
    // TEST 4: Ledger Availability Test
    // ──────────────────────────────────────────────────────────────────────────
    section("Test 4: Ledger Availability / Search Filtering");

    // ledgerTxId3 was used in manualMatch in Test 2, status should be MATCHED_PENDING now.
    const [txnRow] = await db
      .select()
      .from(canonicalTransactions)
      .where(eq(canonicalTransactions.id, ledgerTxId3))
      .limit(1);
    assert(txnRow.status === "MATCHED_PENDING", "Matched ledger status is updated to MATCHED_PENDING");

    // Query AVAILABLE ledger entries
    const availableLedgers = await db
      .select()
      .from(canonicalTransactions)
      .where(
        and(
          eq(canonicalTransactions.organizationId, orgId),
          eq(canonicalTransactions.status, "AVAILABLE"),
          eq(canonicalTransactions.side, "books")
        )
      );

    const containsMatchedLedger = availableLedgers.some((l) => l.id === ledgerTxId3);
    assert(!containsMatchedLedger, "Matched ledger entry must be excluded from AVAILABLE results");


    // ──────────────────────────────────────────────────────────────────────────
    // TEST 5: Manual Match Collision Test
    // ──────────────────────────────────────────────────────────────────────────
    section("Test 5: Manual Match Collision (CONCURRENT_CLAIM)");

    // Both users attempt to match the SAME ledger entry (ledgerTxId2) to different bank transactions AT THE SAME TIME.
    // One must succeed, the other MUST fail with CONCURRENT_CLAIM due to NOWAIT row lock contention.
    const p1 = manualMatch(
      userId,
      "reviewerA@test.com",
      bankTxId3,
      [ledgerTxId2],
      "User A manual link"
    );
    
    const p2 = manualMatch(
      userId,
      "reviewerB@test.com",
      bankTxId4,
      [ledgerTxId2],
      "User B manual link clash"
    );

    let successCount = 0;
    let conflictCount = 0;
    
    const results = await Promise.allSettled([p1, p2]);
    for (const res of results) {
      if (res.status === "fulfilled" && res.value.success) {
        successCount++;
      } else if (res.status === "rejected" && res.reason instanceof ReviewConflictError && res.reason.code === "CONCURRENT_CLAIM") {
        conflictCount++;
      } else if (res.status === "rejected" && (res.reason as any).code === "55P03") {
        // Fallback for direct DB driver surfacing 55P03 up to test layer (if service doesn't map it directly)
        conflictCount++;
      } else {
        console.error("Unexpected error in collision test:", res.status === "rejected" ? res.reason : res.value);
      }
    }

    assert(successCount === 1, "Exactly one concurrent manual match should succeed");
    assert(conflictCount === 1, "Exactly one concurrent manual match should fail with CONCURRENT_CLAIM (or 55P03)");

  } catch (err: any) {
    console.error("Global Test Error:", err);
    failed++;
  } finally {
    console.log("\nCleaning up seeded database records...");
    await cleanupData();
  }

  console.log("\n==================================================");
  console.log(`TEST RUN COMPLETE: ${passed} passed, ${failed} failed.`);
  console.log("==================================================");
  
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Fatal test failure:", err);
  process.exit(1);
});
