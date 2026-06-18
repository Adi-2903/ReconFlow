import { layouts } from "./layouts";

export function detectSourceLayout(headers: string[]): {
  layoutId: string;
  name: string;
  fileType: string;
  mapping: Record<string, string>;
  confidence: number;
} | null {
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const cleanedHeaders = headers.map(clean);

  for (const layout of layouts) {
    let allMatched = true;
    const mapping: Record<string, string> = {};

    for (const [key, value] of Object.entries(layout.mapping)) {
      if (!value) continue;
      const cleanedValue = clean(value);
      const index = cleanedHeaders.indexOf(cleanedValue);
      if (index !== -1) {
        mapping[key] = headers[index];
      } else {
        allMatched = false;
        break;
      }
    }

    if (allMatched) {
      return {
        layoutId: layout.id,
        name: layout.name,
        fileType: layout.fileType,
        mapping,
        confidence: 0.95,
      };
    }
  }

  return null;
}

export function detectColumns(headers: string[]): Record<string, string> {
  const matchedLayout = detectSourceLayout(headers);
  if (matchedLayout) {
    return matchedLayout.mapping;
  }

  const result: Record<string, string> = {
    date: "",
    description: "",
    amount: "",
    debit: "",
    credit: "",
    reference: "",
  };

  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, " ");

  const dateRegex = /date|time|txn|value|created/i;
  const descRegex = /desc|narrat|particular|memo|details/i;
  const amountRegex = /^amount|amount$|total|net/i;
  const debitRegex = /debit|withdrawal|outflow|payment|paid/i;
  const creditRegex = /credit|deposit|inflow|receipt|received/i;
  const refRegex = /ref|reference|id|doc|num|vch/i;

  headers.forEach((header) => {
    const h = clean(header);
    if (!result.date && dateRegex.test(h)) {
      result.date = header;
    } else if (!result.description && descRegex.test(h)) {
      result.description = header;
    } else if (debitRegex.test(h)) {
      result.debit = header;
    } else if (creditRegex.test(h)) {
      result.credit = header;
    } else if (!result.amount && amountRegex.test(h)) {
      result.amount = header;
    } else if (!result.reference && refRegex.test(h)) {
      result.reference = header;
    }
  });

  // If we found debit/credit, we don't necessarily need a single amount column
  if (result.debit && result.credit && !result.amount) {
    result.amount = `${result.debit}/${result.credit}`;
  }

  return result;
}

export function findHeaderRowIndex(rows: string[][]): { index: number; score: number } {
  let bestIndex = 0;
  let bestScore = 0;

  const rowsToScan = Math.min(rows.length, 10);

  for (let i = 0; i < rowsToScan; i++) {
    const row = rows[i];
    let score = 0;

    let dateMatched = false;
    let descMatched = false;
    let amountMatched = false;
    let debitMatched = false;
    let creditMatched = false;
    let refMatched = false;

    for (const cell of row) {
      const c = cell.trim().toLowerCase();
      if (!c) continue;

      if (!dateMatched && /date|time|txn\b|value\b|created|dt\b/i.test(c)) {
        score += 0.35;
        dateMatched = true;
      }
      if (!descMatched && /desc|narrat|particular|memo|details|description/i.test(c)) {
        score += 0.35;
        descMatched = true;
      }
      if (!amountMatched && /^amount\b|amount$|total|net|val\b/i.test(c)) {
        score += 0.30;
        amountMatched = true;
      }
      if (!debitMatched && /debit|withdrawal|outflow|payment|paid|dr\b/i.test(c)) {
        score += 0.25;
        debitMatched = true;
      }
      if (!creditMatched && /credit|deposit|inflow|receipt|received|cr\b/i.test(c)) {
        score += 0.25;
        creditMatched = true;
      }
      if (!refMatched && /ref|reference|id|doc|num|vch/i.test(c)) {
        score += 0.15;
        refMatched = true;
      }
    }

    const finalScore = Math.round(score * 100) / 100;

    if (finalScore > bestScore) {
      bestScore = finalScore;
      bestIndex = i;
    }
  }

  if (bestScore === 0) {
    return { index: 0, score: 0 };
  }

  return { index: bestIndex, score: bestScore };
}

export function inferDateFormat(dateStrings: string[], locale?: string): string {
  let hasDayGreaterThan12 = false;
  let hasMonthGreaterThan12 = false;
  let hasYearFirst = false;

  for (const dateStr of dateStrings) {
    if (!dateStr) continue;
    const cleanStr = dateStr.replace(/[-/.]/g, "-").trim();
    
    const yyyymmddMatch = cleanStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (yyyymmddMatch) {
      hasYearFirst = true;
      continue;
    }

    const segments = cleanStr.split("-").map(s => parseInt(s, 10));
    if (segments.length >= 3) {
      const first = segments[0];
      const second = segments[1];

      if (first > 12 && first <= 31) {
        hasDayGreaterThan12 = true;
      }
      if (second > 12 && second <= 31) {
        hasMonthGreaterThan12 = true;
      }
    }
  }

  if (hasYearFirst) {
    return "YYYY-MM-DD";
  }
  if (hasDayGreaterThan12) {
    return "DD/MM/YYYY";
  }
  if (hasMonthGreaterThan12) {
    return "MM/DD/YYYY";
  }

  if (locale && (locale.includes("US") || locale.includes("en-US"))) {
    return "MM/DD/YYYY";
  }
  return "DD/MM/YYYY";
}

