import "dotenv/config";
import path from "path";
import fs from "fs";
import { db } from "../../core/db";
import {
  organizations,
  financialAccounts,
  fxRates,
  canonicalTransactions,
  imports,
  rawRecords,
  matches,
  reconRuns,
  aiExplanations,
  auditEvents,
  reconciliationRuns,
  reconciliationRunTransactions,
  transactionCandidates,
  matchGroups,
  matchItems,
  matchGroupClassifications,
  reviewQueue,
  transactionEmbeddings,
  counterpartyProfiles,
  learnedPatterns,
} from "../../core/db/schema";
import { IngestionService } from "../../services/ingestion.service";
import { runMatcher } from "../matching/runMatcher";
import { generateCandidates } from "../matching/candidateGenerator";
import { generateMatchReasoning, RunTracker } from "../../lib/ai-reason";
import { eq, and, inArray } from "drizzle-orm";
import { CanonicalTransaction } from "../types/CanonicalTransaction";
import { LLMProvider } from "../../lib/llm-provider";

// ============================================================================
// 1. SAFETY & STABILITY GUARDRAILS
// ============================================================================

// Nuke Safety Lock
const dbUrl = process.env.DATABASE_URL || "";
if (process.env.NODE_ENV === "production" || dbUrl.includes("prod") || dbUrl.includes("production")) {
  console.error("\n🛑 FATAL: Attempted to run destructive audit in production environment!");
  process.exit(1);
}

// AI reasoning bypass provider
class MockLLMProvider implements LLMProvider {
  readonly name = "mock-llm-provider-static";
  async complete(systemPrompt: string, userPrompt: string): Promise<string> {
    return JSON.stringify({
      suggestedAction: "MANUAL_REVIEW",
      explanationTemplate: "Static fallback template for manual review discrepancy. Verification is required.",
      likelyReason: "manual_review_needed",
      requiresHumanReview: true,
      confidence: 50,
    });
  }
}

// Success Threshold Gates
const MIN_PRECISION = 0.95;
const MIN_RECALL = 0.95;
const MIN_F1 = 0.95;

interface AuditSummary {
  runId: string;
  passedGates: boolean;
  precision: number;
  recall: number;
  f1: number;
  totalScenarios: number;
  passedScenarios: number;
  failedScenarios: number;
  stageRuntimesMs: {
    ingestion: number;
    candidateGen: number;
    matching: number;
    total: number;
  };
  candidateSpaceReduction: number;
  thresholds: {
    precision: number;
    recall: number;
    f1: number;
  };
  aiReasoningEnabled: boolean;
  generatedAt: string;
}

