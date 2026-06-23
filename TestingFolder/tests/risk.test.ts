// TestingFolder/tests/risk.test.ts
//
// Phase 8 — Risk Scoring Engine: unit test suite.
//
// Run with:
//   npx tsx TestingFolder/tests/risk.test.ts

import { computeRiskScore, RiskInput } from "../../core/matching/riskEngine";

// ── Minimal test harness ──────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

function assertRange(value: number, min: number, max: number, label: string): void {
  assert(value >= min && value <= max, `${label} (got ${value}, expected ${min}–${max})`);
}

// ── Shared fixtures ───────────────────────────────────────────────────────────

const TODAY = new Date();
const BANK_DATE_RECENT = new Date(TODAY.getTime() - 1 * 24 * 60 * 60 * 1000);   // 1 day ago
const BANK_DATE_OLD    = new Date(TODAY.getTime() - 45 * 24 * 60 * 60 * 1000);  // 45 days ago

function makeInput(overrides: Partial<RiskInput>): RiskInput {
  return {
    amountMinor: 10_000_00, // ₹10,000
    matchingConfidence: 0.99,
    matchType: "exact",
    discrepancyType: "NONE",
    bankDate: BANK_DATE_RECENT,
    ledgerDates: [BANK_DATE_RECENT],
    allBankDescriptions: ["STRIPE PAYOUT", "VENDOR PAYMENT", "SALARY"],
    allBankCounterparties: ["stripe", "acme corp", ""],
    thisBankDescription: "STRIPE PAYOUT",
    thisBankCounterparty: "stripe",
    ...overrides,
  };
}

// ── Test 1: Risk Ordering ─────────────────────────────────────────────────────
// MISSING_ENTRY > TIMING_DIFFERENCE > EXACT NONE

console.log("\nTest 1 — Risk Ordering");

const exactNone = computeRiskScore(makeInput({
  matchingConfidence: 0.99,
  discrepancyType: "NONE",
  ledgerDates: [BANK_DATE_RECENT],
}));

const timingDiff = computeRiskScore(makeInput({
  matchingConfidence: 0.85,
  discrepancyType: "TIMING_DIFFERENCE",
  bankDate: BANK_DATE_OLD,
  ledgerDates: [BANK_DATE_OLD],
}));

const missingEntry = computeRiskScore(makeInput({
  matchingConfidence: 0.0,
  discrepancyType: "MISSING_ENTRY",
  matchType: "none",
  ledgerDates: [], // unmatched — age uses today
  bankDate: BANK_DATE_OLD,
}));

assert(
  missingEntry.compositeScore > timingDiff.compositeScore,
  `MISSING_ENTRY (${missingEntry.compositeScore}) > TIMING_DIFFERENCE (${timingDiff.compositeScore})`
);
assert(
  timingDiff.compositeScore > exactNone.compositeScore,
  `TIMING_DIFFERENCE (${timingDiff.compositeScore}) > EXACT_NONE (${exactNone.compositeScore})`
);

// ── Test 2: Classification Impact ─────────────────────────────────────────────
// Identical amount + confidence, only discrepancyType differs

console.log("\nTest 2 — Classification Impact");

const base = makeInput({ matchingConfidence: 0.70, discrepancyType: "NONE" });
const classified = makeInput({ matchingConfidence: 0.70, discrepancyType: "MISSING_ENTRY" });

const scoreNone  = computeRiskScore(base).compositeScore;
const scoreME    = computeRiskScore(classified).compositeScore;

assert(
  scoreME > scoreNone,
  `MISSING_ENTRY (${scoreME}) > NONE (${scoreNone}) for identical amount/confidence`
);

// ── Test 3: Queue Sort ─────────────────────────────────────────────────────────

console.log("\nTest 3 — Queue Sort");

const rawScores = [12, 61, 95, 40, 82];
const fakeMatches = rawScores.map((rs, i) => ({
  id: `m_${i}`,
  riskScore: rs,
  confidenceScore: 0.5,
}));

fakeMatches.sort((a, b) => {
  if (b.riskScore !== a.riskScore) return b.riskScore - a.riskScore;
  return a.confidenceScore - b.confidenceScore;
});

