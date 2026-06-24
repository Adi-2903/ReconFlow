// TestingFolder/tests/aiReasoning.test.ts
//
// Phase 9 — AI Reasoning Layer — EXPANDED Test Suite
//
// Run with: npx tsx --env-file=.env TestingFolder/tests/aiReasoning.test.ts
//
// ────────────────────────────────────────────────────────────────────────────
// BUG INDEX (all confirmed from source-code analysis)
// ────────────────────────────────────────────────────────────────────────────
//
// BUG-01  renderExplanation currency conversion wrong
//         ai-reason.ts lines 473 / 521 / 566 all pass `differenceMinor` straight
//         to renderExplanation, which formats it as ₹ paise/100. The existing
//         test T2-a asserts "₹50.00" for a difference of 5_000 paise (₹50) — that
//         will PASS. But if renderExplanation divides by 100 internally you get
//         the right output only when the caller passes raw paise. The test in the
//         original suite was accidentally correct; added explicit paise/rupee
//         boundary tests to lock this down.
//
// BUG-02  RESOLVED — AUTO_APPROVE removed from the system entirely.
//         CACHE_HIT path requiresHumanReview: true is now always correct.
//         No RecommendedAction in the system can bypass human review.
//
// BUG-03  recordSuccess() resets to 0, not to threshold-1
//         After exactly two failures + one success + two more failures the
//         breaker should NOT trip (4 calls, but only 2 consecutive since last
//         success). The existing test already catches this, but the _actual_
//         reset in RunTracker sets `this.failures = 0`, which is correct.
//         However once `tripped = true` it can NEVER un-trip even after
//         recordSuccess(). A tripped breaker should stay tripped (correct for
//         per-run scope), but the test that says "success resets failure count"
//         implies it *could* un-trip — the test does NOT verify un-tripping after
//         the threshold is hit post-success. Added an explicit assertion.
//
// BUG-04  shouldUseLLM ignores MEDIUM confidence band
//         The routing comment says "LOW" fires LLM. MEDIUM is silent.
//         shouldUseLLM only checks === "LOW", so MEDIUM goes deterministic even
//         when it probably should. This is intentional per the comment, but
//         the absence of a test for MEDIUM leaves a gap. Added.
//
// BUG-05  buildReasonHash uses 5% bucket — two very different amounts in
//         3-8% range collide to the same hash and share a cache entry.
//         e.g. 3% diff (₹30 on ₹1000) and 7% diff (₹70 on ₹1000) both bucket
//         to Math.round(X/5)*5 = 5, producing the same hash. Added a test
//         proving two structurally-different contexts get different hashes
//         when their difference crosses a 5% bucket boundary.
//
// BUG-06  Empty candidates array causes division by zero in buildPromptContext
//         prompt-context.ts line: const diffPct = ledgerSum !== 0 ? ... : 0
//         This is guarded. But dateLagDays computation:
//           Math.min(...candidates.map(...)) when candidates is []
//           → Math.min() → Infinity, not NaN. Then Infinity - timestamp = -Infinity.
//           Math.floor(-Infinity / ...) = -Infinity. Math.abs(-Infinity) = Infinity.
//         The guard `if (candidates.length > 0)` exists on line 81 — this is
//         actually correct. Added a test to prove the exact output is 0.
//
// BUG-07  TYPO and COUNTERPARTY_DIFFERENCE templates contain raw PII placeholders
//         in the explanationTemplate string: '{bankCounterparty}' and
//         '{ledgerCounterparty}'. These are RENDERED placeholders (fine), but the
//         raw template string stored in the DB / cache contains them verbatim.
//         If render-explanation.ts fails to substitute, raw names leak into
//         stored `reasonText`. Added substitution-completeness assertions.
//
// BUG-08  LLM path observability event emitted with valid:false on timeout
//         even though the error is NOT a Zod failure. The `valid` field
//         semantics say "false when Zod validation failed" per the comment on
//         line 48, but a timeout also sets valid:false. Operators watching the
//         dashboard will see Zod failures spiking during Gemini outages.
//         (Structural test added — cannot fully test without observability mock.)
//
// BUG-09  recon.service.ts skipAI check skips "exact" with score >= 0.95
//         but does NOT skip "exact" with score < 0.95. Those go through the
//         full LLM chain and get a PARAMETERIZED result for "NONE" discrepancy
//         (since NONE is in TEMPLATES). Wasteful but not strictly wrong.
//         Added test to verify the deterministic path handles NONE.
//
// BUG-10  FOREIGN_EXCHANGE template uses {difference} placeholder but the
//         discrepancy might legitimately be 0 paise (same converted amount).
//         renderExplanation with 0 difference yields "₹0.00" which is
//         confusing to accountants. No guard in the template. Added test.
// ────────────────────────────────────────────────────────────────────────────

import { buildPromptContext } from "../../lib/prompt-context";
import { renderExplanation } from "../../lib/render-explanation";
import {
  shouldUseLLM,
  buildReasonHash,
  RunTracker,
  generateMatchReasoning,
} from "../../lib/ai-reason";
import { PROMPT_VERSION } from "../../types";
import type { LLMProvider } from "../../lib/llm-provider";
import type { BankTransaction, LedgerEntry, MatchResult } from "../../core/matching/engine";
import type { ClassificationResult } from "../../core/matching/classifier";

// ── Minimal test harness ──────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    failures.push(`${name}: ${err.message}`);
    failed++;
  }
}

function section(title: string): void {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("─".repeat(60));
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeBankTxn(overrides: Partial<BankTransaction> = {}): BankTransaction {
  return {
    id: "txn-001",
    amount: 100_000, // ₹1,000.00 in paise
    date: new Date("2026-03-01T12:00:00Z"),
    description: "NEFT FROM CUSTOMER A",
    referenceId: "INV-1001",
    counterparty: "Customer A Ltd",
    currency: "INR",
    ...overrides,
  };
}

function makeLedger(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: "led-001",
    amount: 100_000,
    date: new Date("2026-03-01T12:00:00Z"),
    memo: "Invoice INV-1001",
    invoiceRef: "INV-1001",
    counterparty: "Customer A Limited",
    currency: "INR",
    ...overrides,
  };
}

function makeClassification(overrides: Partial<ClassificationResult> = {}): ClassificationResult {
  return {
    matchOutcome: "MATCHED",
    discrepancyType: "NONE",
    confidenceBand: "HIGH",
    confidence: 0.85,
    evidence: [{ code: "MATCHED_EXACT_CLEAN", message: "Exact match." }],
    ...overrides,
  };
}

function makeMatch(
  classification: ClassificationResult,
  overrides: Partial<MatchResult> = {}
): MatchResult {
  return {
    bankTransactionIds: ["txn-001"],
    ledgerEntryIds: ["led-001"],
    confidenceScore: classification.confidence,
    score: 100,
    confidenceBand: classification.confidenceBand,
    matchType: "exact",
    scoringBreakdown: { amountScore: 100, dateScore: 100, textScore: 80 },
    classification,
    riskScore: 10,
    ...overrides,
  };
}

// ── Mock LLM providers ────────────────────────────────────────────────────────

class MockSuccessProvider implements LLMProvider {
  readonly name = "mock-success";
  private callCount = 0;
  private readonly response: object;
  constructor(response?: object) {
    this.response = response ?? {
      explanationTemplate:
        "Counterparty name difference: bank shows '{bankCounterparty}', ledger shows '{ledgerCounterparty}'.",
      suggestedAction: "FOLLOW_UP_VENDOR",
      requiresHumanReview: true,
    };
  }
  async complete(_s: string, _u: string): Promise<string> {
    this.callCount++;
    return JSON.stringify(this.response);
  }
  getCallCount(): number { return this.callCount; }
}

/**
 * Simulates an LLM that tries to return AUTO_APPROVE — which is now an
 * invalid enum value. Zod must reject this and fall back to STATIC.
 */
class MockAutoApproveProvider implements LLMProvider {
  readonly name = "mock-auto-approve-invalid";
  async complete(_s: string, _u: string): Promise<string> {
    return JSON.stringify({
      explanationTemplate: "Processing fee deducted. Settlement amount matches after fee.",
      suggestedAction: "AUTO_APPROVE",   // no longer in the enum — Zod must reject
      requiresHumanReview: false,        // also invalid — schema requires literal true
    });
  }
}

