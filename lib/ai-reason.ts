/**
 * lib/ai-reason.ts — Phase 9: AI Reasoning Layer
 *
 * Parallel routing architecture:
 *   1. Deterministic path  (~90-95% of matches) — zero API cost
 *   2. LLM path            (~5-10% of matches)  — only when Phase 7 couldn't classify
 *
 * Routing decision: shouldUseLLM() fires ONLY when discrepancyType is MANUAL_REVIEW
 * or confidenceBand is LOW. All other types, even COUNTERPARTY_DIFFERENCE or TYPO,
 * get a deterministic template if Phase 7 labeled them with medium/high confidence.
 *
 * Reliability:
 *   - 5 second timeout per LLM call (prevents orphaned reconciliation runs)
 *   - 1 retry on transient failure
 *   - Per-run circuit breaker (trips at 3 consecutive failures)
 *   - Concurrent runs each get an independent RunTracker
 *
 * Safety:
 *   - LLM suggestedAction and requiresHumanReview are ADVISORY ONLY
 *   - Authoritative disposition is controlled by riskScore + confidenceBand
 *   - All LLM prompts go through buildPromptContext() — zero PII, zero free text
 *   - Zod validation on all LLM responses before DB persistence
 */

import { createHash } from "crypto";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "@/core/db";
import { aiExplanationCache } from "@/core/db/schema";
import { PROMPT_VERSION, type AIReasoning, type RecommendedAction } from "@/types";
import { GeminiProvider, type LLMProvider } from "@/lib/llm-provider";
import { buildPromptContext, type PromptContext } from "@/lib/prompt-context";
import type { BankTransaction, LedgerEntry, MatchResult } from "@/core/matching/engine";

// ── Observability ─────────────────────────────────────────────────────────────

interface AIObservabilityEvent {
  event: "ai_explanation_generated";
  matchId: string;
  source: "STATIC" | "PARAMETERIZED" | "CACHE_HIT" | "LLM";
  discrepancyType: string;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheHit: boolean;
  promptVersion: string;
  /** false when Zod validation failed — do not persist bad LLM data */
  valid: boolean;
  orgId: string;
}

function emitObservabilityEvent(event: AIObservabilityEvent): void {
  console.log(JSON.stringify(event));
}

// ── Routing ───────────────────────────────────────────────────────────────────

/**
 * LLM is last resort only — fires when Phase 7 literally couldn't classify.
 *
 * If the classifier produced ANY label with medium/high confidence, render it
 * deterministically regardless of the label. The label itself IS the explanation.
 *
 * This keeps the LLM path at ~5-10% of matches in practice.
 */
export function shouldUseLLM(result: {
  discrepancyType: string;
  confidenceBand: string;
}): boolean {
  return (
    result.discrepancyType === "MANUAL_REVIEW" ||
    result.confidenceBand === "LOW"
  );
}

// ── Deterministic Templates ───────────────────────────────────────────────────

type TemplateSpec = {
  explanationTemplate: string;
  suggestedAction: RecommendedAction;
  requiresHumanReview: boolean;
  likelyReason: string;
};

