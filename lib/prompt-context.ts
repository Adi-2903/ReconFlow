/**
 * lib/prompt-context.ts — Phase 9: PII Sanitisation & Prompt Context Builder
 *
 * DPDP Act Compliance (Digital Personal Data Protection Act, 2023):
 * Sending counterpartyName, description, or referenceNumber verbatim to
 * generativelanguage.googleapis.com constitutes a real exposure for an
 * Indian SaaS — bank statements contain customer names, account details,
 * and narrations. This module extracts ONLY structural/categorical features.
 *
 * Zero free text, zero raw names, zero references are passed to the LLM.
 */

import { getEditDistance, isDigitTransposition } from "@/core/matching/matchingHelpers";
import type { BankTransaction, LedgerEntry } from "@/core/matching/engine";
import type { ClassificationResult } from "@/core/matching/classifier";

// ── PromptContext shape ────────────────────────────────────────────────────────

export interface PromptContext {
  matchType: string;
  discrepancyType: string;
  confidenceBand: string;
  currency: string;
  amountBucket: string;
  bankAmountMinor: number;
  ledgerSumMinor: number;
  differenceMinor: number;
  differencePercentage: number;
  dateLagDays: number;
  counterpartySimilarity: {
    hasBankCounterparty: boolean;
    hasLedgerCounterparty: boolean;
    exactMatch: boolean;
    editDistance: number;
    /** Ratio of shorter name length to longer — 1.0 = same length. */
    charLengthRatio: number;
  };
  referenceSimilarity: {
    hasBankReference: boolean;
    hasLedgerReference: boolean;
    exactMatch: boolean;
    digitTransposition: boolean;
  };
  /** Derived from description keywords — raw narration is never forwarded. */
  descriptionCategory: "STRIPE" | "RAZORPAY" | "NEFT" | "RTGS" | "IMPS" | "GENERAL";
  evidenceCodes: string[];
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function classifyDescription(description: string): PromptContext["descriptionCategory"] {
  const upper = description.toUpperCase();
  if (upper.includes("STRIPE"))   return "STRIPE";
  if (upper.includes("RAZORPAY")) return "RAZORPAY";
  if (upper.includes("NEFT"))     return "NEFT";
  if (upper.includes("RTGS"))     return "RTGS";
  if (upper.includes("IMPS"))     return "IMPS";
  return "GENERAL";
}

function normalizeForCompare(s?: string): string {
  if (!s) return "";
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "").trim();
}

// ── Public builder ─────────────────────────────────────────────────────────────

/**
 * Builds a PII-free structural summary of a match group for LLM consumption.
 *
 * The output contains NO raw names, narrations, or reference strings —
 * only derived categorical and numeric features. This is the only function
 * that is allowed to inspect free-text fields from bankTxn/candidates.
 */
export function buildPromptContext(
  bankTxn: BankTransaction,
  candidates: LedgerEntry[],
  matchType: string,
  classification: ClassificationResult
): PromptContext {
  const bankAmt = bankTxn.amount;
  const ledgerSum = candidates.reduce((s, c) => s + c.amount, 0);
  const diffMinor = bankAmt - ledgerSum;
  const diffPct = ledgerSum !== 0 ? (Math.abs(diffMinor) / ledgerSum) * 100 : 0;

  // Date lag: days between bank date and earliest ledger date
  let dateLagDays = 0;
  if (candidates.length > 0) {
    const minLedgerMs = Math.min(...candidates.map((c) => c.date.getTime()));
    dateLagDays = Math.abs(
      Math.floor((bankTxn.date.getTime() - minLedgerMs) / (1000 * 60 * 60 * 24))
    );
  }

  // Counterparty comparison — only structural features, not the names themselves
  const bankCp = normalizeForCompare(bankTxn.counterparty);
  const ledgerCp = normalizeForCompare(candidates[0]?.counterparty);
  const cpExact = bankCp !== "" && bankCp === ledgerCp;
  const cpEditDist = bankCp && ledgerCp ? getEditDistance(bankCp, ledgerCp) : 0;
  const maxLen = Math.max(bankCp.length, ledgerCp.length);
  const cpLenRatio = maxLen > 0 ? Math.min(bankCp.length, ledgerCp.length) / maxLen : 1;

  // Reference comparison
  const bankRef = bankTxn.referenceId || "";
  const ledgerRef = candidates[0]?.invoiceRef || "";
  const refExact = bankRef !== "" && bankRef === ledgerRef;
  const refDigitSwap = bankRef && ledgerRef ? isDigitTransposition(bankRef, ledgerRef) : false;

  const bankAmtAbs = Math.abs(bankAmt);
  let amountBucket: string;
  if (bankAmtAbs < 100_000) {
    amountBucket = "0-1k";
  } else if (bankAmtAbs < 1_000_000) {
    amountBucket = "1k-10k";
  } else if (bankAmtAbs < 10_000_000) {
    amountBucket = "10k-100k";
  } else {
    amountBucket = "100k+";
  }

  return {
    matchType,
    discrepancyType: classification.discrepancyType,
    confidenceBand: classification.confidenceBand,
    currency: bankTxn.currency || "INR",
    amountBucket,
    bankAmountMinor: bankAmt,
    ledgerSumMinor: ledgerSum,
    differenceMinor: diffMinor,
    differencePercentage: Math.round(diffPct * 100) / 100,
    dateLagDays,
    counterpartySimilarity: {
      hasBankCounterparty: bankTxn.counterparty != null && bankTxn.counterparty !== "",
      hasLedgerCounterparty: (candidates[0]?.counterparty ?? "") !== "",
      exactMatch: cpExact,
      editDistance: cpEditDist,
      charLengthRatio: Math.round(cpLenRatio * 100) / 100,
    },
    referenceSimilarity: {
      hasBankReference: bankRef !== "",
      hasLedgerReference: ledgerRef !== "",
      exactMatch: refExact,
      digitTransposition: refDigitSwap,
    },
    descriptionCategory: classifyDescription(bankTxn.description),
    evidenceCodes: classification.evidence.map((e) => e.code),
  };
}