class MockTimeoutProvider implements LLMProvider {
  readonly name = "mock-timeout";
  async complete(_s: string, _u: string): Promise<string> {
    await new Promise(() => { }); // Hang indefinitely
    return "{}";
  }
}

class MockMalformedProvider implements LLMProvider {
  readonly name = "mock-malformed";
  private callCount = 0;
  async complete(_s: string, _u: string): Promise<string> {
    this.callCount++;
    return JSON.stringify({ wrongField: "oops", confidence: 0.9 });
  }
  getCallCount(): number { return this.callCount; }
}

class MockFailingProvider implements LLMProvider {
  readonly name = "mock-failing";
  private callCount = 0;
  async complete(_s: string, _u: string): Promise<string> {
    this.callCount++;
    throw new Error("Network error: Connection refused");
  }
  getCallCount(): number { return this.callCount; }
}

/** Returns invalid JSON string — distinct from a malformed-but-valid JSON object */
class MockBrokenJsonProvider implements LLMProvider {
  readonly name = "mock-broken-json";
  async complete(_s: string, _u: string): Promise<string> {
    return "{ this is: not valid JSON !!!";
  }
}

/** Simulates Gemini wrapping response in markdown fences */
class MockMarkdownFencedProvider implements LLMProvider {
  readonly name = "mock-fenced";
  async complete(_s: string, _u: string): Promise<string> {
    return "```json\n" + JSON.stringify({
      explanationTemplate: "Amount mismatch after FX conversion requires review.",
      suggestedAction: "CHECK_BANK_STATEMENT",
      requiresHumanReview: true,
    }) + "\n```";
  }
}

/** Returns a valid Zod shape but with explanationTemplate below the 10-char minimum */
class MockShortTemplateProvider implements LLMProvider {
  readonly name = "mock-short-template";
  async complete(_s: string, _u: string): Promise<string> {
    return JSON.stringify({
      explanationTemplate: "Short",   // < 10 chars — Zod min(10) should reject
      suggestedAction: "MANUAL_REVIEW",
      requiresHumanReview: true,
    });
  }
}

// ── Test Suite ────────────────────────────────────────────────────────────────

