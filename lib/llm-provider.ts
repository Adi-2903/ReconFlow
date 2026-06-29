/**
 * lib/llm-provider.ts — Phase 9: LLM Provider Abstraction
 *
 * Provides a thin interface over the LLM backend so the reasoning layer can be
 * tested with a mock and switched to a different provider (e.g. Groq, Claude)
 * without touching ai-reason.ts.
 *
 * NOTE: Do NOT add a GroqProvider now. At ~$1.50/month Gemini cost, adding a
 * second API dependency (second key, second rate limit, second failure mode)
 * for marginal latency savings is not the right trade at this stage.
 */

import { GoogleGenAI } from "@google/genai";

// ── Provider interface ─────────────────────────────────────────────────────────

export interface LLMProvider {
  /**
   * Call the underlying model with a system + user prompt pair.
   * Returns the raw text response (JSON string expected by the caller).
   */
  complete(systemPrompt: string, userPrompt: string): Promise<string>;
  /** Human-readable model identifier used for observability logging. */
  readonly name: string;
}

// ── Gemini 2.5 Flash implementation ───────────────────────────────────────────

let _geminiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (!_geminiClient) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not set in environment variables.");
    }
    _geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return _geminiClient;
}

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini-2.5-flash";

  async complete(systemPrompt: string, userPrompt: string): Promise<string> {
    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `${systemPrompt}\n\n${userPrompt}`,
      config: {
        responseMimeType: "application/json",
      },
    });
    return response.text ?? "{}";
  }
}
