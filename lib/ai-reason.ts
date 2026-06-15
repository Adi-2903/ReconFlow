import { GoogleGenAI } from "@google/genai";
import { BankTransaction, LedgerEntry } from "@/core/matching/engine";

// FIX: Module-level client — instantiate once, not on every call.
// With 50 transactions this was creating 50 separate GoogleGenAI clients.
let _ai: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (!_ai) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY not set");
    }
    _ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return _ai;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FeePattern {
  type: string;
  typicalAmountPaise?: number;
  typicalRangePaise?: [number, number];
}

export interface AIExplanationResult {
  bestMatchId: string | null;
  confidence: number;
  discrepancyAmountPaise: number;
  likelyReason: string;
  explanation: string;
  requiresHumanReview: boolean;
  flags: string[];
}

// ── Default fee patterns ───────────────────────────────────────────────────────
// These are injected into the prompt so Gemini can recognize common discrepancies
// without guessing. Add your own observed patterns here over time.
export const DEFAULT_FEE_PATTERNS: FeePattern[] = [
  {
    type: "razorpay_fee_2pct",
    typicalRangePaise: [100, 500_000], // 2% of transaction
  },
  {
    type: "stripe_fee_usd",
    typicalRangePaise: [2_500, 25_000], // ~$0.30 + 2.9%, in paise equivalent
  },
  {
    type: "neft_charge",
    typicalAmountPaise: 50_000, // ₹500 flat NEFT charge (many Indian banks)
  },
  {
    type: "imps_charge",
    typicalRangePaise: [500, 2_500], // ₹5–₹25
  },
  {
    type: "fx_conversion_spread",
    typicalRangePaise: [1_000, 50_000], // 1–3% FX spread
  },
  {
    type: "tds_deduction_1pct",
    typicalRangePaise: [1_000, 100_000], // 1% TDS on professional services
  },
];

// ── Main function ─────────────────────────────────────────────────────────────

export async function generateMatchReason(
  bankTxn: BankTransaction,
  candidates: LedgerEntry[],
  knownFeePatterns: FeePattern[] = DEFAULT_FEE_PATTERNS
): Promise<AIExplanationResult> {
  const fallback: AIExplanationResult = {
    bestMatchId: candidates.length > 0 ? candidates[0].id : null,
    confidence: 0.5,
    discrepancyAmountPaise: 0,
    likelyReason: "no_match",
    explanation: "Manual review required",
    requiresHumanReview: true,
    flags: [],
  };

  if (!process.env.GEMINI_API_KEY) {
    console.warn("GEMINI_API_KEY not set — AI explanations disabled");
    return fallback;
  }

  try {
    const ai = getAI();

    // FIX: Send everything in paise throughout. Do NOT convert to rupees for
    // the prompt and then ask Gemini to return paise — that causes arithmetic errors.
    // Instead, tell Gemini what the unit is and keep it consistent.
    const prompt = `You are an expert financial reconciliation AI for Indian and global startups.
Your job is to explain WHY a bank transaction and one or more ledger entries matched (or didn't),
based on a deterministic engine's best candidates.

All monetary amounts below are in PAISE (1 INR = 100 paise, 1 USD = 100 cents).

Bank Transaction:
${JSON.stringify(bankTxn, null, 2)}

Candidate Ledger Entries (these are the engine's best guesses):
${JSON.stringify(candidates, null, 2)}

Known Fee Patterns (use these to identify likely causes of discrepancies):
${JSON.stringify(knownFeePatterns, null, 2)}

Your task:
1. Compare the bank amount to the sum of candidate ledger amounts.
2. Calculate the exact discrepancy in paise.
3. Identify the most likely reason for the discrepancy using the known fee patterns.
4. Write a concise explanation (max 20 words) a finance team can act on immediately.

Respond ONLY with a valid JSON object — no markdown, no \`\`\`json, no preamble:
{
  "bestMatchId": "string (id of the best matching ledger entry, or null if no candidates)",
  "confidence": number (0.0 to 1.0 — how confident you are in this match),
  "discrepancyAmountPaise": number (bank amount minus sum of ledger amounts, can be negative),
  "likelyReason": "string (one of: 'exact_match' | 'razorpay_fee' | 'stripe_fee' | 'neft_charge' | 'imps_charge' | 'fx_conversion' | 'tds_deduction' | 'partial_payment' | 'bulk_payment' | 'date_delay' | 'no_match')",
  "explanation": "string (max 20 words, direct and confident — e.g. 'Amount ₹232 short — Razorpay 2% processing fee deducted before payout.')",
  "requiresHumanReview": boolean (true if confidence < 0.90 or discrepancy is unexplained),
  "flags": ["array of applicable tags: 'razorpay_fee' | 'stripe_fee' | 'neft_charge' | 'fx_conversion' | 'tds_deduction' | 'partial_payment' | 'bulk_payment' | 'date_delay' | 'duplicate_risk' | 'large_delta' | 'unknown_counterparty'"]
}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const resultText = response.text ?? "{}";

    // Safety net: strip any markdown fences Gemini might still emit
    const cleanJson = resultText
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();

    const parsed = JSON.parse(cleanJson);

    return {
      bestMatchId: parsed.bestMatchId ?? null,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      discrepancyAmountPaise: typeof parsed.discrepancyAmountPaise === "number"
        ? parsed.discrepancyAmountPaise
        : 0,
      likelyReason: parsed.likelyReason ?? "no_match",
      explanation: parsed.explanation ?? "Manual review required",
      requiresHumanReview: !!parsed.requiresHumanReview,
      flags: Array.isArray(parsed.flags) ? parsed.flags : [],
    };
  } catch (error) {
    console.error("Gemini generateMatchReason failed:", error);
    return fallback;
  }
}