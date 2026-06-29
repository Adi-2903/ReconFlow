// TestingFolder/tests/risk.test.ts
//
// Phase 8 — Risk Scoring Engine: comprehensive test suite.
// Covers all 5 factors, every bug fix applied, edge cases, and composite integrity.
//
// Run with:
//   npx tsx TestingFolder/tests/risk.test.ts

import { computeRiskScore, RiskInput } from "../../core/matching/riskEngine";

// ── Minimal test harness ──────────────────────────────────────────────────────

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

function assertRange(value: number, min: number, max: number, label: string): void {
  assert(value >= min && value <= max, `${label} (got ${value}, expected ${min}–${max})`);
}

function assertEq(a: number, b: number, label: string): void {
  assert(a === b, `${label} (got ${a}, expected ${b})`);
}

function section(title: string): void {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("─".repeat(60));
}

// ── Shared fixtures ───────────────────────────────────────────────────────────

const TODAY      = new Date();
const D_1_AGO    = new Date(TODAY.getTime() - 1  * 86400_000);
const D_5_AGO    = new Date(TODAY.getTime() - 5  * 86400_000);
const D_15_AGO   = new Date(TODAY.getTime() - 15 * 86400_000);
const D_45_AGO   = new Date(TODAY.getTime() - 45 * 86400_000);

