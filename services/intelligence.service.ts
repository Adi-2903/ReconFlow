import { db } from "../core/db";
import {
  canonicalTransactions,
  counterpartyProfiles,
  fxRates,
  feeRules,
  rawRecords,
  imports,
  organizations,
} from "../core/db/schema";
import { eq, and, lte, desc, sql } from "drizzle-orm";
import { CleaningService } from "./cleaning.service";
import { MatchingSignals } from "../types";
import { convertCurrency } from "../lib/fx-math";

export class IntelligenceService {
  /**
   * Main entry point to enrich a transaction input before it is inserted in DB.
   */
  static async enrichTransaction(
    orgId: string,
    rawInput: any,
    currentImportId?: string
  ): Promise<any> {
    const cleaner = new CleaningService({
      defaultCurrency: "USD",
      inferredDateFormat: "DD/MM/YYYY",
    });

    const enriched = { ...rawInput };
    if (!enriched.metadata) {
      enriched.metadata = {};
    }

    // Set version tracking
    enriched.metadata.intelligenceVersion = "v1";

    // 1. Field & Relationship Extraction Framework
    const matchingSignals: MatchingSignals = {};
    const textToScan = `${enriched.description || ""} ${enriched.referenceNumber || ""} ${enriched.counterpartyName || ""}`;

    // Extract Channel
    if (/upi/i.test(textToScan)) matchingSignals.channel = "UPI";
    else if (/neft/i.test(textToScan)) matchingSignals.channel = "NEFT";
    else if (/rtgs/i.test(textToScan)) matchingSignals.channel = "RTGS";
    else if (/imps/i.test(textToScan)) matchingSignals.channel = "IMPS";
    else if (/cash|deposit\s+branch|branch\s+counter/i.test(textToScan)) matchingSignals.channel = "CASH";
    else if (/ach|direct\s+debit|insurance\s+premium/i.test(textToScan)) matchingSignals.channel = "ACH";
    else if (/cheque|chk\b|cheque\s+number/i.test(textToScan)) matchingSignals.channel = "CHECK";
    else if (/card|visa|mastercard|amex/i.test(textToScan)) matchingSignals.channel = "CARD";
    else if (/stripe|checkout/i.test(textToScan)) matchingSignals.channel = "STRIPE";
    else if (/wire/i.test(textToScan)) matchingSignals.channel = "WIRE";

    // Extract UTR
    const utrMatch = textToScan.match(/(?:utr|ref|ref\s+no|txn|imps|upi|neft|rtgs|trf)[/:\-\s#]*([a-z0-9]{10,25})/i);
    if (utrMatch) {
      matchingSignals.utr = utrMatch[1];
    } else {
      // Direct upi 12 digit number extraction
      const upiNumberMatch = textToScan.match(/\b\d{12}\b/);
      if (upiNumberMatch) {
        matchingSignals.utr = upiNumberMatch[0];
      }
    }

    // Extract Invoice No
    const invoiceMatch = textToScan.match(/\b(inv(?:oice)?[-_#]?\d+(?:[-_]\d+)*)\b/i);
    if (invoiceMatch) {
      matchingSignals.invoiceNumber = invoiceMatch[1];
    }

    // Extract Voucher No
    const voucherMatch = textToScan.match(/\b(vch(?:oucher)?[-_#]?\d+)\b/i);
    if (voucherMatch) {
      matchingSignals.voucherNumber = voucherMatch[1];
    } else {
      // Support common Tally voucher pattern like S-1001, INV2001
      const tallyVchMatch = textToScan.match(/\b([a-zA-Z]+-\d+)\b/);
      if (tallyVchMatch) {
        matchingSignals.voucherNumber = tallyVchMatch[1];
      }
    }

    // Extract Reference Number
    if (enriched.referenceNumber) {
      matchingSignals.referenceNumber = enriched.referenceNumber;
    }

    // Extract Roles (Customer/Vendor/Merchant)
    if (/transfer from|payment received from|received from/i.test(textToScan)) {
      const parts = textToScan.split(/transfer from|payment received from|received from/i);
      if (parts[1]) {
        matchingSignals.customerName = parts[1].split(/[,;\-]/)[0].trim();
      }
    }
    if (/transfer to|payment to|paid to/i.test(textToScan)) {
      const parts = textToScan.split(/transfer to|payment to|paid to/i);
      if (parts[1]) {
        matchingSignals.vendorName = parts[1].split(/[,;\-]/)[0].trim();
      }
    }
    if (/stripe checkout|checkout/i.test(textToScan)) {
      matchingSignals.merchantName = "Stripe";
    }

    // Generic Relationship Extraction
    const relationshipMatch = textToScan.match(/\b(?:fee|re|refund|payout|po|ch)_(ch_[a-z0-9]+|po_[a-z0-9]+)\b/i);
    if (relationshipMatch) {
      matchingSignals.relatedTransactionId = relationshipMatch[1];
    } else {
      // Backup relationship check
      const genericRelMatch = textToScan.match(/\b(ch_[a-z0-9]{10,25}|re_[a-z0-9]{10,25}|po_[a-z0-9]{10,25})\b/i);
      if (genericRelMatch) {
        matchingSignals.relatedTransactionId = genericRelMatch[1];
      }
    }

    enriched.metadata.matchingSignals = matchingSignals;

    // 2. Counterparty Resolution + Threshold Guardrails
    const originalCounterparty = enriched.counterpartyName || enriched.description || "";
    let normalizedName = cleaner.normalizeCounterparty(originalCounterparty);

    // Apply known alias mapping rules
    if (/amazon/i.test(normalizedName)) {
      normalizedName = "amazon";
    } else if (/stripe/i.test(normalizedName)) {
      normalizedName = "stripe";
    } else if (/wise|transferwise|remitly|currencycloud|xe\b|forex|fx\b/i.test(normalizedName)) {
      normalizedName = "FX Service";
    }

    enriched.counterpartyNormalized = normalizedName;

    // Guardrail: check if profile already exists
    const [existingProfile] = await db
      .select()
      .from(counterpartyProfiles)
      .where(
        and(
          eq(counterpartyProfiles.organizationId, orgId),
          eq(counterpartyProfiles.normalizedName, normalizedName)
        )
      )
      .limit(1);

    if (existingProfile) {
      // Linked successfully
      enriched.metadata.counterpartyProfileId = existingProfile.id;
    } else {
      // Count existing occurrences in DB to see if it meets threshold
      // Occurrence criteria: >= 3 distinct transactions AND >= 2 distinct imports
      const txnsWithCounterparty = await db
        .select({
          id: canonicalTransactions.id,
          importId: rawRecords.importId,
        })
        .from(canonicalTransactions)
        .innerJoin(rawRecords, eq(canonicalTransactions.rawRecordId, rawRecords.id))
        .where(
          and(
            eq(canonicalTransactions.organizationId, orgId),
            eq(canonicalTransactions.counterpartyNormalized, normalizedName)
          )
        );

      const uniqueTxnIds = new Set(txnsWithCounterparty.map((t) => t.id));
      const uniqueImportIds = new Set(txnsWithCounterparty.map((t) => t.importId));

      // Include current in-flight record to count
      uniqueTxnIds.add("inflight-temp-id");
      if (currentImportId) {
        uniqueImportIds.add(currentImportId);
      }

      if (uniqueTxnIds.size >= 3 && uniqueImportIds.size >= 2) {
        // Auto-create profile!
        try {
          const [newProfile] = await db
            .insert(counterpartyProfiles)
            .values({
              organizationId: orgId,
              normalizedName: normalizedName,
              totalTransactions: uniqueTxnIds.size,
            })
            .returning();
          enriched.metadata.counterpartyProfileId = newProfile.id;
        } catch {
          // Ignore unique constraint concurrency racing
        }
      }
    }

    // 3. FX Conversion
    // Retrieve organization details to get base currency
    const [org] = await db
      .select({ baseCurrency: organizations.baseCurrency })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    const baseCurrency = org?.baseCurrency || "USD";

    enriched.baseCurrency = baseCurrency;

    if (enriched.currency === baseCurrency) {
      enriched.fxStatus = "NOT_REQUIRED";
      enriched.exchangeRate = null;
      enriched.convertedAmountMinor = null;
      enriched.exchangeRateSource = null;
      enriched.fxRateProvider = null;
      enriched.exchangeRateDate = null;
    } else if (rawInput.exchangeRate || rawInput.convertedAmountMinor) {
      enriched.fxStatus = "SOURCE_PROVIDED";
      enriched.exchangeRate = rawInput.exchangeRate ? String(rawInput.exchangeRate) : null;
      enriched.convertedAmountMinor = rawInput.convertedAmountMinor ? BigInt(rawInput.convertedAmountMinor) : null;
      enriched.exchangeRateSource = rawInput.exchangeRateSource || "connector";
      enriched.fxRateProvider = rawInput.fxRateProvider || null;
      enriched.exchangeRateDate = rawInput.exchangeRateDate || enriched.transactionDate;
    } else {
      // System Conversion: look up fx_rates table
      const [rateRow] = await db
        .select()
        .from(fxRates)
        .where(
          and(
            eq(fxRates.baseCurrency, baseCurrency),
            eq(fxRates.quoteCurrency, enriched.currency),
            eq(fxRates.rateDate, enriched.transactionDate)
          )
        )
        .limit(1);

      if (rateRow) {
        enriched.fxStatus = "CONVERTED";
        enriched.exchangeRate = rateRow.exchangeRate;
        enriched.exchangeRateSource = "reconflow_sync";
        enriched.fxRateProvider = "exchangerate.host";
        enriched.exchangeRateDate = rateRow.rateDate;

        // Apply direction-aware FX conversion math
        const converted = convertCurrency(
          BigInt(enriched.amountMinor),
          rateRow.exchangeRate,
          baseCurrency,
          enriched.currency,
          enriched.currency,
          baseCurrency
        );
        enriched.convertedAmountMinor = converted;
      } else {
        enriched.fxStatus = "MISSING_RATE";
        enriched.exchangeRate = null;
        enriched.convertedAmountMinor = null;
        enriched.exchangeRateSource = null;
        enriched.fxRateProvider = null;
        enriched.exchangeRateDate = null;
      }
    }

    // 4. Fee Rules Engine
    const rules = await db
      .select()
      .from(feeRules)
      .where(and(eq(feeRules.organizationId, orgId), eq(feeRules.active, true)));

    for (const rule of rules) {
      let isMatch = false;
      if (rule.provider.toLowerCase() === "stripe" && (/stripe/i.test(textToScan) || enriched.metadata.layout === "stripe_export")) {
        isMatch = true;
      } else if (rule.provider.toLowerCase() === "bank" && /bank\s+fee|service\s+charge|chg/i.test(textToScan)) {
        isMatch = true;
      } else if (rule.provider.toLowerCase() === "wire" && /wire\s+fee|wire\s+transfer/i.test(textToScan)) {
        isMatch = true;
      }

      if (isMatch) {
        const config = rule.feeConfig;
        const amountNum = Number(enriched.amountMinor);
        const expectedFee = Math.round(amountNum * (config.percentage / 100)) + config.fixedFeeMinor;
        enriched.metadata.expectedFeeMinor = expectedFee;
        enriched.metadata.feeRuleApplied = rule.ruleName;
        break; // Match first active rule
      }
    }

    // Decoupled asynchronous embeddings
    enriched.embeddingStatus = "PENDING";

    return enriched;
  }
}
