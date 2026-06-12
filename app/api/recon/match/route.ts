import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";

// Initialize the Gemini client
// Note: process.env.GEMINI_API_KEY is automatically available in the secure server environment
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const { bank_transaction, ledger_entries } = await req.json();

    const prompt = `You are a financial reconciliation assistant. You will be given one bank transaction and one or more ledger entries that the system believes might match. Analyze them and output a JSON object only — no prose, no markdown, no explanation outside the JSON.

Output format (strict JSON, no other text):
{
  "confidence": <number between 0.0 and 1.0>,
  "reason": "<one sentence, max 15 words, explaining the key difference or match>",
  "flags": ["wire_fee" | "fx_conversion" | "partial_payment" | "date_delay" | "bulk_payment" | "duplicate_risk" | "large_delta"]
}

Rules for reason text:
- If exact match: "Amount, date, and reference all match perfectly."
- If amount differs by less than ₹500: "Amount ₹X short — likely wire fee or bank charge."
- If date differs by 1-3 days: "Payment cleared X days after invoice date — normal clearing time."
- If bulk match: "Bank payment covers X invoices totaling ₹Y."
- If no match: "No ledger entry found with similar amount or reference."
- NEVER mention uncertainty. State the most likely reason confidently.

Bank transaction:
${JSON.stringify(bank_transaction)}

Ledger entries to compare:
${JSON.stringify(ledger_entries)}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const resultText = response.text || "{}";
    
    // Parse the JSON safely
    let parsedResult;
    try {
      parsedResult = JSON.parse(resultText);
    } catch (e) {
      console.error("Failed to parse Gemini response as JSON", resultText);
      parsedResult = {
        confidence: 0,
        reason: "Failed to parse analysis result.",
        flags: [],
      };
    }

    return NextResponse.json(parsedResult);
  } catch (error) {
    console.error("Error in reconciliation analysis:", error);
    return NextResponse.json(
      { error: "Failed to perform reconciliation analysis." },
      { status: 500 }
    );
  }
}
