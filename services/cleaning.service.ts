import { parse as dateFnsParse, format as dateFnsFormat } from "date-fns";

export class CleaningService {
  private defaultCurrency: string;
  private inferredDateFormat: string;
  private accountLocale?: string;
  private accountCurrency?: string;
  private orgCurrency?: string;

  constructor(config: {
    defaultCurrency: string;
    inferredDateFormat: string;
    accountLocale?: string;
    accountCurrency?: string;
    orgCurrency?: string;
  }) {
    this.defaultCurrency = config.defaultCurrency;
    this.inferredDateFormat = config.inferredDateFormat;
    this.accountLocale = config.accountLocale;
    this.accountCurrency = config.accountCurrency;
    this.orgCurrency = config.orgCurrency;
  }

  /**
   * FUTURE PHASE: Alias Learning
   * 
   * Currently, we perform deterministic normalization in `normalizeCounterparty`.
   * In a future phase, we will implement counterparty alias learning. 
   * This will leverage the `counterpartyProfiles` and `learnedPatterns` tables
   * in schema.ts to dynamically map alternative names (e.g. "GOOGLE PAY", "G-PAY", "GOOGLE INDIA") 
   * back to a single parent profile (e.g., counterparty_profile = "google").
   * This profile grouping will act as a major scoring signal in the candidate matching engine.
   */

  /**
   * Parses date string using inferred format and returns YYYY-MM-DD
   */
  normalizeDate(dateStr: string): string {
    const cleanStr = dateStr.trim();
    if (!cleanStr) {
      throw new Error("Date string is empty.");
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(cleanStr)) {
      return cleanStr;
    }

    // Standardize delimiters for parsing
    const normalizedDelim = cleanStr.replace(/[-.]/g, "/");
    const segments = normalizedDelim.split("/");
    if (segments.length < 3) {
      throw new Error(`Invalid date format for: '${dateStr}'`);
    }

    const firstSegment = segments[0];
    const lastSegment = segments[segments.length - 1];

    let dateFnsFormatStr = "dd/MM/yyyy";
    if (/[a-zA-Z]/.test(normalizedDelim)) {
      const monthIndex = segments.findIndex(s => /[a-zA-Z]/.test(s));
      if (monthIndex !== -1) {
        const isShort = segments[monthIndex].length <= 3;
        const monthToken = isShort ? "MMM" : "MMMM";
        
        if (monthIndex === 0) {
          const yearToken = lastSegment.length === 2 ? "yy" : "yyyy";
          dateFnsFormatStr = `${monthToken}/dd/${yearToken}`;
        } else if (monthIndex === 1) {
          if (firstSegment.length === 4) {
            dateFnsFormatStr = `yyyy/${monthToken}/dd`;
          } else {
            const yearToken = lastSegment.length === 2 ? "yy" : "yyyy";
            dateFnsFormatStr = `dd/${monthToken}/${yearToken}`;
          }
        } else {
          const yearToken = firstSegment.length === 2 ? "yy" : "yyyy";
          dateFnsFormatStr = `${yearToken}/dd/${monthToken}`;
        }
      }
    } else if (this.inferredDateFormat === "YYYY-MM-DD") {
      dateFnsFormatStr = firstSegment.length === 2 ? "yy/MM/dd" : "yyyy/MM/dd";
    } else if (this.inferredDateFormat === "MM/DD/YYYY") {
      dateFnsFormatStr = lastSegment.length === 2 ? "MM/dd/yy" : "MM/dd/yyyy";
    } else {
      dateFnsFormatStr = lastSegment.length === 2 ? "dd/MM/yy" : "dd/MM/yyyy";
    }

    try {
      const parsedDate = dateFnsParse(normalizedDelim, dateFnsFormatStr, new Date());
      if (isNaN(parsedDate.getTime())) {
        throw new Error("Parsed date is invalid.");
      }
      return dateFnsFormat(parsedDate, "yyyy-MM-dd");
    } catch (err) {
      const parsed = new Date(cleanStr);
      if (!isNaN(parsed.getTime())) {
        const year = parsed.getFullYear();
        const month = String(parsed.getMonth() + 1).padStart(2, "0");
        const day = String(parsed.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
      }
      throw new Error(`Failed to parse date '${dateStr}' with format '${this.inferredDateFormat}'`);
    }
  }

  /**
   * Normalizes counterparty name for clean matching.
   * Lowercase, removes punctuation, collapses spaces, strips corporate suffixes at end of string.
   */
  normalizeCounterparty(textStr: string): string {
    if (!textStr) return "";

    let name = textStr.toLowerCase();

    // Replace punctuation with spaces to keep tokens separate (e.g. "Google, LLC" -> "google llc")
    name = name.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, " ");

    // Collapse spaces
    name = name.replace(/\s+/g, " ").trim();

    // Strip corporate suffix ONLY at the end of the string
    const suffixRegex = /\b(llc|ltd|inc|pvt|private\s+limited|corp|co|company|corporation)\b$/i;
    name = name.replace(suffixRegex, "").trim();

    return name;
  }