const TEMPLATES: Partial<Record<string, TemplateSpec>> = {
  // Exact match
  NONE: {
    explanationTemplate: "Exact match on amount and date. No discrepancy detected.",
    suggestedAction: "AUTO_APPROVE",
    requiresHumanReview: false,
    likelyReason: "exact_match",
  },
  // Known payment processor fee deducted before settlement
  PROCESSING_FEE: {
    explanationTemplate:
      "Processing fee of {difference} deducted by payment gateway before settlement.",
    suggestedAction: "AUTO_APPROVE",
    requiresHumanReview: false,
    likelyReason: "razorpay_fee",
  },
  // Bank settlement timing lag
  TIMING_DIFFERENCE: {
    explanationTemplate:
      "Amount matches exactly. Bank settlement lag detected — ledger entry may have been recorded before the bank processed the transaction.",
    suggestedAction: "AUTO_APPROVE",
    requiresHumanReview: false,
    likelyReason: "date_delay",
  },
  // FX conversion difference
  FOREIGN_EXCHANGE: {
    explanationTemplate:
      "FX conversion difference of {difference}. The bank and ledger entries are in different currencies — residual is within expected exchange rate spread.",
    suggestedAction: "AUTO_APPROVE",
    requiresHumanReview: false,
    likelyReason: "fx_conversion",
  },
  // Genuine partial underpayment
  AMOUNT_DIFFERENCE: {
    explanationTemplate:
      "Amount discrepancy of {difference} is not explained by a known fee or FX conversion. Review bank statement and ledger for missing adjustments.",
    suggestedAction: "CHECK_BANK_STATEMENT",
    requiresHumanReview: true,
    likelyReason: "partial_payment",
  },
  // Digit transposition or name spelling typo
  TYPO: {
    explanationTemplate:
      "Possible data-entry typo detected. Bank shows '{bankCounterparty}' while ledger shows '{ledgerCounterparty}'. Verify and correct the reference data.",
    suggestedAction: "CHECK_LEDGER",
    requiresHumanReview: true,
    likelyReason: "no_match",
  },
  // Ledger entry missing entirely
  MISSING_ENTRY: {
    explanationTemplate:
      "Transaction present in bank statement but no matching ledger entry found. Create the missing ledger entry or mark as an unrecorded transaction.",
    suggestedAction: "CHECK_LEDGER",
    requiresHumanReview: true,
    likelyReason: "no_match",
  },
  // Duplicate bank-side transaction
  DUPLICATE: {
    explanationTemplate:
      "Duplicate transaction detected on the bank side. Verify that this is not a double payment before approving.",
    suggestedAction: "INVESTIGATE_DUPLICATE",
    requiresHumanReview: true,
    likelyReason: "duplicate_risk",
  },
  // Duplicate invoice in ledger
  DUPLICATE_INVOICE: {
    explanationTemplate:
      "Multiple identical invoice references found in the ledger for this bank transaction. Remove the duplicate ledger entry.",
    suggestedAction: "INVESTIGATE_DUPLICATE",
    requiresHumanReview: true,
    likelyReason: "duplicate_risk",
  },
  // Counterparty name mismatch beyond typo threshold
  COUNTERPARTY_DIFFERENCE: {
    explanationTemplate:
      "Counterparty name on the bank statement does not match the ledger entry. Bank: '{bankCounterparty}' — Ledger: '{ledgerCounterparty}'. Confirm the correct vendor before approving.",
    suggestedAction: "FOLLOW_UP_VENDOR",
    requiresHumanReview: true,
    likelyReason: "unknown_counterparty",
  },
  // Reference number mismatch
  REFERENCE_DIFFERENCE: {
    explanationTemplate:
      "Invoice reference numbers differ completely. Bank reference: '{bankReference}' — Ledger reference: '{ledgerReference}'. Identify the correct invoice.",
    suggestedAction: "REQUEST_DOCUMENTATION",
    requiresHumanReview: true,
    likelyReason: "no_match",
  },
};

// Fallback for unknown types or LLM failures
const FALLBACK_TEMPLATE: TemplateSpec = {
  explanationTemplate:
    "Match requires manual review. Unable to determine the cause of discrepancy automatically.",
  suggestedAction: "MANUAL_REVIEW",
  requiresHumanReview: true,
  likelyReason: "no_match",
};

// ── Structural Hash ───────────────────────────────────────────────────────────

/**
 * Produces a stable hash from structural (not content) features of a match.
 *
 * Buckets differencePercentage into 5% bands to maximise cache reuse across
 * similar-but-not-identical matches (e.g. 60-65% PROCESSING_FEE repetitions
 * in Indian SME data all hash identically and share one cache row).
 */
export function buildReasonHash(ctx: PromptContext): string {
  const key = [
    ctx.discrepancyType,
    ctx.matchType,
    ctx.confidenceBand,
    ctx.descriptionCategory,
    // Bucket into 5 % bands — trades precision for cache hit rate
    Math.round(ctx.differencePercentage / 5) * 5,
    ctx.counterpartySimilarity.exactMatch,
    ctx.referenceSimilarity.digitTransposition,
  ].join("|");
  return createHash("sha256").update(key).digest("hex");
}

// ── Circuit Breaker ───────────────────────────────────────────────────────────

/**
 * Per-run circuit breaker scoped to a single reconciliation run.
 *
 * ⚠️ Concurrency note: RunTracker is scoped per-run. If N reconciliation
 * runs execute concurrently (e.g. N orgs reconciling simultaneously), each
 * run has an independent breaker. During a global Gemini outage, at most
 * 3 * N LLM calls will be attempted before all runs fall back. At current
 * scale (single-tenant or low concurrency) this is acceptable. At higher
 * concurrency, consider a process-level shared breaker.
 */
export class RunTracker {
  private failures = 0;
  private readonly threshold = 3;
  private tripped = false;

