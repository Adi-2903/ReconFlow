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

let _geminiClients: GoogleGenAI[] = [];
let _currentClientIndex = 0;

function getGeminiClients(): GoogleGenAI[] {
  if (_geminiClients.length === 0) {
    const apiKeys: string[] = [];
    
    if (process.env.GEMINI_API_KEY) {
      apiKeys.push(process.env.GEMINI_API_KEY);
    }
    
    // Check for GEMINI_API_KEY_1, GEMINI_API_KEY_2, GEMINI_API_KEY_3, etc.
    for (let i = 1; i <= 10; i++) {
      const key = process.env[`GEMINI_API_KEY_${i}`];
      if (key && !apiKeys.includes(key)) {
        apiKeys.push(key);
      }
    }
    
    if (apiKeys.length === 0) {
      throw new Error(
        "No Gemini API keys found in environment variables. Please set GEMINI_API_KEY, GEMINI_API_KEY_1, GEMINI_API_KEY_2, or GEMINI_API_KEY_3."
      );
    }
    
    _geminiClients = apiKeys.map(key => new GoogleGenAI({ apiKey: key }));
  }
  return _geminiClients;
}

function getNextGeminiClient(): { client: GoogleGenAI; index: number; count: number } {
  const clients = getGeminiClients();
  const index = _currentClientIndex;
  const client = clients[index];
  _currentClientIndex = (_currentClientIndex + 1) % clients.length;
  return { client, index, count: clients.length };
}

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini-2.5-flash";

  async complete(systemPrompt: string, userPrompt: string): Promise<string> {
    const { client, index, count } = getNextGeminiClient();
    console.log(`[GeminiProvider] Using API key index ${index + 1} of ${count}`);
    const response = await client.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `${systemPrompt}\n\n${userPrompt}`,
      config: {
        responseMimeType: "application/json",
      },
    });
    return response.text ?? "{}";
  }
}