async function main() {
  const globalStartTime = Date.now();

  console.log("\n==================================================");
  console.log("RECONFLOW REGRESSION & BENCHMARKING FRAMEWORK");
  console.log("==================================================\n");

  const runId = generateRunId();
  const runDir = path.join(__dirname, "..", "results", runId);
  fs.mkdirSync(runDir, { recursive: true });

  const aiReasoningEnabled = process.env.DISABLE_AI_REASONING !== "true";
  const llmProvider = aiReasoningEnabled ? undefined : new MockLLMProvider();

  // --------------------------------------------------------------------------
  // STAGE 0: Reset Database State
  // --------------------------------------------------------------------------
  console.log("Stage 0: Resetting database state...");
  const tStage0Start = Date.now();
  
  const orgs = await db.select().from(organizations);
  const auditOrgs = orgs.filter((o) => o.name.startsWith("Audit Org -"));

  for (const o of auditOrgs) {
    console.log(`  Cleaning up previous audit organization: ${o.name} (${o.id})...`);
    
    const safeDelete = async (action: () => Promise<any>, desc: string) => {
      try {
        await action();
      } catch (err: any) {
        if (err.message && err.message.includes("relation") && err.message.includes("does not exist")) {
          // Table does not exist in DB, skip silently
        } else {
          console.warn(`  Warning during cleanup of ${desc}: ${err.message}`);
        }
      }
    };

    // Find canonical transactions to delete indirect references
    let ids: string[] = [];
    try {
      const txnIds = await db
        .select({ id: canonicalTransactions.id })
        .from(canonicalTransactions)
        .where(eq(canonicalTransactions.organizationId, o.id));
      ids = txnIds.map((t) => t.id);
    } catch (e) {
      // canonicalTransactions might not exist
    }

    if (ids.length > 0) {
      // Find matches referencing these transactions to delete audit events
      let mIds: string[] = [];
      try {
        const matchIds = await db
          .select({ id: matches.id })
          .from(matches)
          .where(inArray(matches.bankTransactionId, ids));
        mIds = matchIds.map((m) => m.id);
      } catch (e) {}

      if (mIds.length > 0) {
        await safeDelete(() => db.delete(auditEvents).where(inArray(auditEvents.matchId, mIds)), "auditEvents");
      }
      await safeDelete(() => db.delete(matches).where(inArray(matches.bankTransactionId, ids)), "matches");
      await safeDelete(() => db.delete(reconciliationRunTransactions).where(inArray(reconciliationRunTransactions.transactionId, ids)), "reconciliationRunTransactions");
      await safeDelete(() => db.delete(transactionCandidates).where(inArray(transactionCandidates.sourceTransactionId, ids)), "transactionCandidates source");
      await safeDelete(() => db.delete(transactionCandidates).where(inArray(transactionCandidates.candidateTransactionId, ids)), "transactionCandidates candidate");
    }

    // Now delete by organizationId in safe child-first sequence
    await safeDelete(() => db.delete(aiExplanations).where(eq(aiExplanations.organizationId, o.id)), "aiExplanations");
    await safeDelete(() => db.delete(reviewQueue).where(eq(reviewQueue.organizationId, o.id)), "reviewQueue");
    await safeDelete(() => db.delete(matchGroupClassifications).where(eq(matchGroupClassifications.organizationId, o.id)), "matchGroupClassifications");
    await safeDelete(() => db.delete(matchItems).where(eq(matchItems.organizationId, o.id)), "matchItems");
    await safeDelete(() => db.delete(matchGroups).where(eq(matchGroups.organizationId, o.id)), "matchGroups");
    await safeDelete(() => db.delete(reconciliationRuns).where(eq(reconciliationRuns.organizationId, o.id)), "reconciliationRuns");
    await safeDelete(() => db.delete(transactionEmbeddings).where(eq(transactionEmbeddings.organizationId, o.id)), "transactionEmbeddings");
    await safeDelete(() => db.delete(learnedPatterns).where(eq(learnedPatterns.organizationId, o.id)), "learnedPatterns");
    await safeDelete(() => db.delete(counterpartyProfiles).where(eq(counterpartyProfiles.organizationId, o.id)), "counterpartyProfiles");
    await safeDelete(() => db.delete(canonicalTransactions).where(eq(canonicalTransactions.organizationId, o.id)), "canonicalTransactions");
    await safeDelete(() => db.delete(rawRecords).where(eq(rawRecords.organizationId, o.id)), "rawRecords");
    await safeDelete(() => db.delete(imports).where(eq(imports.organizationId, o.id)), "imports");
    await safeDelete(() => db.delete(financialAccounts).where(eq(financialAccounts.organizationId, o.id)), "financialAccounts");
    await safeDelete(() => db.delete(organizations).where(eq(organizations.id, o.id)), "organizations");
  }
  console.log(`  Database reset complete in ${Date.now() - tStage0Start}ms.\n`);

  // --------------------------------------------------------------------------
  // STAGE 1: Retrieve Raw Files
  // --------------------------------------------------------------------------
  console.log("Stage 1: Retrieving raw files...");
  const tStage1Start = Date.now();
  
  const hdfcPath = path.join(__dirname, "..", "data", "HDFC_Bluepeak_CurrentAC_Jan2026.csv");
  const qbPath = path.join(__dirname, "..", "data", "QuickBooks_Invoices_Bills_Export_Jan2026.csv");
  const stripePath = path.join(__dirname, "..", "data", "Stripe_Balance_Itemized_Jan2026.csv");

  if (!fs.existsSync(hdfcPath)) throw new Error(`Missing HDFC file: ${hdfcPath}`);
  if (!fs.existsSync(qbPath)) throw new Error(`Missing QuickBooks file: ${qbPath}`);
  if (!fs.existsSync(stripePath)) throw new Error(`Missing Stripe file: ${stripePath}`);

  const hdfcBuffer = fs.readFileSync(hdfcPath);
  const qbBuffer = fs.readFileSync(qbPath);
  const stripeBuffer = fs.readFileSync(stripePath);

  const tStage1End = Date.now();
  const tStage1Duration = tStage1End - tStage1Start;
  console.log(`  Raw files retrieved successfully. Size HDFC: ${hdfcBuffer.length}B, QB: ${qbBuffer.length}B, Stripe: ${stripeBuffer.length}B.\n`);

  // --------------------------------------------------------------------------
  // STAGE 2: Parse and Ingest (Fail-Fast)
  // --------------------------------------------------------------------------
  console.log("Stage 2: Parsing and ingesting raw statement files...");
  const tStage2Start = Date.now();

  // Create isolated Organization and Accounts
  const orgName = "Audit Org - " + Date.now();
  const [org] = await db.insert(organizations).values({
    name: orgName,
    baseCurrency: "INR",
  }).returning();

  const [hdfcAccount] = await db.insert(financialAccounts).values({
    organizationId: org.id,
    accountType: "bank",
    name: "HDFC Bank Statement Account",
    baseCurrency: "INR",
    metadata: { locale: "en-IN" },
  }).returning();

  const [qbAccount] = await db.insert(financialAccounts).values({
    organizationId: org.id,
    accountType: "quickbooks",
    name: "QuickBooks Ledger Account",
    baseCurrency: "INR",
    metadata: { locale: "en-US" },
  }).returning();

  const [stripeAccount] = await db.insert(financialAccounts).values({
    organizationId: org.id,
    accountType: "stripe",
    name: "Stripe Processor Account",
    baseCurrency: "INR",
    metadata: { locale: "en-US" },
  }).returning();

  // Seed FX rates for primary USD invoice (INV-2060)
  await db.insert(fxRates).values([
    { baseCurrency: "INR", quoteCurrency: "USD", rateDate: "2026-01-14", exchangeRate: "0.01203369" },
    { baseCurrency: "INR", quoteCurrency: "USD", rateDate: "2026-01-17", exchangeRate: "0.01201923" }
  ]).onConflictDoNothing();

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

  console.log("  Ingesting HDFC Bank Statement...");
  const hdfcIngest = await IngestionService.importFileTransactions(org.id, hdfcAccount.id, hdfcBuffer, "HDFC_Bluepeak_CurrentAC_Jan2026.csv", "bank_csv", hdfcColumnMap);
  assertNoFailure(hdfcIngest, "HDFC Bank Statement");

  console.log("  Ingesting QuickBooks Ledger Export...");
  const qbIngest = await IngestionService.importFileTransactions(org.id, qbAccount.id, qbBuffer, "QuickBooks_Invoices_Bills_Export_Jan2026.csv", "qbo_export", qbColumnMap);
  assertNoFailure(qbIngest, "QuickBooks Ledger");

  console.log("  Ingesting Stripe Balance Itemized...");
  const stripeIngest = await IngestionService.importFileTransactions(org.id, stripeAccount.id, stripeBuffer, "Stripe_Balance_Itemized_Jan2026.csv", "stripe_export", stripeColumnMap);
  assertNoFailure(stripeIngest, "Stripe Balance");

  const tStage2End = Date.now();
  const tStage2Duration = tStage2End - tStage2Start;
  console.log(`  Ingestion completed. HDFC: ${hdfcIngest.successCount} rows, QB: ${qbIngest.successCount} rows, Stripe: ${stripeIngest.successCount} rows.\n`);

  // --------------------------------------------------------------------------
  // STAGE 3: Run Candidate Generation & Matching Pipeline
  // --------------------------------------------------------------------------
  console.log("Stage 3: Running candidate generation and matching...");
  const tStage3Start = Date.now();

  const allTxns = await db.select().from(canonicalTransactions).where(eq(canonicalTransactions.organizationId, org.id));
  const bankTxns = allTxns.filter((t) => t.side === "money").map(mapDbRowToCanonical);
  const bookTxns = allTxns.filter((t) => t.side === "books").map(mapDbRowToCanonical);

  // Candidate generation effectiveness metrics
  const rawSearchSpace = bankTxns.length * bookTxns.length;
  let postCandidateSpace = 0;
  
  const tCandidateGenStart = Date.now();
  for (const bankTx of bankTxns) {
    const candidates = generateCandidates(bankTx, bookTxns);
    postCandidateSpace += candidates.length;
  }
  const tCandidateGenDuration = Date.now() - tCandidateGenStart;

  const candidateSpaceReduction = rawSearchSpace > 0 ? (1 - (postCandidateSpace / rawSearchSpace)) * 100 : 0;
  console.log(`  Candidate Generation Performance:`);
  console.log(`    Raw Search Space:        ${rawSearchSpace} pairs`);
  console.log(`    Post Candidate Filtering: ${postCandidateSpace} pairs`);
  console.log(`    Space Reduction %:        ${candidateSpaceReduction.toFixed(2)}%`);

  const tMatchingStart = Date.now();
  const generatedMatches = runMatcher(bankTxns, bookTxns);
  const tMatchingDuration = Date.now() - tMatchingStart;

  // Run AI reasoning explanations on all generated matches (if applicable)
  console.log(`  Generating explanations for matches (AI Reasoning: ${aiReasoningEnabled ? "ENABLED" : "BYPASSED (STATIC FALLBACKS)"})...`);
  const tracker = new RunTracker();
  for (const m of generatedMatches) {
    // Only generate reasoning for matches that contain transactions
    if (m.bankTransactionIds.length > 0 && m.matchType !== "unmatched" && m.matchType !== "unmatched_ledger") {
      const bankTx = bankTxns.find((t) => t.id === m.bankTransactionIds[0]);
      const candidates = bookTxns.filter((t) => m.bookTransactionIds.includes(t.id));

      if (bankTx) {
        try {
          const matchResultAdapter = {
            confidenceScore: m.score / 100,
            classification: {
              discrepancyType: m.discrepancyType || "NONE",
              confidenceBand: m.confidenceBand as any,
              evidence: m.evidence || [],
            },
          } as any;

          const bankTxAdapted = {
            id: bankTx.id,
            amount: Number(bankTx.amountMinor ?? BigInt(Math.round(bankTx.amount * 100))),
            date: bankTx.transactionDate,
            description: bankTx.description || "",
            referenceId: bankTx.referenceNumber || "",
            counterparty: bankTx.counterparty,
          };
          const candidatesAdapted = candidates.map((c) => ({
            id: c.id,
            amount: Number(c.amountMinor ?? BigInt(Math.round(c.amount * 100))),
            date: c.transactionDate,
            memo: c.description || "",
            invoiceRef: c.referenceNumber || "",
            counterparty: c.counterparty,
          }));

          const reasonResult = await generateMatchReasoning(
            m.bankTransactionIds[0],
            org.id,
            bankTxAdapted as any,
            candidatesAdapted as any,
            matchResultAdapter,
            tracker,
            llmProvider
          );

          m.explanation = reasonResult.renderedExplanation;
        } catch (e: any) {
          m.explanation = `Error generating explanation: ${e.message}`;
        }
      }
    }
  }

  const tStage3End = Date.now();
  const tStage3Duration = tStage3End - tStage3Start;
  console.log(`  Generated ${generatedMatches.length} match decisions.\n`);

  // --------------------------------------------------------------------------
  // STAGE 4: Save Raw and Formatted Match Key Outputs
  // --------------------------------------------------------------------------
  console.log("Stage 4: Saving matching answer keys...");
  const tStage4Start = Date.now();

  // Include all matched and unmatched transactions
  const matchedBankIds = new Set<string>();
  const matchedBookIds = new Set<string>();

  for (const m of generatedMatches) {
    m.bankTransactionIds.forEach((id) => matchedBankIds.add(id));
    m.bookTransactionIds.forEach((id) => matchedBookIds.add(id));
  }

  // Gather unmatched bank rows
  const unmatchedBankRows = bankTxns.filter((t) => !matchedBankIds.has(t.id));
  // Gather unmatched book rows
  const unmatchedBookRows = bookTxns.filter((t) => !matchedBookIds.has(t.id));

  // Build the complete match outcome array
  const finalOutcomes: any[] = [];
  
  // 1. Matches
  generatedMatches.forEach((m, idx) => {
    finalOutcomes.push({
      id: `MATCH-${idx + 1}`,
      status: "MATCHED",
      match_type: m.matchType,
      bank_transaction_ids: m.bankTransactionIds.join(";"),
      book_transaction_ids: m.bookTransactionIds.join(";"),
      score: m.score,
      confidence_band: m.confidenceBand,
      risk_score: m.riskScore || 0,
      explanation: m.explanation || "N/A",
    });
  });

  // 2. Unmatched Bank
  unmatchedBankRows.forEach((t) => {
    finalOutcomes.push({
      id: `UNMATCHED-BANK-${t.id}`,
      status: "UNMATCHED_BANK",
      match_type: "unmatched",
      bank_transaction_ids: t.id,
      book_transaction_ids: "",
      score: 0,
      confidence_band: "NONE",
      risk_score: 100,
      explanation: `Bank transaction unmatched: ${t.description}`,
    });
  });

  // 3. Unmatched Book
  unmatchedBookRows.forEach((t) => {
    finalOutcomes.push({
      id: `UNMATCHED-BOOK-${t.id}`,
      status: "UNMATCHED_BOOK",
      match_type: "unmatched",
      bank_transaction_ids: "",
      book_transaction_ids: t.id,
      score: 0,
      confidence_band: "NONE",
      risk_score: 100,
      explanation: `Ledger entry unmatched: ${t.description || t.referenceNumber}`,
    });
  });

  // Write CSV Match Key
  const csvHeaders = "id,status,match_type,bank_transaction_ids,book_transaction_ids,score,confidence_band,risk_score,explanation\n";
  const csvContent = csvHeaders + finalOutcomes.map((o) => {
    const cleanExp = (o.explanation || "").replace(/"/g, '""');
    return `"${o.id}","${o.status}","${o.match_type}","${o.bank_transaction_ids}","${o.book_transaction_ids}",${o.score},"${o.confidence_band}",${o.risk_score},"${cleanExp}"`;
  }).join("\n");

  const runCsvPath = path.join(runDir, "pipeline_output_matches.csv");
  const runJsonPath = path.join(runDir, "pipeline_output_matches.json");
  const dataCsvCopyPath = path.join(__dirname, "..", "data", "pipeline_output_matches.csv");

  fs.writeFileSync(runCsvPath, csvContent);
  fs.writeFileSync(runJsonPath, JSON.stringify(finalOutcomes, null, 2));
  fs.writeFileSync(dataCsvCopyPath, csvContent);

  console.log(`  Saved human-readable CSV to ${runCsvPath}`);
  console.log(`  Saved copy of CSV to ${dataCsvCopyPath}`);
  console.log(`  Saved machine-readable JSON to ${runJsonPath}\n`);

  // --------------------------------------------------------------------------
  // STAGE 5: Validate and Compare with Ground Truth
  // --------------------------------------------------------------------------
  console.log("Stage 5: Validating scenario results against ground truth...");
  
  const groundTruthPath = path.join(__dirname, "..", "data", "ground_truth (1).json");
  const groundTruth = JSON.parse(fs.readFileSync(groundTruthPath, "utf-8"));
  const scenarios = groundTruth.primary_pair.matching_scenarios;

  let passedScenariosCount = 0;
  let failedScenariosCount = 0;

  const scenarioResultsRows: Array<{
    scenario_id: string;
    result: "PASS" | "WARN" | "FAIL";
    expected: string;
    actual: string;
    desc: string;
  }> = [];

  // TP, FP, FN counts for scenarios
  let TP = 0;
  let FP = 0;
  let FN = 0;
  let TN = 0;

  for (const sc of scenarios) {
    const id = sc.id;
    const expectedOutcome = sc.outcome;

    // Find the bank transaction loaded in database
    const dbBank = bankTxns.find((t) => t.description && t.description.includes(id + " "));
    
    // Find expected ledger rows
    const dbLedgerRows = bookTxns.filter((t) => {
      if (Array.isArray(sc.ledger_id)) {
        return sc.ledger_id.includes(t.referenceNumber || "");
      } else {
        return t.referenceNumber === sc.ledger_id;
      }
    });

    const isMatchExpected = !["unmatched_bank_only", "unmatched_ledger_only", "rejected_amount_too_far", "excluded_not_revenue"].includes(expectedOutcome);
    
    // Determine expected cardinality
    let expectedCardinality = "1:1";
    if (Array.isArray(sc.ledger_id)) {
      expectedCardinality = `1:${sc.ledger_id.length}`;
    } else if (!sc.ledger_id) {
      expectedCardinality = "1:0";
    }
    if (expectedOutcome === "unmatched_ledger_only") {
      expectedCardinality = "0:1";
    }

    if (expectedOutcome === "unmatched_ledger_only") {
      // Check that ledger rows are unmatched
      const ledgerMatches = generatedMatches.filter((m) =>
        m.bookTransactionIds.some((bid) => dbLedgerRows.some((l) => l.id === bid))
      );
      
      const isUnmatched = ledgerMatches.length === 0 || (ledgerMatches.length === 1 && ledgerMatches[0].matchType === "unmatched_ledger");
      
      if (isUnmatched) {
        scenarioResultsRows.push({
          scenario_id: id,
          result: "PASS",
          expected: expectedCardinality,
          actual: expectedCardinality,
          desc: sc.desc,
        });
        passedScenariosCount++;
        TN++;
      } else {
        scenarioResultsRows.push({
          scenario_id: id,
          result: "FAIL",
          expected: expectedCardinality,
          actual: `1:${ledgerMatches[0].bookTransactionIds.length}`,
          desc: sc.desc,
        });
        failedScenariosCount++;
        FP++;
      }
      continue;
    }

    if (!dbBank) {
      scenarioResultsRows.push({
        scenario_id: id,
        result: "FAIL",
        expected: expectedCardinality,
        actual: "MISSING_BANK_TX",
        desc: sc.desc,
      });
      failedScenariosCount++;
      if (isMatchExpected) FN++;
      continue;
    }

    // Find if matcher generated a match for this bank transaction
    const match = generatedMatches.find((m) => m.bankTransactionIds.includes(dbBank.id));

    if (!isMatchExpected) {
      // Expected: unmatched
      if (!match || match.matchType === "unmatched") {
        scenarioResultsRows.push({
          scenario_id: id,
          result: "PASS",
          expected: expectedCardinality,
          actual: expectedCardinality,
          desc: sc.desc,
        });
        passedScenariosCount++;
        TN++;
      } else {
        scenarioResultsRows.push({
          scenario_id: id,
          result: "FAIL",
          expected: expectedCardinality,
          actual: `1:${match.bookTransactionIds.length}`,
          desc: sc.desc,
        });
        failedScenariosCount++;
        FP++;
      }
      continue;
    }

    // Expected: matched
    if (!match) {
      scenarioResultsRows.push({
        scenario_id: id,
        result: "FAIL",
        expected: expectedCardinality,
        actual: "1:0",
        desc: sc.desc,
      });
      failedScenariosCount++;
      FN++;
      continue;
    }

    // Match exists. Check correctness of linked book/ledger entries
    const expectedLedgerIds = dbLedgerRows.map((l) => l.id).sort();
    const actualLedgerIds = [...match.bookTransactionIds].sort();

    const isSubset = expectedLedgerIds.every((id) => actualLedgerIds.includes(id));
    const isExact = expectedLedgerIds.length === actualLedgerIds.length && expectedLedgerIds.every((val, idx) => val === actualLedgerIds[idx]);

    const actualCardinality = `1:${match.bookTransactionIds.length}`;

    // Verify explanation generation quality (at least 20 chars)
    const hasValidExplanation = match.explanation && match.explanation.length > 20;

    // Verify confidence band calibrator alignment
    let confidenceValid = true;
    if (expectedOutcome === "auto_approved" || expectedOutcome === "auto_approved_careful" || expectedOutcome === "auto_approved_or_medium") {
      confidenceValid = ["VERY_HIGH", "HIGH", "MEDIUM"].includes(match.confidenceBand);
    } else if (expectedOutcome === "medium_review" || expectedOutcome === "low_review_boundary") {
      confidenceValid = ["MEDIUM", "LOW"].includes(match.confidenceBand);
    }

    if (!isSubset) {
      // Missing expected ledger entries in match
      scenarioResultsRows.push({
        scenario_id: id,
        result: "FAIL",
        expected: expectedCardinality,
        actual: actualCardinality + " (Incorrect ledger ids linked)",
        desc: sc.desc,
      });
      failedScenariosCount++;
      FN++;
    } else if (!confidenceValid) {
      // Confidence band calibrator regression
      scenarioResultsRows.push({
        scenario_id: id,
        result: "FAIL",
        expected: `Band for ${expectedOutcome}`,
        actual: `Band: ${match.confidenceBand}`,
        desc: sc.desc,
      });
      failedScenariosCount++;
      FN++;
    } else if (!hasValidExplanation) {
      // Bad explanation template
      scenarioResultsRows.push({
        scenario_id: id,
        result: "FAIL",
        expected: "Explanation > 20 chars",
        actual: `Length: ${match.explanation?.length || 0}`,
        desc: sc.desc,
      });
      failedScenariosCount++;
      FN++;
    } else if (isExact) {
      // Cardinality matches expected exactly
      scenarioResultsRows.push({
        scenario_id: id,
        result: "PASS",
        expected: expectedCardinality,
        actual: actualCardinality,
        desc: sc.desc,
      });
      passedScenariosCount++;
      TP++;
    } else {
      // Superset - expected matches found, plus some extra entries matched
      scenarioResultsRows.push({
        scenario_id: id,
        result: "WARN",
        expected: expectedCardinality,
        actual: actualCardinality,
        desc: sc.desc,
      });
      passedScenariosCount++; // Superset is a WARN but counts as passed scenario under partial credit
      TP++;
      FP += actualLedgerIds.length - expectedLedgerIds.length;
    }
  }

  // Write scenario results CSV
  const scenarioResultsCsvHeaders = "scenario_id,result,expected,actual,description\n";
  const scenarioResultsCsvContent = scenarioResultsCsvHeaders + scenarioResultsRows.map(
    (r) => `"${r.scenario_id}","${r.result}","${r.expected}","${r.actual}","${r.desc.replace(/"/g, '""')}"`
  ).join("\n");
  
  const scenarioCsvPath = path.join(runDir, "scenario_results.csv");
  fs.writeFileSync(scenarioCsvPath, scenarioResultsCsvContent);

  // Compute final quality metrics
  const precision = TP + FP > 0 ? TP / (TP + FP) : 0;
  const recall = TP + FN > 0 ? TP / (TP + FN) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  const passedGates = precision >= MIN_PRECISION && recall >= MIN_RECALL && f1 >= MIN_F1;

  const stageRuntimesMs = {
    ingestion: tStage2Duration,
    candidateGen: tCandidateGenDuration,
    matching: tMatchingDuration,
    total: Date.now() - globalStartTime,
  };

  const summary: AuditSummary = {
    runId,
    passedGates,
    precision,
    recall,
    f1,
    totalScenarios: scenarios.length,
    passedScenarios: passedScenariosCount,
    failedScenarios: failedScenariosCount,
    stageRuntimesMs,
    candidateSpaceReduction,
    thresholds: {
      precision: MIN_PRECISION,
      recall: MIN_RECALL,
      f1: MIN_F1,
    },
    aiReasoningEnabled,
    generatedAt: new Date().toISOString(),
  };

  const summaryJsonPath = path.join(runDir, "audit_summary.json");
  fs.writeFileSync(summaryJsonPath, JSON.stringify(summary, null, 2));

  // --------------------------------------------------------------------------
  // STAGE 6: Print Comprehensive Performance Dashboard
  // --------------------------------------------------------------------------
  console.log("\n==================================================");
  console.log("PIPELINE HEALTH");
  console.log("==================================================");
  console.log(`  Retrieval Stage:        PASS`);
  console.log(`  Ingestion (Fail-Fast):  PASS (0 failures)`);
  console.log(`  Candidate Gen Speed:    PASS (${tCandidateGenDuration}ms)`);
  console.log(`  Matching Execution:     PASS (${tMatchingDuration}ms)`);
  console.log(`  AI Reasoning:           ${aiReasoningEnabled ? "ENABLED" : "BYPASSED (STATIC FALLBACKS)"}`);

  console.log("\n==================================================");
  console.log("MATCH QUALITY");
  console.log("==================================================");
  console.log(`  True Positives (TP):    ${TP}`);
  console.log(`  False Positives (FP):   ${FP}`);
  console.log(`  False Negatives (FN):   ${FN}`);
  console.log(`  True Negatives (TN):    ${TN}`);
  console.log("  ----------------------------------");
  console.log(`  Precision:              ${(precision * 100).toFixed(2)}% (Min Gate: ${(MIN_PRECISION * 100).toFixed(2)}%)`);
  console.log(`  Recall:                 ${(recall * 100).toFixed(2)}% (Min Gate: ${(MIN_RECALL * 100).toFixed(2)}%)`);
  console.log(`  F1 Score:               ${(f1 * 100).toFixed(2)}% (Min Gate: ${(MIN_F1 * 100).toFixed(2)}%)`);
  console.log("  ----------------------------------");
  console.log(`  Overall Success Gate:   ${passedGates ? "✅ PASSED" : "❌ FAILED (metrics below threshold)"}`);

  console.log("\n==================================================");
  console.log("RUNTIME METRICS");
  console.log("==================================================");
  console.log(`  Ingestion & In-Memory Ingest: ${(stageRuntimesMs.ingestion / 1000).toFixed(2)}s`);
  console.log(`  Candidate Generation:         ${(stageRuntimesMs.candidateGen / 1000).toFixed(2)}s`);
  console.log(`  Matching Engine:              ${(stageRuntimesMs.matching / 1000).toFixed(2)}s`);
  console.log(`  Total End-to-End Runtime:     ${(stageRuntimesMs.total / 1000).toFixed(2)}s`);

  console.log("\n==================================================");
  console.log("SCENARIOS EVALUATION DETAILED RESULTS");
  console.log("==================================================");
  scenarioResultsRows.forEach((r) => {
    const sym = r.result === "PASS" ? "✅" : r.result === "WARN" ? "⚠️" : "❌";
    console.log(`  ${sym} Scenario ${r.scenario_id.padEnd(4)} | Result: ${r.result.padEnd(4)} | Expected: ${r.expected.padEnd(5)} | Actual: ${r.actual.padEnd(5)} | ${r.desc}`);
  });
  console.log("==================================================");
  console.log(`  Scenarios Run:          ${scenarios.length}`);
  console.log(`  Passed Scenarios:       ${passedScenariosCount}`);
  console.log(`  Failed Scenarios:       ${failedScenariosCount}`);
  console.log("==================================================");

  if (!passedGates) {
    console.error("\n❌ Regression gate check failed: Match quality fell below 95% threshold.");
    process.exit(1);
  } else {
    console.log("\n🎉 E2E Benchmarking & Regression run completed successfully!");
  }
}

// Helpers
function generateRunId(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const rand = Math.random().toString(36).substring(2, 6);
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}_${pad(now.getSeconds())}_${rand}`;
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
    matchingSignals: row.metadata?.matchingSignals || {},
  };
}

function assertNoFailure(ingestStats: { successCount: number; failureCount: number }, filename: string) {
  if (ingestStats.failureCount > 0) {
    console.error(`🛑 FATAL: Parsing and Ingestion failed for ${filename} with ${ingestStats.failureCount} errors.`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