  recordFailure(): void {
    this.failures++;
    if (this.failures >= this.threshold && !this.tripped) {
      this.tripped = true;
      console.warn(
        JSON.stringify({
          event: "circuit_breaker_tripped",
          failures: this.failures,
          promptVersion: PROMPT_VERSION,
        })
      );
    }
  }

  recordSuccess(): void {
    this.failures = 0;
  }

  isTripped(): boolean {
    return this.tripped;
  }
}

// ── Timeout Wrapper ───────────────────────────────────────────────────────────

/**
 * Races a promise against a timeout. Rejects with Error("LLM_TIMEOUT") if the
 * timeout fires first. The timer is always cleared to prevent memory leaks.
 */
async function withTimeout<T>(promise: Promise<T>, ms = 5000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("LLM_TIMEOUT")), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}

// ── LLM Response Validation ───────────────────────────────────────────────────

const LLMResponseSchema = z.object({
  explanationTemplate: z.string().min(10),
  suggestedAction: z.enum([
    "AUTO_APPROVE",
    "MANUAL_REVIEW",
    "REQUEST_DOCUMENTATION",
    "CHECK_LEDGER",
    "CHECK_BANK_STATEMENT",
    "INVESTIGATE_DUPLICATE",
    "FOLLOW_UP_VENDOR",
  ] as const),
  requiresHumanReview: z.boolean().optional().default(true),
});

// ── Cache Access ──────────────────────────────────────────────────────────────