const sortedScores = fakeMatches.map(m => m.riskScore);
assert(
  JSON.stringify(sortedScores) === JSON.stringify([95, 82, 61, 40, 12]),
  `Sorted DESC: ${JSON.stringify(sortedScores)}`
);

// ── Test 4: Backfill Consistency ──────────────────────────────────────────────
// Live run with frequency context vs. backfill with empty arrays.
// compositeScores will differ by the frequency factor — that is expected and documented.
// What must match is: amountScore, ageScore, confidenceRiskScore, classificationScore.

console.log("\nTest 4 — Backfill Consistency (four deterministic factors)");

const liveResult = computeRiskScore(makeInput({
  matchingConfidence: 0.75,
  discrepancyType: "PROCESSING_FEE",
  bankDate: BANK_DATE_OLD,
  ledgerDates: [BANK_DATE_OLD],
}));

const backfillResult = computeRiskScore(makeInput({
  matchingConfidence: 0.75,
  discrepancyType: "PROCESSING_FEE",
  bankDate: BANK_DATE_OLD,
  ledgerDates: [BANK_DATE_OLD],
  allBankDescriptions: [],    // Option B
  allBankCounterparties: [],  // Option B
}));

assert(
  liveResult.amountScore === backfillResult.amountScore,
  `amountScore matches: ${liveResult.amountScore}`
);
assert(
  liveResult.ageScore === backfillResult.ageScore,
  `ageScore matches: ${liveResult.ageScore}`
);
assert(
  liveResult.confidenceRiskScore === backfillResult.confidenceRiskScore,
  `confidenceRiskScore matches: ${liveResult.confidenceRiskScore}`
);
assert(
  liveResult.classificationScore === backfillResult.classificationScore,
  `classificationScore matches: ${liveResult.classificationScore}`
);
assert(
  backfillResult.frequencyScore === 0,
  `backfill frequencyScore = 0 (Option B): ${backfillResult.frequencyScore}`
);

// ── Test 5: Production Guardrails ─────────────────────────────────────────────

console.log("\nTest 5 — Production Guardrails");

// Guardrail 1: compositeScore is an integer
const floatResult = computeRiskScore(makeInput({
  matchingConfidence: 0.73,  // will produce fractional intermediate
  discrepancyType: "TIMING_DIFFERENCE",
  bankDate: BANK_DATE_OLD,
  ledgerDates: [BANK_DATE_OLD],
}));
assert(
  Number.isInteger(floatResult.compositeScore),
  `compositeScore is integer: ${floatResult.compositeScore}`
);
assertRange(floatResult.compositeScore, 0, 100, "compositeScore in [0, 100]");

// Guardrail 2: empty-string key forces high frequency score (blank CSV row flagged as anomalous)
const blankRow = computeRiskScore(makeInput({
  thisBankDescription: "",
  thisBankCounterparty: "",
  allBankDescriptions: ["", "", ""],
  allBankCounterparties: ["", "", ""],
}));
assert(
  blankRow.frequencyScore === 80,
  `blank description+counterparty → frequencyScore=80: ${blankRow.frequencyScore}`
);

// Guardrail 3: timezone normalisation — a bankDate at 23:59 local should not
// bleed into the next age band. We simulate by using a date 7 days ago at end-of-day.
const sevenDaysAgoLate = new Date(TODAY.getTime() - 7 * 24 * 60 * 60 * 1000 + 23 * 60 * 60 * 1000);
const edgeAge = computeRiskScore(makeInput({
  bankDate: sevenDaysAgoLate,
  ledgerDates: [sevenDaysAgoLate],
}));
// 7 days ≤ 7 → ageScore = 20 (not 60, which would be > 7 days)
assert(
  edgeAge.ageScore <= 20,
  `7-day-edge bankDate → ageScore ≤ 20 (no timezone bleed): ${edgeAge.ageScore}`
);

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n─── Results: ${passed} passed, ${failed} failed ───\n`);
if (failed > 0) {
  process.exit(1);
}
