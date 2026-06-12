import { GoogleGenAI } from "@google/genai";
import { BankTransaction, LedgerEntry } from "@/core/matching/engine";

export interface AIExplanationResult {
  bestMatchId: string | null;
  confidence: number;
  discrepancyAmountPaise: number;
  likelyReason: string;
  explanation: string;
  requiresHumanReview: boolean;
  flags: string[];
}

export async function generateMatchReason(
  bankTxn: BankTransaction,
  candidates: LedgerEntry[],
  knownFeePatterns?: { type: string; typicalAmountPaise?: number; typicalRangePaise?: [number, number] }[]
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
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    // Format amounts for the prompt to be human readable (Rupees instead of paise)
    const formattedBankTxn = {
      ...bankTxn,
      amountRupees: bankTxn.amount / 100,
    };

    const formattedCandidates = candidates.map(c => ({
      ...c,
      amountRupees: c.amount / 100,
    }));

    const prompt = `You are an expert financial reconciliation AI. Your job is to explain WHY a bank transaction and one or more ledger entries matched (or didn't). 
The deterministic engine has already decided these are the best candidates. You just need to explain the discrepancy (if any).

Bank Transaction:
${JSON.stringify(formattedBankTxn, null, 2)}

Candidate Ledger Entries:
${JSON.stringify(formattedCandidates, null, 2)}

Known Fee Patterns (optional context):
${JSON.stringify(knownFeePatterns || [], null, 2)}

Respond ONLY with a valid JSON object matching this exact structure:
{
  "bestMatchId": "string (the id of the most likely ledger entry match, or null if completely unrelated)",
  "confidence": number (0.0 to 1.0),
  "discrepancyAmountPaise": number (the difference in paise between the bank amount and ledger amount(s)),
  "likelyReason": "string (one of: 'exact_match', 'stripe_fee', 'neft_charge', 'fx_conversion', 'partial_payment', 'bulk_payment', 'date_delay', 'no_match')",
  "explanation": "string (max 20 words, plain English, confident statement explaining the match or discrepancy)",
  "requiresHumanReview": boolean (true if confidence < 0.95 or discrepancy is unusual),
  "flags": ["string array (any of: 'wire_fee', 'fx_conversion', 'partial_payment', 'date_delay', 'bulk_payment', 'duplicate_risk', 'large_delta', 'unknown_counterparty')"]
}

Important Rules:
1. Do not use markdown blocks (e.g. \`\`\`json). Just return the raw JSON object.
2. The explanation should be concise and confident. "Amount ₹500 short — likely NEFT charge."
3. Calculate discrepancyAmountPaise precisely.
`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const resultText = response.text || "{}";
    
    // Attempt to parse JSON. Gemini might still include markdown blocks despite instructions.
    const cleanJsonText = resultText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    try {
      const parsed = JSON.parse(cleanJsonText);
      return {
        bestMatchId: parsed.bestMatchId || null,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
        discrepancyAmountPaise: parsed.discrepancyAmountPaise || 0,
        likelyReason: parsed.likelyReason || "no_match",
        explanation: parsed.explanation || "Manual review required",
        requiresHumanReview: !!parsed.requiresHumanReview,
        flags: Array.isArray(parsed.flags) ? parsed.flags : [],
      };
    } catch (parseError) {
      console.error("Failed to parse Gemini response as JSON:", cleanJsonText);
      return fallback;
    }

  } catch (error) {
    console.error("Error generating match reason with Gemini:", error);
    return fallback;
  }
}