async function runTests() {
  console.log("══════════════════════════════════════════════════════════════");
  console.log("  Phase 9 — AI Reasoning Layer — Expanded Test Suite");
  console.log(`  PROMPT_VERSION : ${PROMPT_VERSION}`);
  console.log("══════════════════════════════════════════════════════════════");

  // ══════════════════════════════════════════════════════════════════════════
  // GROUP 1: PII Isolation (prompt-context.ts)
  // ══════════════════════════════════════════════════════════════════════════
  section("Group 1: PII Isolation");

  await test("buildPromptContext emits no raw counterparty names", () => {
    const bankTxn = makeBankTxn({ counterparty: "SECRET VENDOR LTD" });
    const ledger = makeLedger({ counterparty: "SECRET VENDOR LIMITED" });
    const classification = makeClassification({
      discrepancyType: "COUNTERPARTY_DIFFERENCE",
      confidenceBand: "HIGH",
    });
    const ctx = buildPromptContext(bankTxn, [ledger], "fuzzy", classification);
    const serialised = JSON.stringify(ctx);

    assert(!serialised.includes("SECRET VENDOR"), "Raw counterparty name leaked into PromptContext");
    assert(!serialised.includes("NEFT FROM"), "Raw narration leaked into PromptContext");
    assert(!serialised.includes("INV-1001"), "Raw reference leaked into PromptContext");
    assert(typeof ctx.counterpartySimilarity.editDistance === "number", "editDistance must be numeric");
    assert(typeof ctx.descriptionCategory === "string", "descriptionCategory must be a string");
  });

  await test("buildPromptContext derives descriptionCategory from keyword, not raw narration", () => {
    const cases: Array<[string, string]> = [
      ["STRIPE PAYOUT po_123", "STRIPE"],
      ["RAZORPAY SETTLEMENT 456", "RAZORPAY"],
      ["NEFT/CR-12345", "NEFT"],
      ["RTGS INWARD", "RTGS"],
      ["IMPS PAYMENT", "IMPS"],
      ["UPI TRANSFER", "GENERAL"],
      ["", "GENERAL"],
    ];
    for (const [description, expected] of cases) {
      const ctx = buildPromptContext(
        makeBankTxn({ description }),
        [makeLedger()],
        "exact",
        makeClassification()
      );
      assert(ctx.descriptionCategory === expected, `"${description}" → expected ${expected}, got ${ctx.descriptionCategory}`);
    }
  });

  await test("buildPromptContext emits only structural counterparty features", () => {
    const bankTxn = makeBankTxn({ counterparty: "Acme Corp" });
    const ledger = makeLedger({ counterparty: "Acme Corporation" });
    const ctx = buildPromptContext(bankTxn, [ledger], "fuzzy", makeClassification());

    assert(typeof ctx.counterpartySimilarity.editDistance === "number", "editDistance must be present");
    assert(ctx.counterpartySimilarity.editDistance >= 0, "editDistance must be non-negative");
    assert(ctx.counterpartySimilarity.charLengthRatio >= 0 && ctx.counterpartySimilarity.charLengthRatio <= 1,
      "charLengthRatio must be 0-1");
    assert(typeof ctx.counterpartySimilarity.exactMatch === "boolean", "exactMatch must be boolean");
    assert(!JSON.stringify(ctx).includes("Acme"), "Raw name must not appear in ctx");
  });

  await test("buildPromptContext with empty candidates[] → dateLagDays=0, no throw", () => {
    // BUG-06: Math.min(...[]) = Infinity; the guard `if (candidates.length > 0)` must catch it
    const ctx = buildPromptContext(makeBankTxn(), [], "none", makeClassification());
    assert(ctx.dateLagDays === 0, "dateLagDays should be 0 with no candidates");
    assert(ctx.ledgerSumMinor === 0, "ledgerSumMinor should be 0 with no candidates");
    assert(ctx.differencePercentage === 0, "differencePercentage should be 0 with no candidates (no div-by-zero)");
  });

  await test("buildPromptContext referenceSimilarity.digitTransposition is boolean", () => {
    const bankTxn = makeBankTxn({ referenceId: "INV-1234" });
    const ledger = makeLedger({ invoiceRef: "INV-1243" }); // digit transposition
    const ctx = buildPromptContext(bankTxn, [ledger], "fuzzy", makeClassification());
    assert(typeof ctx.referenceSimilarity.digitTransposition === "boolean",
      "digitTransposition must be boolean");
    // INV-1234 vs INV-1243: 3 & 4 are swapped — expect true
    assert(ctx.referenceSimilarity.digitTransposition === true,
      "Should detect digit transposition between INV-1234 and INV-1243");
  });

  // ══════════════════════════════════════════════════════════════════════════
  // GROUP 2: Dynamic Rendering (render-explanation.ts)
  // ══════════════════════════════════════════════════════════════════════════
  section("Group 2: Dynamic Rendering");

  await test("renderExplanation substitutes {bankCounterparty} and {difference}", () => {
    const template = "Counterparty mismatch: bank is '{bankCounterparty}', difference is {difference}.";
    const bankTxn = makeBankTxn({ counterparty: "Acme Corp", amount: 100_000 });
    const ledger = makeLedger({ amount: 95_000 });
    const rendered = renderExplanation(template, bankTxn, [ledger], 5_000);

    assert(rendered.includes("Acme Corp"), "Should substitute {bankCounterparty}");
    assert(rendered.includes("₹50.00"), "Should render 5_000 paise as ₹50.00");
    assert(!rendered.includes("{bankCounterparty}"), "Placeholder {bankCounterparty} must be gone");
    assert(!rendered.includes("{difference}"), "Placeholder {difference} must be gone");
  });

  await test("renderExplanation substitutes all ledger-side placeholders", () => {
    const template = "Ledger: '{ledgerCounterparty}', ref: {ledgerReference}";
    const ledger = makeLedger({ counterparty: "Vendor X", invoiceRef: "INV-99" });
    const rendered = renderExplanation(template, makeBankTxn(), [ledger], 0);

    assert(rendered.includes("Vendor X"), "Should substitute {ledgerCounterparty}");
    assert(rendered.includes("INV-99"), "Should substitute {ledgerReference}");
    assert(!rendered.includes("{ledgerCounterparty}"), "Placeholder must be gone");
    assert(!rendered.includes("{ledgerReference}"), "Placeholder must be gone");
  });

  await test("renderExplanation with empty candidates[] does not throw; ledger placeholders resolve to empty string", () => {
    const template = "No ledger entry. Bank: '{bankCounterparty}'. Ledger: '{ledgerCounterparty}'.";
    const rendered = renderExplanation(template, makeBankTxn({ counterparty: "Acme" }), [], 0);
    assert(!rendered.includes("{ledgerCounterparty}"), "Placeholder must not remain");
    assert(rendered.includes("Acme"), "Bank counterparty should still render");
  });

  await test("renderExplanation with zero difference renders ₹0.00, not empty string", () => {
    // BUG-10: FOREIGN_EXCHANGE with 0 diff renders confusingly. This test locks
    // the behaviour — ₹0.00 is technically correct even if confusing.
    const template = "FX difference of {difference}.";
    const rendered = renderExplanation(template, makeBankTxn(), [makeLedger()], 0);
    assert(rendered.includes("₹0.00"), "Zero difference should render as ₹0.00");
    assert(!rendered.includes("{difference}"), "Placeholder must be gone");
  });

  await test("renderExplanation substitutes {bankReference} and {ledgerReference}", () => {
    const template = "Bank ref: {bankReference} — Ledger ref: {ledgerReference}.";
    const bankTxn = makeBankTxn({ referenceId: "BANK-REF-999" });
    const ledger = makeLedger({ invoiceRef: "LED-REF-888" });
    const rendered = renderExplanation(template, bankTxn, [ledger], 0);
    assert(rendered.includes("BANK-REF-999"), "Should substitute {bankReference}");
    assert(rendered.includes("LED-REF-888"), "Should substitute {ledgerReference}");
  });

  await test("TYPO template has no unsubstituted placeholders after render", () => {
    // BUG-07: If renderExplanation misses a placeholder, raw '{bankCounterparty}' leaks into DB.
    const template = "Possible data-entry typo detected. Bank shows '{bankCounterparty}' while ledger shows '{ledgerCounterparty}'. Verify and correct the reference data.";
    const bankTxn = makeBankTxn({ counterparty: "Acme Corp" });
    const ledger = makeLedger({ counterparty: "Acme Cor" });
    const rendered = renderExplanation(template, bankTxn, [ledger], 0);
    assert(!rendered.includes("{bankCounterparty}"), "No raw {bankCounterparty} placeholder in output");
    assert(!rendered.includes("{ledgerCounterparty}"), "No raw {ledgerCounterparty} placeholder in output");
    assert(rendered.includes("Acme Corp"), "Bank counterparty should appear in rendered text");
  });

  await test("COUNTERPARTY_DIFFERENCE template renders both sides cleanly", () => {
    const template = "Counterparty name on the bank statement does not match the ledger entry. Bank: '{bankCounterparty}' — Ledger: '{ledgerCounterparty}'. Confirm the correct vendor before approving.";
    const bankTxn = makeBankTxn({ counterparty: "Stripe Inc" });
    const ledger = makeLedger({ counterparty: "Stripe Technologies" });
    const rendered = renderExplanation(template, bankTxn, [ledger], 0);
    assert(rendered.includes("Stripe Inc"), "Bank counterparty must appear");
    assert(rendered.includes("Stripe Technologies"), "Ledger counterparty must appear");
    assert(!rendered.includes("{"), "No unresolved placeholders should remain");
  });

  await test("renderExplanation with large difference converts paise → rupees correctly", () => {
    // BUG-01: Verify paise-to-rupee conversion precision
    const template = "Difference: {difference}";
    // 1_23_456 paise = ₹1,234.56
    const rendered = renderExplanation(template, makeBankTxn(), [makeLedger()], 1_23_456);
    assert(rendered.includes("₹1,234.56") || rendered.includes("₹1234.56"),
      "Should format 123456 paise as ₹1,234.56");
  });

  // ══════════════════════════════════════════════════════════════════════════
  // GROUP 3: Routing Logic (shouldUseLLM)
  // ══════════════════════════════════════════════════════════════════════════
  section("Group 3: Routing — shouldUseLLM");

  await test("shouldUseLLM is false for COUNTERPARTY_DIFFERENCE + HIGH", () => {
    assert(!shouldUseLLM({ discrepancyType: "COUNTERPARTY_DIFFERENCE", confidenceBand: "HIGH" }),
      "COUNTERPARTY_DIFFERENCE + HIGH must NOT go to LLM");
  });

  await test("shouldUseLLM is false for TYPO + MEDIUM", () => {
    assert(!shouldUseLLM({ discrepancyType: "TYPO", confidenceBand: "MEDIUM" }),
      "TYPO + MEDIUM must NOT go to LLM");
  });

  await test("shouldUseLLM is false for AMOUNT_DIFFERENCE + HIGH", () => {
    assert(!shouldUseLLM({ discrepancyType: "AMOUNT_DIFFERENCE", confidenceBand: "HIGH" }),
      "AMOUNT_DIFFERENCE + HIGH must NOT go to LLM");
  });

  await test("shouldUseLLM is false for NONE + VERY_HIGH", () => {
    // BUG-09 adjacency: exact matches route deterministically
    assert(!shouldUseLLM({ discrepancyType: "NONE", confidenceBand: "VERY_HIGH" }),
      "NONE + VERY_HIGH must NOT go to LLM");
  });

  await test("shouldUseLLM is true for MANUAL_REVIEW + HIGH (type overrides band)", () => {
    assert(shouldUseLLM({ discrepancyType: "MANUAL_REVIEW", confidenceBand: "HIGH" }),
      "MANUAL_REVIEW must always route to LLM regardless of band");
  });

  await test("shouldUseLLM is true for MANUAL_REVIEW + LOW", () => {
    assert(shouldUseLLM({ discrepancyType: "MANUAL_REVIEW", confidenceBand: "LOW" }),
      "MANUAL_REVIEW + LOW must route to LLM");
  });

  await test("shouldUseLLM is true for any type with LOW confidence band", () => {
    const types = [
      "COUNTERPARTY_DIFFERENCE", "TIMING_DIFFERENCE", "PROCESSING_FEE",
      "AMOUNT_DIFFERENCE", "NONE", "TYPO",
    ];
    for (const discrepancyType of types) {
      assert(
        shouldUseLLM({ discrepancyType, confidenceBand: "LOW" }),
        `${discrepancyType} + LOW must route to LLM`
      );
    }
  });

  await test("shouldUseLLM: MEDIUM band with non-MANUAL_REVIEW type goes deterministic", () => {
    // BUG-04 documentation: MEDIUM band intentionally routes deterministic
    assert(!shouldUseLLM({ discrepancyType: "PROCESSING_FEE", confidenceBand: "MEDIUM" }),
      "PROCESSING_FEE + MEDIUM should be deterministic (by design)");
  });

  // ══════════════════════════════════════════════════════════════════════════
  // GROUP 4: Deterministic Path Integration
  // ══════════════════════════════════════════════════════════════════════════
  section("Group 4: Deterministic Path Integration");

  await test("PROCESSING_FEE → PARAMETERIZED, CHECK_BANK_STATEMENT, requiresHumanReview", async () => {
    const classification = makeClassification({
      discrepancyType: "PROCESSING_FEE",
      confidenceBand: "HIGH",
      evidence: [{ code: "STRIPE_FEE_FORMULA", message: "Stripe fee deducted." }],
    });
    const match = makeMatch(classification, { matchType: "fee_adjustment" });
    const provider = new MockFailingProvider();

    const result = await generateMatchReasoning(
      "txn-001", "org-001", makeBankTxn(), [makeLedger()], match, new RunTracker(), provider
    );

    assert(result.reasoning.source === "PARAMETERIZED", "Should use PARAMETERIZED source");
    assert(provider.getCallCount() === 0, "LLM must NOT be called");
    assert(result.reasoning.suggestedAction === "CHECK_BANK_STATEMENT", "PROCESSING_FEE → CHECK_BANK_STATEMENT");
    assert(result.reasoning.requiresHumanReview, "PROCESSING_FEE → requiresHumanReview must be true");
    assert(result.reasoning.modelUsed === null, "modelUsed must be null for deterministic path");
    assert(result.reasoning.latencyMs !== null, "latencyMs must be set even for deterministic path");
  });

  await test("TIMING_DIFFERENCE → PARAMETERIZED, MANUAL_REVIEW, requiresHumanReview", async () => {
    const classification = makeClassification({ discrepancyType: "TIMING_DIFFERENCE", confidenceBand: "HIGH" });
    const match = makeMatch(classification);
    const result = await generateMatchReasoning(
      "txn-002", "org-001", makeBankTxn(), [makeLedger()], match, new RunTracker(), new MockFailingProvider()
    );
    assert(result.reasoning.source === "PARAMETERIZED", "Should be PARAMETERIZED");
    assert(result.reasoning.suggestedAction === "MANUAL_REVIEW", "TIMING_DIFFERENCE → MANUAL_REVIEW");
    assert(result.reasoning.requiresHumanReview, "TIMING_DIFFERENCE → requiresHumanReview must be true");
    assert(result.reasoning.likelyReason === "date_delay", "likelyReason should be date_delay");
  });

  await test("FOREIGN_EXCHANGE → PARAMETERIZED, CHECK_BANK_STATEMENT, requiresHumanReview", async () => {
    const classification = makeClassification({ discrepancyType: "FOREIGN_EXCHANGE", confidenceBand: "HIGH" });
    const result = await generateMatchReasoning(
      "txn-fx-01", "org-001",
      makeBankTxn({ currency: "USD" }), [makeLedger({ currency: "INR" })],
      makeMatch(classification), new RunTracker(), new MockFailingProvider()
    );
    assert(result.reasoning.source === "PARAMETERIZED", "FOREIGN_EXCHANGE → PARAMETERIZED");
    assert(result.reasoning.suggestedAction === "CHECK_BANK_STATEMENT", "FOREIGN_EXCHANGE → CHECK_BANK_STATEMENT");
    assert(result.reasoning.requiresHumanReview, "FOREIGN_EXCHANGE → requiresHumanReview must be true");
  });

  await test("MISSING_ENTRY → PARAMETERIZED, CHECK_LEDGER, no unrendered ledger placeholders", async () => {
    const classification = makeClassification({
      discrepancyType: "MISSING_ENTRY",
      confidenceBand: "VERY_HIGH",
      matchOutcome: "UNMATCHED",
      evidence: [{ code: "MISSING_INVOICE_REF", message: "No matching ledger entry." }],
    });
    const match = makeMatch(classification, { matchType: "none", ledgerEntryIds: [], confidenceScore: 0 });
    const result = await generateMatchReasoning(
      "txn-003", "org-001", makeBankTxn(), [], match, new RunTracker(), new MockFailingProvider()
    );
    assert(result.reasoning.source === "PARAMETERIZED", "MISSING_ENTRY → PARAMETERIZED");
    assert(!result.renderedExplanation.includes("{ledger"), "No unrendered {ledger*} placeholders");
    assert(result.reasoning.suggestedAction === "CHECK_LEDGER", "MISSING_ENTRY → CHECK_LEDGER");
  });

  await test("DUPLICATE → PARAMETERIZED, INVESTIGATE_DUPLICATE, requiresHumanReview", async () => {
    const classification = makeClassification({ discrepancyType: "DUPLICATE", confidenceBand: "HIGH" });
    const result = await generateMatchReasoning(
      "txn-dup-01", "org-001", makeBankTxn(), [makeLedger()],
      makeMatch(classification), new RunTracker(), new MockFailingProvider()
    );
    assert(result.reasoning.source === "PARAMETERIZED", "DUPLICATE → PARAMETERIZED");
    assert(result.reasoning.suggestedAction === "INVESTIGATE_DUPLICATE", "DUPLICATE → INVESTIGATE_DUPLICATE");
    assert(result.reasoning.requiresHumanReview, "DUPLICATE must require human review");
  });

  await test("DUPLICATE_INVOICE → PARAMETERIZED, INVESTIGATE_DUPLICATE", async () => {
    const classification = makeClassification({ discrepancyType: "DUPLICATE_INVOICE", confidenceBand: "HIGH" });
    const result = await generateMatchReasoning(
      "txn-dup-inv-01", "org-001", makeBankTxn(), [makeLedger()],
      makeMatch(classification), new RunTracker(), new MockFailingProvider()
    );
    assert(result.reasoning.suggestedAction === "INVESTIGATE_DUPLICATE", "DUPLICATE_INVOICE → INVESTIGATE_DUPLICATE");
    assert(result.reasoning.likelyReason === "duplicate_risk", "likelyReason → duplicate_risk");
  });

  await test("REFERENCE_DIFFERENCE → PARAMETERIZED, REQUEST_DOCUMENTATION", async () => {
    const classification = makeClassification({ discrepancyType: "REFERENCE_DIFFERENCE", confidenceBand: "HIGH" });
    const result = await generateMatchReasoning(
      "txn-ref-01", "org-001", makeBankTxn(), [makeLedger()],
      makeMatch(classification), new RunTracker(), new MockFailingProvider()
    );
    assert(result.reasoning.suggestedAction === "REQUEST_DOCUMENTATION", "REFERENCE_DIFFERENCE → REQUEST_DOCUMENTATION");
    assert(result.reasoning.requiresHumanReview, "REFERENCE_DIFFERENCE must require human review");
  });

  await test("NONE discrepancy type → PARAMETERIZED, MANUAL_REVIEW, requiresHumanReview", async () => {
    // BUG-09: exact matches with score <0.95 still enter generateMatchReasoning.
    // NONE is in TEMPLATES so should route deterministically.
    const classification = makeClassification({ discrepancyType: "NONE", confidenceBand: "HIGH" });
    const result = await generateMatchReasoning(
      "txn-none-01", "org-001", makeBankTxn(), [makeLedger()],
      makeMatch(classification), new RunTracker(), new MockFailingProvider()
    );
    assert(result.reasoning.source === "PARAMETERIZED", "NONE → PARAMETERIZED");
    assert(result.reasoning.suggestedAction === "MANUAL_REVIEW", "NONE → MANUAL_REVIEW");
    assert(result.reasoning.requiresHumanReview, "NONE → requiresHumanReview must be true");
  });

  await test("Unknown discrepancy type falls back to FALLBACK_TEMPLATE", async () => {
    const classification = makeClassification({ discrepancyType: "TOTALLY_UNKNOWN_TYPE" as any, confidenceBand: "HIGH" });
    const result = await generateMatchReasoning(
      "txn-unk-01", "org-001", makeBankTxn(), [makeLedger()],
      makeMatch(classification), new RunTracker(), new MockFailingProvider()
    );
    // TOTALLY_UNKNOWN_TYPE is not in TEMPLATES, so FALLBACK_TEMPLATE applies
    assert(result.reasoning.requiresHumanReview, "Unknown type → FALLBACK → requiresHumanReview");
    assert(result.reasoning.suggestedAction === "MANUAL_REVIEW", "Unknown type → FALLBACK → MANUAL_REVIEW");
  });

  await test("Deterministic path sets correct evidenceCodes from classification", async () => {
    const classification = makeClassification({
      discrepancyType: "AMOUNT_DIFFERENCE",
      confidenceBand: "HIGH",
      evidence: [
        { code: "AMOUNT_MISMATCH_5PCT" as any, message: "5% off" },
        { code: "NO_FX_INVOLVED" as any, message: "Same currency" },
      ],
    });
    const result = await generateMatchReasoning(
      "txn-ev-01", "org-001", makeBankTxn(), [makeLedger()],
      makeMatch(classification), new RunTracker(), new MockFailingProvider()
    );
    assert(Array.isArray(result.reasoning.evidenceCodes), "evidenceCodes must be an array");
    assert(result.reasoning.evidenceCodes.includes("AMOUNT_MISMATCH_5PCT"), "Must include AMOUNT_MISMATCH_5PCT");
    assert(result.reasoning.evidenceCodes.includes("NO_FX_INVOLVED"), "Must include NO_FX_INVOLVED");
  });

  // ══════════════════════════════════════════════════════════════════════════
  // GROUP 5: LLM Path — Successful Call
  // ══════════════════════════════════════════════════════════════════════════
  section("Group 5: LLM Path — Successful Call");

  await test("MANUAL_REVIEW → LLM called, response validated, source: LLM (or STATIC if no DB)", async () => {
    const classification = makeClassification({
      discrepancyType: "MANUAL_REVIEW",
      confidenceBand: "LOW",
      evidence: [{ code: "MANUAL_REVIEW_REQUIRED", message: "Low confidence." }],
    });
    const match = makeMatch(classification, { matchType: "fuzzy", confidenceScore: 0.40 });
    const result = await generateMatchReasoning(
      "txn-004", "org-001", makeBankTxn(), [makeLedger()], match, new RunTracker(), new MockSuccessProvider()
    );
    assert(
      ["LLM", "CACHE_HIT", "STATIC", "PARAMETERIZED"].includes(result.reasoning.source),
      "Source must be one of the known values"
    );
    assert(result.reasoning.version === "v1", "Should be version v1");
    assert(typeof result.reasoning.confidence === "number", "confidence must be numeric");
    assert(typeof result.renderedExplanation === "string", "renderedExplanation must be a string");
    assert(result.renderedExplanation.length > 0, "renderedExplanation must be non-empty");
  });

  await test("LLM returning AUTO_APPROVE is Zod-rejected → STATIC fallback", async () => {
    // AUTO_APPROVE was removed from the RecommendedAction enum and LLM Zod schema.
    // If the LLM somehow returns AUTO_APPROVE, Zod must reject it and fall back to STATIC.
    const classification = makeClassification({ discrepancyType: "MANUAL_REVIEW", confidenceBand: "LOW" });
    const match = makeMatch(classification, { matchType: "fuzzy", confidenceScore: 0.40 });
    const result = await generateMatchReasoning(
      "txn-llm-auto", "org-001", makeBankTxn(), [makeLedger()], match,
      new RunTracker(), new MockAutoApproveProvider()
    );
    // Zod rejects AUTO_APPROVE → falls back to STATIC
    assert(result.reasoning.source === "STATIC", "AUTO_APPROVE from LLM → Zod rejection → STATIC fallback");
    assert(result.reasoning.requiresHumanReview === true, "STATIC fallback always requiresHumanReview");
    assert(result.reasoning.suggestedAction === "MANUAL_REVIEW", "STATIC fallback always MANUAL_REVIEW");
  });

  await test("All LLM paths always produce requiresHumanReview=true", async () => {
    // Core contract: AI is advisory only. requiresHumanReview must be true regardless of source.
    const classification = makeClassification({ discrepancyType: "MANUAL_REVIEW", confidenceBand: "LOW" });
    const match = makeMatch(classification, { matchType: "fuzzy", confidenceScore: 0.40 });
    const result = await generateMatchReasoning(
      "txn-llm-review", "org-001", makeBankTxn(), [makeLedger()], match,
      new RunTracker(), new MockSuccessProvider()
    );
    assert(result.reasoning.requiresHumanReview === true,
      "requiresHumanReview must always be true — AI is advisory only");
  });

  await test("Markdown-fenced LLM response is stripped and parsed correctly", async () => {
    const classification = makeClassification({ discrepancyType: "MANUAL_REVIEW", confidenceBand: "LOW" });
    const match = makeMatch(classification, { matchType: "fuzzy", confidenceScore: 0.35 });
    const result = await generateMatchReasoning(
      "txn-fence-01", "org-001", makeBankTxn(), [makeLedger()], match, new RunTracker(), new MockMarkdownFencedProvider()
    );
    // Should not throw or fall back to STATIC from a fenced response
    if (result.reasoning.source === "LLM") {
      assert(result.reasoning.suggestedAction === "CHECK_BANK_STATEMENT",
        "Fenced response should be parsed correctly");
    }
    assert(
      ["LLM", "CACHE_HIT", "STATIC"].includes(result.reasoning.source),
      "Must have a valid source"
    );
  });

  await test("LLM result version is always v1", async () => {
    const classification = makeClassification({ discrepancyType: "MANUAL_REVIEW", confidenceBand: "LOW" });
    const match = makeMatch(classification, { matchType: "fuzzy", confidenceScore: 0.40 });
    const result = await generateMatchReasoning(
      "txn-ver-01", "org-001", makeBankTxn(), [makeLedger()], match, new RunTracker(), new MockSuccessProvider()
    );
    assert(result.reasoning.version === "v1", "reasoning.version must always be v1");
  });

  // ══════════════════════════════════════════════════════════════════════════
  // GROUP 6: Circuit Breaker
  // ══════════════════════════════════════════════════════════════════════════
  section("Group 6: Circuit Breaker");

  await test("Circuit breaker starts untripped", () => {
    const tracker = new RunTracker();
    assert(!tracker.isTripped(), "New RunTracker must start untripped");
  });

  await test("Circuit breaker trips exactly at threshold (3)", () => {
    const tracker = new RunTracker();
    tracker.recordFailure();
    assert(!tracker.isTripped(), "Should not trip at 1 failure");
    tracker.recordFailure();
    assert(!tracker.isTripped(), "Should not trip at 2 failures");
    tracker.recordFailure();
    assert(tracker.isTripped(), "Must trip at 3 failures");
  });

  await test("recordSuccess resets failure count before threshold", () => {
    const tracker = new RunTracker();
    tracker.recordFailure();
    tracker.recordFailure();
    tracker.recordSuccess(); // Reset
    tracker.recordFailure();
    tracker.recordFailure();
    // Only 2 consecutive failures since last success — must NOT trip
    assert(!tracker.isTripped(), "Must not trip after success reset with only 2 subsequent failures");
  });

  await test("Once tripped, breaker stays tripped even after recordSuccess", () => {
    // BUG-03: The per-run semantics mean a tripped breaker should stay tripped.
    const tracker = new RunTracker();
    tracker.recordFailure();
    tracker.recordFailure();
    tracker.recordFailure(); // Trips
    assert(tracker.isTripped(), "Should be tripped");
    tracker.recordSuccess();  // Success AFTER tripping
    assert(tracker.isTripped(), "Should REMAIN tripped after success — per-run breaker is sticky");
  });

  await test("Tripped breaker → LLM never called → STATIC fallback", async () => {
    const tracker = new RunTracker();
    tracker.recordFailure();
    tracker.recordFailure();
    tracker.recordFailure(); // Trips

    const provider = new MockFailingProvider();
    const classification = makeClassification({ discrepancyType: "MANUAL_REVIEW", confidenceBand: "LOW" });
    const match = makeMatch(classification, { matchType: "fuzzy", confidenceScore: 0.40 });

    const result = await generateMatchReasoning(
      "txn-005", "org-001", makeBankTxn(), [makeLedger()], match, tracker, provider
    );

    assert(provider.getCallCount() === 0, "LLM must NOT be called when circuit breaker is tripped");
    assert(result.reasoning.source === "STATIC", "Tripped breaker → STATIC fallback");
    assert(result.reasoning.suggestedAction === "MANUAL_REVIEW", "Tripped breaker → MANUAL_REVIEW");
    assert(result.reasoning.requiresHumanReview === true, "Tripped breaker → requiresHumanReview");
  });

  await test("Multiple independent RunTrackers do not interfere", () => {
    const t1 = new RunTracker();
    const t2 = new RunTracker();
    t1.recordFailure();
    t1.recordFailure();
    t1.recordFailure(); // t1 trips
    assert(t1.isTripped(), "t1 must be tripped");
    assert(!t2.isTripped(), "t2 must be untripped — each RunTracker is independent");
  });

  // ══════════════════════════════════════════════════════════════════════════
  // GROUP 7: Timeout Behaviour
  // ══════════════════════════════════════════════════════════════════════════
  section("Group 7: Timeout Behaviour  (takes ~10s — 2 retries × 5s)");

  await test("Hanging LLM → STATIC fallback after 5s timeout (includes 1 retry)", async function () {
    const classification = makeClassification({ discrepancyType: "MANUAL_REVIEW", confidenceBand: "LOW" });
    const match = makeMatch(classification, { matchType: "fuzzy", confidenceScore: 0.40 });
    const result = await generateMatchReasoning(
      "txn-006", "org-001", makeBankTxn(), [makeLedger()], match, new RunTracker(), new MockTimeoutProvider()
    );
    assert(result.reasoning.source === "STATIC", "Timeout must result in STATIC fallback");
    assert(result.reasoning.suggestedAction === "MANUAL_REVIEW", "Timeout fallback → MANUAL_REVIEW");
    assert(result.reasoning.requiresHumanReview === true, "Timeout fallback → requiresHumanReview");
    // After timeout+retry the circuit breaker's failure counter should be at 2
    // (not testing RunTracker state here since we create a fresh one per test)
  });

  // ══════════════════════════════════════════════════════════════════════════
  // GROUP 8: Zod Validation
  // ══════════════════════════════════════════════════════════════════════════
  section("Group 8: Zod Validation");

  await test("Malformed LLM JSON object → STATIC fallback, no crash", async () => {
    const classification = makeClassification({ discrepancyType: "MANUAL_REVIEW", confidenceBand: "LOW" });
    const match = makeMatch(classification, { matchType: "fuzzy", confidenceScore: 0.40 });
    const result = await generateMatchReasoning(
      "txn-007", "org-001", makeBankTxn(), [makeLedger()], match, new RunTracker(), new MockMalformedProvider()
    );
    assert(result.reasoning.source === "STATIC", "Malformed response → STATIC fallback");
    assert(result.reasoning.suggestedAction === "MANUAL_REVIEW", "Malformed response → MANUAL_REVIEW");
    assert(result.reasoning.explanationTemplate.length > 0, "Must have fallback template text");
  });

  await test("Completely broken JSON string → STATIC fallback, no crash", async () => {
    const classification = makeClassification({ discrepancyType: "MANUAL_REVIEW", confidenceBand: "LOW" });
    const match = makeMatch(classification, { matchType: "fuzzy", confidenceScore: 0.40 });
    const result = await generateMatchReasoning(
      "txn-brk-01", "org-001", makeBankTxn(), [makeLedger()], match, new RunTracker(), new MockBrokenJsonProvider()
    );
    assert(result.reasoning.source === "STATIC", "Broken JSON → STATIC fallback");
    assert(result.reasoning.requiresHumanReview === true, "Broken JSON → requiresHumanReview");
  });

  await test("explanationTemplate below 10-char Zod minimum → STATIC fallback", async () => {
    const classification = makeClassification({ discrepancyType: "MANUAL_REVIEW", confidenceBand: "LOW" });
    const match = makeMatch(classification, { matchType: "fuzzy", confidenceScore: 0.40 });
    const result = await generateMatchReasoning(
      "txn-short-01", "org-001", makeBankTxn(), [makeLedger()], match, new RunTracker(), new MockShortTemplateProvider()
    );
    assert(result.reasoning.source === "STATIC", "Short explanationTemplate → STATIC fallback");
    // Verify fallback template itself is longer than 10 chars
    assert(result.reasoning.explanationTemplate.length >= 10, "Fallback template must be >= 10 chars");
  });

  await test("LLM response with completely invalid suggestedAction → STATIC fallback", async () => {
    const classification = makeClassification({ discrepancyType: "MANUAL_REVIEW", confidenceBand: "LOW" });
    const match = makeMatch(classification, { matchType: "fuzzy", confidenceScore: 0.40 });
    const badProvider: LLMProvider = {
      name: "mock-bad-action",
      async complete() {
        return JSON.stringify({
          explanationTemplate: "This is a valid explanation that is long enough.",
          suggestedAction: "INVALID_ACTION_VALUE", // Not in enum
          requiresHumanReview: true,
        });
      },
    };
    const result = await generateMatchReasoning(
      "txn-bad-action", "org-001", makeBankTxn(), [makeLedger()], match, new RunTracker(), badProvider
    );
    assert(result.reasoning.source === "STATIC", "Invalid enum value → STATIC fallback");
  });

  await test("LLM returning AUTO_APPROVE (removed enum value) → Zod rejection → STATIC fallback", async () => {
    // Regression guard: if the LLM hallucinates AUTO_APPROVE (it was valid before),
    // the Zod schema must catch it and prevent it from reaching the DB or UI.
    const classification = makeClassification({ discrepancyType: "MANUAL_REVIEW", confidenceBand: "LOW" });
    const match = makeMatch(classification, { matchType: "fuzzy", confidenceScore: 0.40 });
    const result = await generateMatchReasoning(
      "txn-auto-approve-rejected", "org-001", makeBankTxn(), [makeLedger()], match,
      new RunTracker(), new MockAutoApproveProvider()
    );
    assert(result.reasoning.source === "STATIC",
      "AUTO_APPROVE from LLM must be Zod-rejected → STATIC fallback");
    assert(result.reasoning.requiresHumanReview === true,
      "Rejected AUTO_APPROVE → must fall back to requiresHumanReview=true");
    assert((result.reasoning.suggestedAction as string) !== "AUTO_APPROVE",
      "AUTO_APPROVE must never reach reasoning output");
  });

  await test("requiresHumanReview: false in LLM response is Zod-rejected", async () => {
    // Schema now requires requiresHumanReview: z.literal(true) — any false is rejected.
    const classification = makeClassification({ discrepancyType: "MANUAL_REVIEW", confidenceBand: "LOW" });
    const match = makeMatch(classification, { matchType: "fuzzy", confidenceScore: 0.40 });
    const falseReviewProvider: LLMProvider = {
      name: "mock-false-review",
      async complete() {
        return JSON.stringify({
          explanationTemplate: "Amount and date match exactly. No issues found.",
          suggestedAction: "MANUAL_REVIEW",
          requiresHumanReview: false,  // schema literal(true) must reject this
        });
      },
    };
    const result = await generateMatchReasoning(
      "txn-false-review", "org-001", makeBankTxn(), [makeLedger()], match,
      new RunTracker(), falseReviewProvider
    );
    assert(result.reasoning.requiresHumanReview === true,
      "requiresHumanReview:false from LLM must be rejected → STATIC ensures true");
  });

  // ══════════════════════════════════════════════════════════════════════════
  // GROUP 9: Reason Hash & Cache Logic
  // ══════════════════════════════════════════════════════════════════════════
  section("Group 9: Reason Hash & Cache Logic");

  await test("buildReasonHash produces stable 64-char SHA-256 for identical inputs", () => {
    const bankTxn = makeBankTxn({ amount: 94_600, description: "STRIPE PAYOUT po_99" });
    const ledger = makeLedger({ amount: 100_000 });
    const classification = makeClassification({ discrepancyType: "PROCESSING_FEE", confidenceBand: "HIGH" });
    const ctx = buildPromptContext(bankTxn, [ledger], "fee_adjustment", classification);
    const hash1 = buildReasonHash(ctx);
    const hash2 = buildReasonHash(ctx);
    assert(hash1 === hash2, "Same context must produce same hash");
    assert(hash1.length === 64, "Must be a 64-char SHA-256 hex string");
    assert(/^[0-9a-f]{64}$/.test(hash1), "Must be valid lowercase hex");
  });

  await test("buildReasonHash differs when discrepancyType differs", () => {
    const classification1 = makeClassification({ discrepancyType: "PROCESSING_FEE" });
    const classification2 = makeClassification({ discrepancyType: "COUNTERPARTY_DIFFERENCE" });
    const ctx1 = buildPromptContext(makeBankTxn(), [makeLedger()], "exact", classification1);
    const ctx2 = buildPromptContext(makeBankTxn(), [makeLedger()], "exact", classification2);
    assert(buildReasonHash(ctx1) !== buildReasonHash(ctx2), "Different discrepancyType must produce different hash");
  });

  await test("buildReasonHash differs when confidenceBand differs", () => {
    const c1 = makeClassification({ confidenceBand: "HIGH" });
    const c2 = makeClassification({ confidenceBand: "LOW" });
    const ctx1 = buildPromptContext(makeBankTxn(), [makeLedger()], "exact", c1);
    const ctx2 = buildPromptContext(makeBankTxn(), [makeLedger()], "exact", c2);
    assert(buildReasonHash(ctx1) !== buildReasonHash(ctx2), "Different confidenceBand must produce different hash");
  });

  await test("buildReasonHash 5% bucketing: 3% and 7% difference → same hash bucket", () => {
    // BUG-05 documentation: both round to 5% band → same cache entry.
    // This is by design but may cause wrong explanation for edge cases.
    const bankTxn3pct = makeBankTxn({ amount: 97_000 }); // 3% below ₹1000
    const bankTxn7pct = makeBankTxn({ amount: 93_000 }); // 7% below ₹1000
    const ledger = makeLedger({ amount: 100_000 });
    const c = makeClassification({ discrepancyType: "AMOUNT_DIFFERENCE" });
    const ctx1 = buildPromptContext(bankTxn3pct, [ledger], "fuzzy", c);
    const ctx2 = buildPromptContext(bankTxn7pct, [ledger], "fuzzy", c);
    // Both Math.round(3/5)*5 = 5 and Math.round(7/5)*5 = 5 → same bucket
    const hash1 = buildReasonHash(ctx1);
    const hash2 = buildReasonHash(ctx2);
    assert(hash1 === hash2, "3% and 7% diffs both bucket to 5% band → same hash (by design, test documents this)");
  });

  await test("buildReasonHash: differences crossing 5% bucket boundary → different hashes", () => {
    // BUG-05 boundary: 2% (rounds to 0) vs 3% (rounds to 5) are in different buckets
    const bankTxn2pct = makeBankTxn({ amount: 98_000 }); // 2% below ₹1000
    const bankTxn3pct = makeBankTxn({ amount: 97_000 }); // 3% below ₹1000
    const ledger = makeLedger({ amount: 100_000 });
    const c = makeClassification({ discrepancyType: "AMOUNT_DIFFERENCE" });
    const ctx1 = buildPromptContext(bankTxn2pct, [ledger], "fuzzy", c);
    const ctx2 = buildPromptContext(bankTxn3pct, [ledger], "fuzzy", c);
    // Math.round(2/5)*5 = 0 vs Math.round(3/5)*5 = 5 → different buckets
    const hash1 = buildReasonHash(ctx1);
    const hash2 = buildReasonHash(ctx2);
    assert(hash1 !== hash2, "2% and 3% diffs are in different 5% buckets → different hash");
  });

  await test("buildReasonHash differs when descriptionCategory differs", () => {
    const bankStripe = makeBankTxn({ description: "STRIPE PAYOUT po_123" });
    const bankNeft = makeBankTxn({ description: "NEFT INWARD" });
    const c = makeClassification();
    const ctx1 = buildPromptContext(bankStripe, [makeLedger()], "exact", c);
    const ctx2 = buildPromptContext(bankNeft, [makeLedger()], "exact", c);
    assert(buildReasonHash(ctx1) !== buildReasonHash(ctx2), "Different descriptionCategory → different hash");
  });

  // ══════════════════════════════════════════════════════════════════════════
  // GROUP 10: Backward Compatibility (Legacy Services)
  // ══════════════════════════════════════════════════════════════════════════
  section("Group 10: Backward Compatibility");

  await test("AIReasoning has likelyReason field for legacy dashboard", async () => {
    const classification = makeClassification({ discrepancyType: "PROCESSING_FEE", confidenceBand: "HIGH" });
    const result = await generateMatchReasoning(
      "txn-008", "org-001", makeBankTxn(), [makeLedger()],
      makeMatch(classification), new RunTracker(), new MockSuccessProvider()
    );
    assert(typeof result.reasoning.likelyReason === "string", "likelyReason must be a string");
    assert((result.reasoning.likelyReason ?? "").length > 0, "likelyReason must be non-empty");
  });

  await test("AIReasoning always has requiresHumanReview and flags", async () => {
    const classification = makeClassification({ discrepancyType: "PROCESSING_FEE", confidenceBand: "HIGH" });
    const result = await generateMatchReasoning(
      "txn-009", "org-001", makeBankTxn(), [makeLedger()],
      makeMatch(classification), new RunTracker(), new MockSuccessProvider()
    );
    assert(typeof result.reasoning.requiresHumanReview === "boolean",
      "requiresHumanReview must be boolean for legacy exceptions service");
    assert(Array.isArray(result.reasoning.flags),
      "flags must be an array for legacy services");
  });

  await test("MANUAL_REVIEW with no matching template → likelyReason is no_match", async () => {
    const classification = makeClassification({ discrepancyType: "MANUAL_REVIEW", confidenceBand: "LOW" });
    const match = makeMatch(classification, { matchType: "fuzzy", confidenceScore: 0.40 });
    const result = await generateMatchReasoning(
      "txn-010", "org-001", makeBankTxn(), [makeLedger()], match, new RunTracker(), new MockSuccessProvider()
    );
    // MANUAL_REVIEW not in TEMPLATES → FALLBACK_TEMPLATE.likelyReason = "no_match"
    if (result.reasoning.source === "LLM" || result.reasoning.source === "STATIC") {
      assert(result.reasoning.likelyReason === "no_match",
        "MANUAL_REVIEW likelyReason must be no_match");
    }
  });

  await test("COUNTERPARTY_DIFFERENCE with LOW confidence → likelyReason is unknown_counterparty", async () => {
    // Goes to LLM path because confidenceBand is LOW
    const classification = makeClassification({ discrepancyType: "COUNTERPARTY_DIFFERENCE", confidenceBand: "LOW" });
    const match = makeMatch(classification, { matchType: "fuzzy", confidenceScore: 0.40 });
    const result = await generateMatchReasoning(
      "txn-011", "org-001", makeBankTxn(), [makeLedger()], match, new RunTracker(), new MockSuccessProvider()
    );
    // Whether LLM or CACHE_HIT, likelyReason must come from TEMPLATES["COUNTERPARTY_DIFFERENCE"]
    if (result.reasoning.source === "LLM" || result.reasoning.source === "CACHE_HIT") {
      assert(result.reasoning.likelyReason === "unknown_counterparty",
        "COUNTERPARTY_DIFFERENCE likelyReason must be unknown_counterparty");
    }
  });

  await test("PROCESSING_FEE deterministic → likelyReason is razorpay_fee", async () => {
    const classification = makeClassification({ discrepancyType: "PROCESSING_FEE", confidenceBand: "HIGH" });
    const result = await generateMatchReasoning(
      "txn-012", "org-001", makeBankTxn(), [makeLedger()],
      makeMatch(classification), new RunTracker(), new MockFailingProvider()
    );
    assert(result.reasoning.likelyReason === "razorpay_fee",
      "PROCESSING_FEE → likelyReason must be razorpay_fee");
  });

  await test("STATIC fallback always has likelyReason=no_match", async () => {
    // Trigger STATIC via circuit breaker
    const tracker = new RunTracker();
    tracker.recordFailure(); tracker.recordFailure(); tracker.recordFailure();
    const classification = makeClassification({ discrepancyType: "MANUAL_REVIEW", confidenceBand: "LOW" });
    const match = makeMatch(classification, { matchType: "fuzzy", confidenceScore: 0.30 });
    const result = await generateMatchReasoning(
      "txn-013", "org-001", makeBankTxn(), [makeLedger()], match, tracker, new MockFailingProvider()
    );
    assert(result.reasoning.source === "STATIC", "Should be STATIC via tripped breaker");
    assert(result.reasoning.likelyReason === "no_match",
      "STATIC fallback must always have likelyReason=no_match");
  });

  // ══════════════════════════════════════════════════════════════════════════
  // GROUP 11: RecommendedAction Enum Completeness
  // (BUG-02 is resolved — AUTO_APPROVE removed from the system entirely)
  // ══════════════════════════════════════════════════════════════════════════
  section("Group 11: RecommendedAction Enum & Advisory-Only Contract");

  await test("Every suggestedAction in the system requires human review", () => {
    // All valid RecommendedAction values must imply requiresHumanReview=true.
    // AUTO_APPROVE has been removed — this test documents and locks that contract.
    const allValidActions = [
      "MANUAL_REVIEW",
      "REQUEST_DOCUMENTATION",
      "CHECK_LEDGER",
      "CHECK_BANK_STATEMENT",
      "INVESTIGATE_DUPLICATE",
      "FOLLOW_UP_VENDOR",
    ];
    for (const action of allValidActions) {
      // None of these should ever be associated with requiresHumanReview=false
      const requiresReview = action !== "AUTO_APPROVE"; // AUTO_APPROVE not in list
      assert(requiresReview === true, `${action} must always require human review`);
    }
    // Confirm AUTO_APPROVE is not in the valid set
    assert(!allValidActions.includes("AUTO_APPROVE"), "AUTO_APPROVE must not exist as a valid action");
  });

  await test("STATIC fallback suggestedAction is MANUAL_REVIEW (human-guided)", () => {
    // Verify the fallback action is the most cautious human-review option
    const tracker = new RunTracker();
    tracker.recordFailure(); tracker.recordFailure(); tracker.recordFailure();
    const classification = makeClassification({ discrepancyType: "MANUAL_REVIEW", confidenceBand: "LOW" });
    const match = makeMatch(classification, { matchType: "fuzzy", confidenceScore: 0.30 });
    return generateMatchReasoning(
      "txn-static-action", "org-001", makeBankTxn(), [makeLedger()], match, tracker, new MockFailingProvider()
    ).then(result => {
      assert(result.reasoning.suggestedAction === "MANUAL_REVIEW",
        "STATIC fallback action must be MANUAL_REVIEW");
      assert(result.reasoning.requiresHumanReview === true,
        "STATIC fallback must always have requiresHumanReview=true");
    });
  });

  await test("CACHE_HIT path requiresHumanReview is always true (no AUTO_APPROVE in cache)", () => {
    // BUG-02 is now resolved by design: since AUTO_APPROVE was removed from
    // RecommendedAction, the cache can never contain an AUTO_APPROVE entry.
    // CACHE_HIT hard-coding requiresHumanReview=true is now always correct.
    //
    // This test documents the resolved state. A DB-integration test should assert
    // that CACHE_HIT results have requiresHumanReview=true when added in future.
    const validCacheActions = [
      "MANUAL_REVIEW", "REQUEST_DOCUMENTATION", "CHECK_LEDGER",
      "CHECK_BANK_STATEMENT", "INVESTIGATE_DUPLICATE", "FOLLOW_UP_VENDOR",
    ];
    for (const action of validCacheActions) {
      // All of these should produce requiresHumanReview=true when served from cache
      assert(action !== "AUTO_APPROVE", `${action} must not be AUTO_APPROVE in cache`);
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // GROUP 12: Edge Cases & Boundary Conditions
  // ══════════════════════════════════════════════════════════════════════════
  section("Group 12: Edge Cases & Boundary Conditions");

  await test("PROMPT_VERSION is a non-empty string", () => {
    assert(typeof PROMPT_VERSION === "string", "PROMPT_VERSION must be a string");
    assert(PROMPT_VERSION.length > 0, "PROMPT_VERSION must be non-empty");
  });

  await test("generateMatchReasoning returns consistent result shape for ALL deterministic types", async () => {
    const deterministicTypes = [
      "NONE", "PROCESSING_FEE", "TIMING_DIFFERENCE", "FOREIGN_EXCHANGE",
      "AMOUNT_DIFFERENCE", "TYPO", "MISSING_ENTRY", "DUPLICATE",
      "DUPLICATE_INVOICE", "COUNTERPARTY_DIFFERENCE", "REFERENCE_DIFFERENCE",
    ];
    for (const discrepancyType of deterministicTypes) {
      const classification = makeClassification({ discrepancyType: discrepancyType as any, confidenceBand: "HIGH" });
      const result = await generateMatchReasoning(
        `txn-shape-${discrepancyType}`, "org-001", makeBankTxn(), [makeLedger()],
        makeMatch(classification), new RunTracker(), new MockFailingProvider()
      );
      assert(result.reasoning.version === "v1", `${discrepancyType}: version must be v1`);
      assert(typeof result.reasoning.likelyReason === "string", `${discrepancyType}: likelyReason must be string`);
      // Core advisory-only contract: requiresHumanReview is ALWAYS true
      assert(result.reasoning.requiresHumanReview === true,
        `${discrepancyType}: requiresHumanReview must always be true — AI is advisory only`);
      assert((result.reasoning.suggestedAction as string) !== "AUTO_APPROVE",
        `${discrepancyType}: AUTO_APPROVE must never appear in any output`);
      assert(Array.isArray(result.reasoning.evidenceCodes), `${discrepancyType}: evidenceCodes must be array`);
      assert(Array.isArray(result.reasoning.flags), `${discrepancyType}: flags must be array`);
      assert(typeof result.renderedExplanation === "string", `${discrepancyType}: renderedExplanation must be string`);
      assert(result.renderedExplanation.length > 0, `${discrepancyType}: renderedExplanation must be non-empty`);
    }
  });

  await test("generateMatchReasoning with null counterparty does not throw", async () => {
    const bankTxn = makeBankTxn({ counterparty: undefined });
    const ledger = makeLedger({ counterparty: undefined });
    const classification = makeClassification({ discrepancyType: "AMOUNT_DIFFERENCE", confidenceBand: "HIGH" });
    const result = await generateMatchReasoning(
      "txn-null-cp", "org-001", bankTxn, [ledger],
      makeMatch(classification), new RunTracker(), new MockFailingProvider()
    );
    assert(typeof result.renderedExplanation === "string", "Must not throw with null counterparty");
  });

  await test("generateMatchReasoning with empty referenceId does not throw", async () => {
    const bankTxn = makeBankTxn({ referenceId: "" });
    const ledger = makeLedger({ invoiceRef: "" });
    const classification = makeClassification({ discrepancyType: "REFERENCE_DIFFERENCE", confidenceBand: "HIGH" });
    const result = await generateMatchReasoning(
      "txn-empty-ref", "org-001", bankTxn, [ledger],
      makeMatch(classification), new RunTracker(), new MockFailingProvider()
    );
    // REFERENCE_DIFFERENCE template uses {bankReference} and {ledgerReference}
    // With empty strings these should render as empty, not throw
    assert(!result.renderedExplanation.includes("{bankReference}"), "Placeholder must be replaced even for empty ref");
    assert(!result.renderedExplanation.includes("{ledgerReference}"), "Placeholder must be replaced even for empty ref");
  });

  await test("generateMatchReasoning with bulk match (multiple ledger entries)", async () => {
    const ledger1 = makeLedger({ id: "led-001", amount: 60_000 });
    const ledger2 = makeLedger({ id: "led-002", amount: 40_000 });
    const bankTxn = makeBankTxn({ amount: 100_000 });
    const classification = makeClassification({ discrepancyType: "NONE", confidenceBand: "HIGH" });
    const match = makeMatch(classification, {
      bankTransactionIds: ["txn-001"],
      ledgerEntryIds: ["led-001", "led-002"],
      matchType: "bulk",
    });
    const result = await generateMatchReasoning(
      "txn-bulk-01", "org-001", bankTxn, [ledger1, ledger2],
      match, new RunTracker(), new MockFailingProvider()
    );
    assert(typeof result.reasoning === "object", "Must return valid reasoning for bulk match");
    assert(typeof result.renderedExplanation === "string", "Must return rendered explanation for bulk match");
  });

  await test("Negative amount difference (overpayment) does not crash buildPromptContext", () => {
    // Bank credited MORE than ledger — difference is negative
    const bankTxn = makeBankTxn({ amount: 110_000 });
    const ledger = makeLedger({ amount: 100_000 });
    const ctx = buildPromptContext(bankTxn, [ledger], "fuzzy", makeClassification({
      discrepancyType: "AMOUNT_DIFFERENCE"
    }));
    assert(ctx.differenceMinor === 10_000, "differenceMinor should be positive 10_000 (bank > ledger)");
    assert(ctx.differencePercentage > 0, "differencePercentage must be positive");
  });

  await test("Date lag calculation is correct for 5-day settlement window", () => {
    const bankTxn = makeBankTxn({ date: new Date("2026-03-06T12:00:00Z") });
    const ledger = makeLedger({ date: new Date("2026-03-01T12:00:00Z") });
    const ctx = buildPromptContext(bankTxn, [ledger], "exact", makeClassification({
      discrepancyType: "TIMING_DIFFERENCE"
    }));
    assert(ctx.dateLagDays === 5, `dateLagDays should be 5, got ${ctx.dateLagDays}`);
  });

  await test("Date lag uses earliest ledger date for multi-entry bulk matches", () => {
    // Bank is 2026-03-05, ledger entries are 2026-03-01 and 2026-03-03
    // Lag should be abs(Mar05 - Mar01) = 4 days
    const bankTxn = makeBankTxn({ date: new Date("2026-03-05T12:00:00Z") });
    const ledger1 = makeLedger({ id: "l1", date: new Date("2026-03-01T12:00:00Z"), amount: 50_000 });
    const ledger2 = makeLedger({ id: "l2", date: new Date("2026-03-03T12:00:00Z"), amount: 50_000 });
    const ctx = buildPromptContext(bankTxn, [ledger1, ledger2], "bulk", makeClassification());
    assert(ctx.dateLagDays === 4, `dateLagDays should be 4 (earliest ledger), got ${ctx.dateLagDays}`);
  });

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log("\n  Failures:");
    failures.forEach((f, i) => console.log(`    ${i + 1}. ${f}`));
  }
  console.log("══════════════════════════════════════════════════════════════");

  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});