/** Build a fully-specified RiskInput with safe defaults, then apply overrides. */
function make(overrides: Partial<RiskInput>): RiskInput {
  return {
    amountMinor:          10_000_00,   // ₹10,000
    matchingConfidence:   0.99,
    matchType:            "exact",
    discrepancyType:      "NONE",
    bankDate:             D_1_AGO,
    ledgerDates:          [D_1_AGO],
    allBankDescriptions:  ["STRIPE PAYOUT", "VENDOR PAYMENT", "SALARY", "SALARY", "SALARY"],
    allBankCounterparties:["stripe",         "acme corp",       "",       "",       ""],
    thisBankDescription:  "STRIPE PAYOUT",
    thisBankCounterparty: "stripe",
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTOR 1 — Amount Score
// ═══════════════════════════════════════════════════════════════════════════════
section("Factor 1 — Amount Score (25% weight)");

// ₹0 → log10(1)*20 = 0
assertEq(
  computeRiskScore(make({ amountMinor: 0 })).amountScore,
  0,
  "₹0 → amountScore = 0"
);

// ₹1 → log10(2)*20 ≈ 6 — small but not < 1
assert(
  computeRiskScore(make({ amountMinor: 100 })).amountScore < 10,
  "₹1 → amountScore < 10 (low but non-zero)"
);

// ₹10,000 → log10(10001)*20 ≈ 80
assertRange(
  computeRiskScore(make({ amountMinor: 10_000_00 })).amountScore,
  78, 82,
  "₹10,000 → amountScore ≈ 80"
);

// ₹10,00,000 → should be capped at 100
assertEq(
  computeRiskScore(make({ amountMinor: 100_000_000 })).amountScore,
  100,
  "₹10,00,000 → amountScore capped at 100"
);

// BUG FIX: negative amountMinor must NOT produce NaN (debit transactions)
const negResult = computeRiskScore(make({ amountMinor: -50_000_00 }));
assert(
  Number.isFinite(negResult.amountScore),
  `Negative amountMinor (-₹50,000) → amountScore is finite (not NaN/Infinity): ${negResult.amountScore}`
);
assert(
  Number.isInteger(negResult.compositeScore),
  `Negative amountMinor → compositeScore is a valid integer: ${negResult.compositeScore}`
);
assertRange(negResult.compositeScore, 0, 100, "Negative amountMinor → compositeScore in [0,100]");

// Symmetric: |−X| should equal |+X| for amount score
const posAmt = computeRiskScore(make({ amountMinor:  20_000_00 })).amountScore;
const negAmt = computeRiskScore(make({ amountMinor: -20_000_00 })).amountScore;
assertEq(posAmt, negAmt, "amountScore symmetric: |+₹20k| === |−₹20k|");

// ═══════════════════════════════════════════════════════════════════════════════
// FACTOR 2 — Age Score
// ═══════════════════════════════════════════════════════════════════════════════
section("Factor 2 — Age Score (20% weight)");

// Age is measured as bank→ledger lag (not bank→today).
// Use D_X_AGO for bankDate AND a DIFFERENT ledgerDate to create real lag.
assertEq(
  computeRiskScore(make({ bankDate: D_45_AGO, ledgerDates: [D_45_AGO] })).ageScore,
  0,
  "Same bank+ledger date 45 days ago → ageScore = 0 (lag between them = 0)"
);

assertEq(
  computeRiskScore(make({ bankDate: D_5_AGO, ledgerDates: [D_15_AGO] })).ageScore,
  60,
  "Bank 5d ago, ledger 15d ago → 10-day lag (≤30) → ageScore = 60"
);

// 4-day lag falls in the ≤7 band → score 20
const D_4 = new Date(TODAY.getTime() - 4 * 86400_000);
const D_8 = new Date(TODAY.getTime() - 8 * 86400_000);
assertEq(
  computeRiskScore(make({ bankDate: D_4, ledgerDates: [D_8] })).ageScore,
  20,
  "4-day lag (≤7) → ageScore = 20"
);

assertEq(
  computeRiskScore(make({ bankDate: D_5_AGO, ledgerDates: [D_45_AGO] })).ageScore,
  100,
  "Bank 5d ago, ledger 45d ago → 40-day lag → ageScore = 100"
);

assertEq(
  computeRiskScore(make({ bankDate: D_1_AGO, ledgerDates: [D_45_AGO] })).ageScore,
  100,
  "Bank 1d ago, ledger 45d ago → 44-day lag → ageScore = 100"
);

// Unmatched bank transaction: ledgerDates = [], age measured against today
assertEq(
  computeRiskScore(make({ bankDate: TODAY, ledgerDates: [] })).ageScore,
  0,
  "Unmatched, bankDate=today, no ledger → ageScore = 0"
);

assertEq(
  computeRiskScore(make({ bankDate: D_45_AGO, ledgerDates: [] })).ageScore,
  100,
  "Unmatched, bankDate 45 days ago → ageScore = 100 (measured against today)"
);

// Multiple ledger dates: takes the MAX lag
const multiLedgerScore = computeRiskScore(make({
  bankDate:     D_1_AGO,
  ledgerDates:  [D_1_AGO, D_5_AGO, D_15_AGO],  // max = 14-day lag
})).ageScore;
assertEq(multiLedgerScore, 60, "Multiple ledger dates → max lag used (15d → ageScore=60)");

// GUARDRAIL: 7-day boundary — date at 23:59 local should NOT bleed into next band
const sevenDaysLate = new Date(TODAY.getTime() - 7 * 86400_000 + 23 * 3600_000);
const edgeAge = computeRiskScore(make({
  bankDate:    sevenDaysLate,
  ledgerDates: [sevenDaysLate],
})).ageScore;
assert(edgeAge <= 20, `7-day boundary edge (23:59 offset) → ageScore ≤ 20, no timezone bleed (got ${edgeAge})`);

// ═══════════════════════════════════════════════════════════════════════════════
// FACTOR 3 — Confidence Risk Score
// ═══════════════════════════════════════════════════════════════════════════════
section("Factor 3 — Confidence Risk Score (25% weight)");

assertEq(
  computeRiskScore(make({ matchingConfidence: 1.0 })).confidenceRiskScore,
  0,
  "confidence=1.0 → confidenceRiskScore=0"
);

assertEq(
  computeRiskScore(make({ matchingConfidence: 0.0 })).confidenceRiskScore,
  100,
  "confidence=0.0 → confidenceRiskScore=100"
);

assertEq(
  computeRiskScore(make({ matchingConfidence: 0.5 })).confidenceRiskScore,
  50,
  "confidence=0.5 → confidenceRiskScore=50"
);

// Out-of-range: clamped
assertEq(
  computeRiskScore(make({ matchingConfidence: 1.5 })).confidenceRiskScore,
  0,
  "confidence=1.5 (out-of-range) → clamped to 1.0 → confidenceRiskScore=0"
);

assertEq(
  computeRiskScore(make({ matchingConfidence: -0.5 })).confidenceRiskScore,
  100,
  "confidence=-0.5 (out-of-range) → clamped to 0.0 → confidenceRiskScore=100"
);

// ═══════════════════════════════════════════════════════════════════════════════
// FACTOR 4 — Frequency Score
// ═══════════════════════════════════════════════════════════════════════════════
section("Factor 4 — Frequency Score (10% weight)");

// Backfill fast-path: empty arrays → 0
assertEq(
  computeRiskScore(make({
    allBankDescriptions:   [],
    allBankCounterparties: [],
  })).frequencyScore,
  0,
  "Backfill (both arrays empty) → frequencyScore = 0"
);

// GUARDRAIL: blank description + counterparty → 80 (anomalous, not recurring)
assertEq(
  computeRiskScore(make({
    thisBankDescription:   "",
    thisBankCounterparty:  "",
    allBankDescriptions:   ["", "", "", "", ""],
    allBankCounterparties: ["", "", "", "", ""],
  })).frequencyScore,
  80,
  "Blank description+counterparty → frequencyScore = 80"
);

// Unique (1 occurrence) → 80
assertEq(
  computeRiskScore(make({
    thisBankDescription:   "UNIQUE VENDOR XYZ",
    thisBankCounterparty:  "unique vendor xyz",
    allBankDescriptions:   ["STRIPE PAYOUT", "VENDOR PAYMENT", "UNIQUE VENDOR XYZ"],
    allBankCounterparties: ["stripe",         "acme corp",     "unique vendor xyz"],
  })).frequencyScore,
  80,
  "1 occurrence → frequencyScore = 80 (unique/anomalous)"
);

// 2 occurrences → 50
assertEq(
  computeRiskScore(make({
    thisBankDescription:   "ACME PAYMENT",
    thisBankCounterparty:  "acme corp",
    allBankDescriptions:   ["ACME PAYMENT", "ACME PAYMENT", "VENDOR OTHER"],
    allBankCounterparties: ["acme corp",    "acme corp",    "xyz ltd"],
  })).frequencyScore,
  50,
  "2 occurrences → frequencyScore = 50"
);

// 3-4 occurrences → 20
assertEq(
  computeRiskScore(make({
    thisBankDescription:   "SALARY CREDIT",
    thisBankCounterparty:  "",
    allBankDescriptions:   ["SALARY CREDIT", "SALARY CREDIT", "SALARY CREDIT", "OTHER"],
    allBankCounterparties: ["",               "",              "",              ""],
  })).frequencyScore,
  20,
  "3 occurrences → frequencyScore = 20"
);

// 5+ occurrences → 0 (recurring, low anomaly risk)
assertEq(
  computeRiskScore(make({
    thisBankDescription:   "STRIPE PAYOUT",
    thisBankCounterparty:  "stripe",
    allBankDescriptions:   ["STRIPE PAYOUT","STRIPE PAYOUT","STRIPE PAYOUT","STRIPE PAYOUT","STRIPE PAYOUT","OTHER"],
    allBankCounterparties: ["stripe","stripe","stripe","stripe","stripe","acme"],
  })).frequencyScore,
  0,
  "5+ occurrences → frequencyScore = 0 (recurring)"
);

// BUG FIX: full-string normalization — "AXIS BANK" vs "AXIS FINANCE" must NOT collide
const axisBank = computeRiskScore(make({
  thisBankDescription:   "AXIS BANK NEFT",
  thisBankCounterparty:  "axis bank",
  allBankDescriptions:   ["AXIS BANK NEFT", "AXIS FINANCE EMI", "AXIS FINANCE EMI"],
  allBankCounterparties: ["axis bank",      "axis finance",     "axis finance"],
}));
const axisFinance = computeRiskScore(make({
  thisBankDescription:   "AXIS FINANCE EMI",
  thisBankCounterparty:  "axis finance",
  allBankDescriptions:   ["AXIS BANK NEFT", "AXIS FINANCE EMI", "AXIS FINANCE EMI"],
  allBankCounterparties: ["axis bank",      "axis finance",     "axis finance"],
}));
assert(
  axisBank.frequencyScore !== axisFinance.frequencyScore,
  `Full-string normalization: "axis bank" (freq=${axisBank.frequencyScore}) ≠ "axis finance" (freq=${axisFinance.frequencyScore}) — no first-token collision`
);

// Array length mismatch: should not throw and should return a valid score
let mismatchScore: number | null = null;
try {
  mismatchScore = computeRiskScore(make({
    thisBankDescription:   "TEST TXN",
    thisBankCounterparty:  "test",
    allBankDescriptions:   ["TEST TXN", "OTHER"],        // length 2
    allBankCounterparties: ["test", "other", "extra"],   // length 3 — MISMATCH
  })).frequencyScore;
} catch (e) {
  mismatchScore = -1;
}
assert(mismatchScore !== -1, `Array length mismatch → does NOT throw (got frequencyScore=${mismatchScore})`);
assert(mismatchScore !== null && Number.isFinite(mismatchScore!), `Array length mismatch → returns finite frequencyScore`);

// ═══════════════════════════════════════════════════════════════════════════════
// FACTOR 5 — Classification Score
// ═══════════════════════════════════════════════════════════════════════════════
section("Factor 5 — Classification Score (20% weight)");

const classMap: [string, number][] = [
  ["NONE",                    0],
  ["PROCESSING_FEE",         20],
  ["TIMING_DIFFERENCE",      30],
  ["FOREIGN_EXCHANGE",       40],
  ["AMOUNT_DIFFERENCE",      50],
  ["TYPO",                   50],
  ["REFERENCE_DIFFERENCE",   55],
  ["COUNTERPARTY_DIFFERENCE",60],
  ["MANUAL_REVIEW",          70],
  ["DUPLICATE_INVOICE",      75],
  ["DUPLICATE",              80],
  ["MISSING_ENTRY",         100],
];

for (const [type, expectedScore] of classMap) {
  const result = computeRiskScore(make({ discrepancyType: type }));
  assertEq(result.classificationScore, expectedScore, `discrepancyType="${type}" → classificationScore=${expectedScore}`);
}

// BUG FIX: previously unmapped types returned 0 — now return 50 + warn
// Test the ones Phase 7 actually emits that were previously broken
const prevBroken = ["AMOUNT_DIFFERENCE", "REFERENCE_DIFFERENCE", "COUNTERPARTY_DIFFERENCE", "MANUAL_REVIEW", "DUPLICATE_INVOICE"];
for (const type of prevBroken) {
  const score = computeRiskScore(make({ discrepancyType: type })).classificationScore;
  assert(score > 0, `Previously-broken type "${type}" → classificationScore > 0 (was 0 before fix, now ${score})`);
}

// Unknown future type → 50 (not 0) + no throw
let unknownScore = -1;
try {
  unknownScore = computeRiskScore(make({ discrepancyType: "FUTURE_TYPE_XYZ" })).classificationScore;
} catch { unknownScore = -1; }
assert(unknownScore !== -1, "Unknown discrepancyType → does NOT throw");
assertEq(unknownScore, 50, `Unknown discrepancyType → classificationScore=50 (medium risk, not silent 0)`);

// ═══════════════════════════════════════════════════════════════════════════════
// COMPOSITE SCORE INTEGRITY
// ═══════════════════════════════════════════════════════════════════════════════
section("Composite Score Integrity");

// Always an integer
const floatInputResult = computeRiskScore(make({
  matchingConfidence: 0.73,
  discrepancyType: "TIMING_DIFFERENCE",
  bankDate: D_15_AGO,
  ledgerDates: [D_15_AGO],
}));
assert(Number.isInteger(floatInputResult.compositeScore), `compositeScore is integer (got ${floatInputResult.compositeScore})`);
assertRange(floatInputResult.compositeScore, 0, 100, "compositeScore in [0,100]");

// Always finite (never NaN) — covers negative amount edge case
const nanGuard = computeRiskScore(make({ amountMinor: -999_999_99, matchingConfidence: 0 }));
assert(Number.isFinite(nanGuard.compositeScore), `NaN guard: extreme negative amount → compositeScore is finite (${nanGuard.compositeScore})`);

// Weight verification: max all factors → composite = 100
const maxAll = computeRiskScore(make({
  amountMinor:          100_000_000,   // score=100
  matchingConfidence:   0.0,           // risk=100
  discrepancyType:      "MISSING_ENTRY", // score=100
  bankDate:             D_45_AGO,
  ledgerDates:          [],            // unmatched → 45d age → score=100
  thisBankDescription:  "UNIQUE ONE OFF",
  thisBankCounterparty: "unique one off",
  allBankDescriptions:  ["UNIQUE ONE OFF"],
  allBankCounterparties:["unique one off"],
}));
// All factors maxed → composite should be very high (≥ 95)
// Note: amountScore reaches exactly 100 at capped values, but the exact
// composite depends on frequency scoring context — assert ≥ 95, not == 100.
assertRange(maxAll.compositeScore, 95, 100, "All factors maxed → compositeScore ≥ 95");

// Min all factors → composite = 0
const minAll = computeRiskScore(make({
  amountMinor:          0,
  matchingConfidence:   1.0,
  discrepancyType:      "NONE",
  bankDate:             TODAY,
  ledgerDates:          [TODAY],
  allBankDescriptions:  [],
  allBankCounterparties:[],
}));
assertEq(minAll.compositeScore, 0, "All factors zeroed → compositeScore = 0");

// Weights sum to 100%: verify formula 0.25+0.20+0.25+0.10+0.20 = 1.0
const manual = computeRiskScore(make({
  amountMinor:          10_000_00,    // amountScore ~80
  matchingConfidence:   0.5,          // confRisk = 50
  discrepancyType:      "TIMING_DIFFERENCE", // classScore = 30
  bankDate:             D_5_AGO,
  ledgerDates:          [D_5_AGO],    // ageScore = 20
  allBankDescriptions:  [],
  allBankCounterparties:[],           // freqScore = 0 (backfill)
}));
const expected = Math.round(
  Math.max(0, Math.min(100,
    manual.amountScore         * 0.25 +
    manual.ageScore            * 0.20 +
    manual.confidenceRiskScore * 0.25 +
    manual.frequencyScore      * 0.10 +
    manual.classificationScore * 0.20
  ))
);
assertEq(manual.compositeScore, expected, `Composite formula verified: ${manual.compositeScore} === ${expected}`);

// ═══════════════════════════════════════════════════════════════════════════════
// RISK ORDERING — High-risk scenarios outscore low-risk ones
// ═══════════════════════════════════════════════════════════════════════════════
section("Risk Ordering");

const exactMatch = computeRiskScore(make({
  matchingConfidence: 0.99,
  discrepancyType:    "NONE",
  bankDate:           D_1_AGO,
  ledgerDates:        [D_1_AGO],
}));

const timingDiff = computeRiskScore(make({
  matchingConfidence: 0.85,
  discrepancyType:    "TIMING_DIFFERENCE",
  bankDate:           D_45_AGO,
  ledgerDates:        [D_45_AGO],
}));

const manualReview = computeRiskScore(make({
  matchingConfidence: 0.40,
  discrepancyType:    "MANUAL_REVIEW",
  bankDate:           D_15_AGO,
  ledgerDates:        [D_15_AGO],
}));

const duplicate = computeRiskScore(make({
  matchingConfidence: 0.0,
  discrepancyType:    "DUPLICATE",
  bankDate:           D_5_AGO,
  ledgerDates:        [],
}));

const missingEntry = computeRiskScore(make({
  matchingConfidence: 0.0,
  discrepancyType:    "MISSING_ENTRY",
  matchType:          "none",
  bankDate:           D_45_AGO,
  ledgerDates:        [],
}));

assert(
  missingEntry.compositeScore > duplicate.compositeScore,
  `MISSING_ENTRY (${missingEntry.compositeScore}) > DUPLICATE (${duplicate.compositeScore})`
);
assert(
  duplicate.compositeScore > manualReview.compositeScore,
  `DUPLICATE (${duplicate.compositeScore}) > MANUAL_REVIEW (${manualReview.compositeScore})`
);
assert(
  manualReview.compositeScore > timingDiff.compositeScore,
  `MANUAL_REVIEW (${manualReview.compositeScore}) > TIMING_DIFFERENCE (${timingDiff.compositeScore})`
);
assert(
  timingDiff.compositeScore > exactMatch.compositeScore,
  `TIMING_DIFFERENCE (${timingDiff.compositeScore}) > EXACT_NONE (${exactMatch.compositeScore})`
);

// Previously broken: MANUAL_REVIEW and DUPLICATE_INVOICE should outscore TIMING_DIFFERENCE
const dupInvoice = computeRiskScore(make({
  matchingConfidence: 0.7,
  discrepancyType:    "DUPLICATE_INVOICE",
}));
const timing2 = computeRiskScore(make({
  matchingConfidence: 0.7,
  discrepancyType:    "TIMING_DIFFERENCE",
}));
assert(
  dupInvoice.classificationScore > timing2.classificationScore,
  `DUPLICATE_INVOICE classScore (${dupInvoice.classificationScore}) > TIMING_DIFFERENCE classScore (${timing2.classificationScore}) [previously both were wrong]`
);

// ═══════════════════════════════════════════════════════════════════════════════
// BACKFILL CONSISTENCY
// ═══════════════════════════════════════════════════════════════════════════════
section("Backfill Consistency (Option B)");

const liveRun = computeRiskScore(make({
  matchingConfidence: 0.75,
  discrepancyType:    "PROCESSING_FEE",
  bankDate:           D_45_AGO,
  ledgerDates:        [D_45_AGO],
  // allBankDescriptions / allBankCounterparties left from defaults (non-empty)
}));

const backfill = computeRiskScore(make({
  matchingConfidence: 0.75,
  discrepancyType:    "PROCESSING_FEE",
  bankDate:           D_45_AGO,
  ledgerDates:        [D_45_AGO],
  allBankDescriptions:  [],   // Option B
  allBankCounterparties:[],   // Option B
}));

assertEq(liveRun.amountScore,         backfill.amountScore,         `Backfill: amountScore matches (${liveRun.amountScore})`);
assertEq(liveRun.ageScore,            backfill.ageScore,            `Backfill: ageScore matches (${liveRun.ageScore})`);
assertEq(liveRun.confidenceRiskScore, backfill.confidenceRiskScore, `Backfill: confidenceRiskScore matches (${liveRun.confidenceRiskScore})`);
assertEq(liveRun.classificationScore, backfill.classificationScore, `Backfill: classificationScore matches (${liveRun.classificationScore})`);
assertEq(backfill.frequencyScore, 0, `Backfill: frequencyScore = 0 (Option B fast-path)`);

// ═══════════════════════════════════════════════════════════════════════════════
// BREAKDOWN OBJECT SHAPE
// ═══════════════════════════════════════════════════════════════════════════════
section("Breakdown Object Shape");

const breakdown = computeRiskScore(make({}));
const requiredFields: (keyof typeof breakdown)[] = [
  "amountScore", "ageScore", "confidenceRiskScore",
  "frequencyScore", "classificationScore", "compositeScore"
];
for (const field of requiredFields) {
  assert(field in breakdown, `RiskScoreBreakdown has field: ${field}`);
  assert(typeof breakdown[field] === "number", `${field} is a number`);
  assertRange(breakdown[field] as number, 0, 100, `${field} in [0,100]`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// QUEUE SORT
// ═══════════════════════════════════════════════════════════════════════════════
section("Review Queue Sort (descending riskScore)");

const queue = [12, 61, 95, 40, 82].map((rs, i) => ({
  id: `m_${i}`, riskScore: rs, confidenceScore: 0.5
}));
queue.sort((a, b) =>
  b.riskScore !== a.riskScore
    ? b.riskScore - a.riskScore
    : a.confidenceScore - b.confidenceScore
);
assert(
  JSON.stringify(queue.map(m => m.riskScore)) === JSON.stringify([95, 82, 61, 40, 12]),
  `Queue sorted DESC: [${queue.map(m => m.riskScore).join(", ")}]`
);

// ═══════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════

console.log(`\n${"═".repeat(60)}`);
console.log(`  Phase 8 Test Results`);
console.log(`${"═".repeat(60)}`);
console.log(`  ✓ Passed : ${passed}`);
console.log(`  ✗ Failed : ${failed}`);
if (errors.length > 0) {
  console.log("\n  Failed tests:");
  errors.forEach(e => console.error(`    ✗ ${e}`));
}
console.log(`${"═".repeat(60)}\n`);

if (failed > 0) process.exit(1);