  /**
   * Standardizes debit/credit and amount strings, returning absolute value in minor units (paise/cents) and direction.
   */
  normalizeAmount(amountVal?: string, debitVal?: string, creditVal?: string): { amountMinor: bigint; direction: "inflow" | "outflow" } {
    const parseSingleVal = (valStr?: string): number => {
      if (!valStr) return 0;
      let clean = valStr.trim();
      if (!clean || clean === "-" || clean === "0") return 0;

      let isNegative = false;
      if (clean.startsWith("(") && clean.endsWith(")")) {
        isNegative = true;
        clean = clean.substring(1, clean.length - 1);
      }
      if (clean.startsWith("-")) {
        isNegative = true;
        clean = clean.substring(1);
      }
      clean = clean.replace(/[₹$€£\s]/g, "");

      const isUSorIN = this.accountLocale && (this.accountLocale.includes("US") || this.accountLocale.includes("IN"));
      const isEuropean = this.accountLocale && /^(de|fr|it|es|nl|pt|sv|pl|da|fi|nb|ru)/i.test(this.accountLocale);

      let parsedNum = 0;
      if (isUSorIN) {
        const normalized = clean.replace(/,/g, "");
        parsedNum = parseFloat(normalized) || 0;
      } else if (isEuropean) {
        const normalized = clean.replace(/\./g, "").replace(",", ".");
        parsedNum = parseFloat(normalized) || 0;
      } else {
        const lastPunc = clean.lastIndexOf(".");
        const lastComma = clean.lastIndexOf(",");

        if (lastComma > lastPunc) {
          const afterComma = clean.substring(lastComma + 1).replace(/[^0-9]/g, "");
          if (afterComma.length <= 2) {
            const normalized = clean.replace(/\./g, "").replace(",", ".");
            parsedNum = parseFloat(normalized) || 0;
          } else {
            const normalized = clean.replace(/,/g, "");
            parsedNum = parseFloat(normalized) || 0;
          }
        } else if (lastPunc > lastComma) {
          const afterDot = clean.substring(lastPunc + 1).replace(/[^0-9]/g, "");
          if (afterDot.length <= 2) {
            const normalized = clean.replace(/,/g, "");
            parsedNum = parseFloat(normalized) || 0;
          } else {
            const normalized = clean.replace(/\./g, "");
            parsedNum = parseFloat(normalized) || 0;
          }
        } else {
          parsedNum = parseFloat(clean) || 0;
        }
      }

      return isNegative ? -parsedNum : parsedNum;
    };

    if (debitVal || creditVal) {
      const debitValParsed = parseSingleVal(debitVal);
      const creditValParsed = parseSingleVal(creditVal);

      if (creditValParsed > 0 && debitValParsed === 0) {
        const amtMinor = BigInt(Math.round(creditValParsed * 100));
        return { amountMinor: amtMinor, direction: "inflow" };
      } else if (debitValParsed > 0 && creditValParsed === 0) {
        const amtMinor = BigInt(Math.round(debitValParsed * 100));
        return { amountMinor: amtMinor, direction: "outflow" };
      } else {
        const netChange = creditValParsed - debitValParsed;
        const absVal = Math.abs(netChange);
        const amtMinor = BigInt(Math.round(absVal * 100));
        return {
          amountMinor: amtMinor,
          direction: netChange >= 0 ? "inflow" : "outflow"
        };
      }
    }

    const singleAmt = parseSingleVal(amountVal);
    const absVal = Math.abs(singleAmt);
    const amtMinor = BigInt(Math.round(absVal * 100));
    return {
      amountMinor: amtMinor,
      direction: singleAmt >= 0 ? "inflow" : "outflow"
    };
  }