async function lookupCache(
  reasonHash: string
): Promise<{ explanationTemplate: string; suggestedAction: string } | null> {
  try {
    const rows = await db
      .select()
      .from(aiExplanationCache)
      .where(
        and(
          eq(aiExplanationCache.reasonHash, reasonHash),
          eq(aiExplanationCache.promptVersion, PROMPT_VERSION)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  } catch (err) {
    // Table may not exist before migration is applied — treat as cache miss
    console.warn(
      JSON.stringify({
        event: "cache_lookup_failed",
        reasonHash,
        promptVersion: PROMPT_VERSION,
        note: "Cache table unavailable — treating as miss. Run scratch-apply-phase9-migration.ts.",
        error: String(err).slice(0, 120),
      })
    );
    return null;
  }
}

/**
 * Fire-and-forget cache save.
 *
 * onConflictDoNothing() handles the astronomically-unlikely SHA-256 collision
 * under the same PROMPT_VERSION. A structured warning is logged on conflict
 * so low cache hit rates surface in the observability dashboard rather than
 * becoming a silent blind spot.
 */
async function saveToCache(
  reasonHash: string,
  explanationTemplate: string,
  suggestedAction: string,
  model: string
): Promise<void> {
  try {
    const result = await db
      .insert(aiExplanationCache)
      .values({
        reasonHash,
        promptVersion: PROMPT_VERSION,
        suggestedAction,
        explanationTemplate,
        model,
      })
      .onConflictDoNothing();

    // Detect a dropped write (conflict occurred) and log it
    // rowsAffected === 0 means onConflictDoNothing fired
    const affected = (result as any)?.rowsAffected ?? (result as any)?.count ?? null;
    if (affected === 0) {
      console.warn(
        JSON.stringify({
          event: "cache_write_conflict",
          reasonHash,
          promptVersion: PROMPT_VERSION,
          note: "onConflictDoNothing fired — possible SHA-256 collision or concurrent write",
        })
      );
    }
  } catch (err) {
    // Non-critical — cache miss on next call is acceptable
    console.error(
      JSON.stringify({
        event: "cache_write_failed",
        reasonHash,
        promptVersion: PROMPT_VERSION,
        error: String(err),
      })
    );
  }
}

// ── LLM Invocation ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a financial reconciliation assistant for an Indian SaaS platform.
Your job is to generate a short explanation template for why a bank transaction and ledger entry
differ. The explanation will be shown to accountants who will act on it.

RULES:
- Return ONLY valid JSON, no markdown, no preamble.
- explanationTemplate: a single sentence (max 25 words) describing the discrepancy.
  Use only these placeholders where appropriate: {bankCounterparty}, {ledgerCounterparty},
  {bankReference}, {ledgerReference}, {difference}. Do not invent new placeholders.
- suggestedAction: one of AUTO_APPROVE | MANUAL_REVIEW | REQUEST_DOCUMENTATION |
  CHECK_LEDGER | CHECK_BANK_STATEMENT | INVESTIGATE_DUPLICATE | FOLLOW_UP_VENDOR.
- requiresHumanReview: boolean.
- Do NOT include confidence scores, counterparty names, or reference numbers in your response.`;

async function callLLM(
  ctx: PromptContext,
  provider: LLMProvider
): Promise<z.infer<typeof LLMResponseSchema>> {
  const userPrompt = JSON.stringify(ctx, null, 2);

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = await withTimeout(provider.complete(SYSTEM_PROMPT, userPrompt), 5000);
      // Strip any accidental markdown fences
      const clean = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const parsed = JSON.parse(clean);
      return LLMResponseSchema.parse(parsed);
    } catch (err) {
      const isLastAttempt = attempt === 2;
      if (isLastAttempt) throw err;
      // Small back-off before retry
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  // Unreachable — TypeScript needs this
  throw new Error("LLM call exhausted retries");
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface GenerateReasoningResult {
  reasoning: AIReasoning;
  /** Human-readable explanation rendered from the template at call time. */
  renderedExplanation: string;
}

/**
 * Primary entry point. Called once per non-trivially-matched bank transaction.
 *
 * @param matchId    - Bank transaction ID (for observability logs)
 * @param orgId      - Organization ID (for observability logs)
 * @param bankTxn    - Bank transaction from the matching engine
 * @param candidates - Matched ledger entries (may be empty for MISSING_ENTRY)
 * @param match      - Full MatchResult from Phase 7/8
 * @param tracker    - Run-scoped circuit breaker (shared across all tasks in a run)
 * @param provider   - LLM provider (injectable for testing — defaults to Gemini)
 */
export async function generateMatchReasoning(
  matchId: string,
  orgId: string,
  bankTxn: BankTransaction,
  candidates: LedgerEntry[],
  match: MatchResult,
  tracker: RunTracker,
  provider: LLMProvider = new GeminiProvider()
): Promise<GenerateReasoningResult> {
  const t0 = Date.now();
  const { discrepancyType, confidenceBand } = match.classification;

  // ── 1. Deterministic path ──────────────────────────────────────────────────
  if (!shouldUseLLM({ discrepancyType, confidenceBand })) {
    const spec = TEMPLATES[discrepancyType] ?? FALLBACK_TEMPLATE;

    const reasoning: AIReasoning = {
      version: "v1",
      source: "PARAMETERIZED",
      rootCause: discrepancyType,
      confidence: match.confidenceScore,
      requiresHumanReview: spec.requiresHumanReview,
      suggestedAction: spec.suggestedAction,
      explanationTemplate: spec.explanationTemplate,
      evidenceCodes: match.classification.evidence.map((e) => e.code),
      flags: [],
      modelUsed: null,
      tokenCount: null,
      latencyMs: Date.now() - t0,
      likelyReason: spec.likelyReason,
    };

    emitObservabilityEvent({
      event: "ai_explanation_generated",
      matchId,
      source: "PARAMETERIZED",
      discrepancyType,
      latencyMs: reasoning.latencyMs ?? null,
      inputTokens: null,
      outputTokens: null,
      cacheHit: false,
      promptVersion: PROMPT_VERSION,
      valid: true,
      orgId,
    });

    return {
      reasoning,
      renderedExplanation: renderTemplateInline(spec.explanationTemplate, bankTxn, candidates, match),
    };
  }

  // ── 2. Circuit breaker check ───────────────────────────────────────────────
  if (tracker.isTripped()) {
    return buildFallback(matchId, orgId, bankTxn, candidates, match, t0, "circuit breaker tripped");
  }

  // ── 3. DB Cache lookup ─────────────────────────────────────────────────────
  const ctx = buildPromptContext(bankTxn, candidates, match.matchType, match.classification);
  const reasonHash = buildReasonHash(ctx);

  const cached = await lookupCache(reasonHash);
  if (cached) {
    const latencyMs = Date.now() - t0;
    const reasoning: AIReasoning = {
      version: "v1",
      source: "CACHE_HIT",
      rootCause: discrepancyType,
      confidence: match.confidenceScore,
      requiresHumanReview: true,
      suggestedAction: cached.suggestedAction as RecommendedAction,
      explanationTemplate: cached.explanationTemplate,
      evidenceCodes: match.classification.evidence.map((e) => e.code),
      flags: [],
      modelUsed: null,
      tokenCount: null,
      latencyMs,
      likelyReason: "no_match",
    };

    emitObservabilityEvent({
      event: "ai_explanation_generated",
      matchId,
      source: "CACHE_HIT",
      discrepancyType,
      latencyMs,
      inputTokens: null,
      outputTokens: null,
      cacheHit: true,
      promptVersion: PROMPT_VERSION,
      valid: true,
      orgId,
    });

    return {
      reasoning,
      renderedExplanation: renderTemplateInline(cached.explanationTemplate, bankTxn, candidates, match),
    };
  }

  // ── 4. LLM call ───────────────────────────────────────────────────────────
  try {
    const llmResult = await callLLM(ctx, provider);
    tracker.recordSuccess();

    const latencyMs = Date.now() - t0;
    const reasoning: AIReasoning = {
      version: "v1",
      source: "LLM",
      rootCause: discrepancyType,
      confidence: match.confidenceScore,
      requiresHumanReview: llmResult.requiresHumanReview,
      suggestedAction: llmResult.suggestedAction,
      explanationTemplate: llmResult.explanationTemplate,
      evidenceCodes: match.classification.evidence.map((e) => e.code),
      flags: [],
      modelUsed: provider.name,
      tokenCount: null,
      latencyMs,
      likelyReason: "no_match",
    };

    emitObservabilityEvent({
      event: "ai_explanation_generated",
      matchId,
      source: "LLM",
      discrepancyType,
      latencyMs,
      inputTokens: null,
      outputTokens: null,
      cacheHit: false,
      promptVersion: PROMPT_VERSION,
      valid: true,
      orgId,
    });

    // Non-blocking background cache save
    void saveToCache(reasonHash, llmResult.explanationTemplate, llmResult.suggestedAction, provider.name);

    return {
      reasoning,
      renderedExplanation: renderTemplateInline(llmResult.explanationTemplate, bankTxn, candidates, match),
    };
  } catch (err) {
    tracker.recordFailure();

    emitObservabilityEvent({
      event: "ai_explanation_generated",
      matchId,
      source: "LLM",
      discrepancyType,
      latencyMs: Date.now() - t0,
      inputTokens: null,
      outputTokens: null,
      cacheHit: false,
      promptVersion: PROMPT_VERSION,
      valid: false, // Zod failure or timeout
      orgId,
    });

    console.error(
      JSON.stringify({
        event: "llm_call_failed",
        matchId,
        error: String(err),
        promptVersion: PROMPT_VERSION,
      })
    );

    return buildFallback(matchId, orgId, bankTxn, candidates, match, t0, String(err));
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Renders a template inline using renderExplanation logic (avoids a circular import). */
function renderTemplateInline(
  template: string,
  bankTxn: BankTransaction,
  candidates: LedgerEntry[],
  match: MatchResult
): string {
  const candidate = candidates[0];
  const diffMinor = bankTxn.amount - candidates.reduce((s, c) => s + c.amount, 0);

  let result = template;
  result = result.replace(/{bankCounterparty}/g, bankTxn.counterparty || "Unknown");
  result = result.replace(/{bankReference}/g, bankTxn.referenceId || "N/A");
  result = result.replace(/{bankDescription}/g, bankTxn.description || "");
  result = result.replace(/{bankAmount}/g, `₹${(Math.abs(bankTxn.amount) / 100).toFixed(2)}`);
  result = result.replace(/{ledgerCounterparty}/g, candidate?.counterparty || "");
  result = result.replace(/{ledgerReference}/g, candidate?.invoiceRef || "");
  result = result.replace(/{ledgerMemo}/g, candidate?.memo || "");
  result = result.replace(/{difference}/g, `₹${(Math.abs(diffMinor) / 100).toFixed(2)}`);
  return result.trim();
}

function buildFallback(
  matchId: string,
  orgId: string,
  bankTxn: BankTransaction,
  candidates: LedgerEntry[],
  match: MatchResult,
  t0: number,
  reason: string
): GenerateReasoningResult {
  const reasoning: AIReasoning = {
    version: "v1",
    source: "STATIC",
    rootCause: match.classification.discrepancyType,
    confidence: match.confidenceScore,
    requiresHumanReview: true,
    suggestedAction: "MANUAL_REVIEW",
    explanationTemplate: FALLBACK_TEMPLATE.explanationTemplate,
    evidenceCodes: match.classification.evidence.map((e) => e.code),
    flags: [],
    modelUsed: null,
    tokenCount: null,
    latencyMs: Date.now() - t0,
    likelyReason: "no_match",
  };

  return {
    reasoning,
    renderedExplanation: FALLBACK_TEMPLATE.explanationTemplate,
  };
}