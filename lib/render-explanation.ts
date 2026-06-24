/**
 * lib/render-explanation.ts — Phase 9: Decoupled Explanation Renderer
 *
 * Stored explanationTemplates contain placeholders like '{bankCounterparty}'
 * and '{difference}'. This module interpolates actual transaction details at
 * display/read time — NOT at inference time.
 *
 * Design rationale: Storing a template rather than a final string means that
 * wording changes don't require re-running AI inference on historical records.
 * A one-line template update propagates immediately across all stored rows.
 */

// ── ⚠️  PII WARNING ────────────────────────────────────────────────────────────
// renderExplanation interpolates free-text fields from the raw transaction
// (bankTxn.counterparty, bankTxn.description, candidates[0].counterparty, …)
// into the rendered string shown to accountants in the UI.
//
// This is CORRECT and INTENTIONAL for human display purposes.
//
// However, the OUTPUT of this function MUST NEVER be fed back into an LLM
// prompt (e.g. for a future "explain this explanation" feature). Doing so
// would re-introduce the prompt injection vector that buildPromptContext()
// was specifically designed to eliminate.
// ─────────────────────────────────────────────────────────────────────────────

export function renderExplanation(
  template: string,
  bankTxn: {
    amount: number;
    description: string;
    counterparty?: string;
    referenceId?: string;
  },
  candidates: Array<{
    memo: string;
    counterparty?: string;
    invoiceRef?: string;
  }>,
  diffMinor: number
): string {
  // Defensive: single-sided cases (e.g. MISSING_ENTRY) have no candidates.
  // Templates for those types must not reference {ledgerCounterparty} or
  // {ledgerReference} — but we guard here anyway to prevent rendering errors.
  const candidate = candidates[0];

  let result = template;

  // Bank-side substitutions
  result = result.replace(/{bankCounterparty}/g, bankTxn.counterparty || "Unknown");
  result = result.replace(/{bankReference}/g, bankTxn.referenceId || "N/A");
  result = result.replace(/{bankDescription}/g, bankTxn.description || "");
  result = result.replace(/{bankAmount}/g, `₹${(Math.abs(bankTxn.amount) / 100).toFixed(2)}`);

  // Ledger-side substitutions — resolve to empty string for absent candidates
  result = result.replace(/{ledgerCounterparty}/g, candidate?.counterparty || "");
  result = result.replace(/{ledgerReference}/g, candidate?.invoiceRef || "");
  result = result.replace(/{ledgerMemo}/g, candidate?.memo || "");

  // Numeric/derived substitutions
  result = result.replace(/{difference}/g, `₹${(Math.abs(diffMinor) / 100).toFixed(2)}`);

  return result.trim();
}