  /**
   * Resolves transaction currency using priority sequence:
   * Parsed Row Currency/Symbol -> Account Currency -> Org Currency -> default USD.
   */
  detectCurrency(valStr: string): string {
    if (!valStr) {
      if (this.accountCurrency) return this.accountCurrency;
      if (this.orgCurrency) return this.orgCurrency;
      return this.defaultCurrency;
    }

    const val = valStr.trim().toUpperCase();

    const isoMatch = val.match(/\b(USD|CAD|AUD|SGD|INR|EUR|GBP)\b/);
    if (isoMatch) {
      return isoMatch[1];
    }

    if (val.includes("₹") || val.includes("INR")) return "INR";
    if (val.includes("€") || val.includes("EUR")) return "EUR";
    if (val.includes("£") || val.includes("GBP")) return "GBP";

    if (val.includes("$")) {
      if (this.accountCurrency && ["USD", "CAD", "AUD", "SGD"].includes(this.accountCurrency)) {
        return this.accountCurrency;
      }
      if (this.orgCurrency && ["USD", "CAD", "AUD", "SGD"].includes(this.orgCurrency)) {
        return this.orgCurrency;
      }
      return "USD";
    }

    if (this.accountCurrency) return this.accountCurrency;
    if (this.orgCurrency) return this.orgCurrency;
    return this.defaultCurrency;
  }

  /**
   * Normalizes raw transaction types into: "PAYMENT" | "REFUND" | "FEE" | "PAYOUT" | "TRANSFER" | "INVOICE"
   */
  normalizeTransactionType(rawType: string, direction: "inflow" | "outflow"): string {
    if (!rawType) {
      return direction === "inflow" ? "PAYMENT" : "TRANSFER";
    }

    const cleanType = rawType.trim().toLowerCase();

    if (cleanType.includes("refund") || cleanType.includes("chargeback") || cleanType.includes("return")) {
      return "REFUND";
    }
    if (cleanType.includes("fee") || cleanType.includes("charge") || cleanType.includes("processing")) {
      return "FEE";
    }
    if (cleanType.includes("payout") || cleanType.includes("withdrawal") || cleanType.includes("settlement")) {
      return "PAYOUT";
    }
    if (cleanType.includes("transfer") || cleanType.includes("wire") || cleanType.includes("remit")) {
      return "TRANSFER";
    }
    if (cleanType.includes("invoice") || cleanType.includes("bill") || cleanType.includes("sale")) {
      return "INVOICE";
    }
    if (cleanType.includes("payment") || cleanType.includes("deposit") || cleanType.includes("credit")) {
      return "PAYMENT";
    }

    return direction === "inflow" ? "PAYMENT" : "TRANSFER";
  }

  /**
   * Parses Tally ledger entries from a serialized JSON string or array,
   * isolating the cash/bank ledger to determine the net transaction amount and direction.
   */
  parseTallyLedgerEntries(
    entriesJsonOrArray: any,
    partyLedgerName?: string
  ): { amountMinor: bigint; direction: "inflow" | "outflow" } {
    let entries: { ledgerName: string; amount: number; isDeemedPositive: boolean }[] = [];
    if (typeof entriesJsonOrArray === "string") {
      try {
        entries = JSON.parse(entriesJsonOrArray);
      } catch {
        entries = [];
      }
    } else if (Array.isArray(entriesJsonOrArray)) {
      entries = entriesJsonOrArray;
    }

    if (!Array.isArray(entries) || entries.length === 0) {
      return { amountMinor: BigInt(0), direction: "inflow" };
    }

    // 1. Filter entries to find those that are bank/cash.
    let bankEntries = entries.filter((e) =>
      /bank|cash|c\/a|current|savings|pos|paytm|pe\b/i.test(e.ledgerName)
    );

    // 2. If none, filter entries that do NOT match the party ledger name.
    if (bankEntries.length === 0 && partyLedgerName) {
      bankEntries = entries.filter(
        (e) => e.ledgerName.toLowerCase() !== partyLedgerName.toLowerCase()
      );
    }

    // 3. Fallback to all entries if still empty.
    if (bankEntries.length === 0) {
      bankEntries = entries;
    }

    // Sum the absolute amounts (converted to minor units: cents/paise)
    let totalAmtMinor = BigInt(0);
    let inflowCount = 0;
    let outflowCount = 0;

    for (const entry of bankEntries) {
      const absAmt = Math.abs(entry.amount);
      totalAmtMinor += BigInt(Math.round(absAmt * 100));
      if (entry.isDeemedPositive) {
        inflowCount++;
      } else {
        outflowCount++;
      }
    }

    // If more bank/cash entries are deemed positive (debit), it is an inflow
    const direction = inflowCount >= outflowCount ? "inflow" : "outflow";

    return {
      amountMinor: totalAmtMinor,
      direction,
    };
  }
}

