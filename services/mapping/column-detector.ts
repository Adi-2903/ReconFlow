import { layouts } from "./layouts";

export const NON_TRANSACTION_PATTERNS = [
  /page\s+\d+/i,
  /generated/i,
  /statement/i,
  /subtotal/i,
  /grand\s+total/i,
  /opening\s+balance/i,
  /closing\s+balance/i,
  /brought\s+forward/i,
  /carried\s+forward/i,
  /b\/f/i,
  /c\/f/i,
  /total/i,
  /---/
];

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
    direction: "",
    reference: "",
    counterparty: "",
  };

  const clean = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]/g, " ");

  const getScore = (header: string, type: keyof typeof result): number => {
    const h = clean(header);
    
    switch (type) {
      case "date":
        if (h === "date") return 100;
        if (/^(transaction|txn|booking|value|posting|post)[_ ]date$/i.test(h)) return 95;
        if (/date/i.test(h)) return 80;
        if (/^(time|txn|created|dt)$/i.test(h)) return 60;
        if (/time|txn|created/i.test(h)) return 40;
        return 0;

      case "description":
        if (/^(description|narration|particulars|memo|details)$/i.test(h)) return 100;
        if (/description|narration|particular|memo|details|remark/i.test(h)) return 80;
        if (/desc/i.test(h)) return 70;
        if (/customer|vendor|party/i.test(h)) return 20;
        return 0;

      case "direction":
        if (/^(direction|type|transaction[_ ]type|txn[_ ]type|dr[_ ]cr|dr\/cr|cr[_ ]dr|credit[_ ]debit|debit[_ ]credit)$/i.test(h)) return 100;
        if (/direction|txn[_ ]type|transaction[_ ]type/i.test(h)) return 80;
        if (/\b(type|dr|cr)\b/i.test(h)) return 40;
        return 0;

      case "debit": {
        let score = 0;
        if (/^(debit|withdrawal|outflow|payment|paid)$/i.test(h)) score = 100;
        else if (/debit|withdrawal|outflow|payment|paid/i.test(h)) score = 80;
        else if (/^dr$/i.test(h)) score = 60;
        else if (/\bdr\b/i.test(h)) score = 40;

        if (score > 0 && /method|mode|channel|\bref\b|\bid\b/i.test(h)) {
          score = Math.max(0, score - 80);
        }
        return score;
      }

      case "credit": {
        let score = 0;
        if (/^(credit|deposit|inflow|receipt|received)$/i.test(h)) score = 100;
        else if (/credit|deposit|inflow|receipt|received/i.test(h)) score = 80;
        else if (/^cr$/i.test(h)) score = 60;
        else if (/\bcr\b/i.test(h)) score = 40;

        if (score > 0 && /method|mode|channel|\bref\b|\bid\b/i.test(h)) {
          score = Math.max(0, score - 80);
        }
        return score;
      }

      case "amount": {
        let score = 0;
        if (/^(amount|net[_ ]amount|total[_ ]amount)$/i.test(h)) score = 100;
        else if (/amount|total|net/i.test(h)) score = 80;

        if (score > 0 && /debit|credit|withdrawal|deposit/i.test(h)) {
          score = Math.max(0, score - 80);
        }
        return score;
      }

      case "reference": {
        let score = 0;
        if (/^(reference|utr|ref|reference[_ ]number|ref[_ ]num|ref[_ ]no|cheque|chq|voucher|vch|cheque[_ ]no|chq[_ ]no)$/i.test(h)) score = 100;
        else if (/reference|utr|ref[_ ]no|ref[_ ]number|cheque|chq|voucher|vch/i.test(h)) score = 80;
        else if (/^ref/i.test(h)) score = 70;
        else if (/id|num|doc|vch/i.test(h)) {
          if (/transaction[_ ]id|bank[_ ]transaction[_ ]id|txn[_ ]id|row[_ ]id|^id$/i.test(h)) {
            score = 10;
          } else {
            score = 50;
          }
        }

        if (score > 0) {
          if (/type|category|status/i.test(h)) {
            score = Math.max(0, score - 60);
          }
          if (/\b(no|num|number|#)\b/i.test(h)) {
            score = Math.min(100, score + 15);
          }
        }
        return score;
      }

      case "counterparty":
        if (/^(counterparty|customer|vendor|party|customer[_ ]name|vendor[_ ]name|party[_ ]name)$/i.test(h)) return 100;
        if (/counterparty|customer|vendor|party/i.test(h)) return 80;
        if (/name/i.test(h)) return 60;
        return 0;

      default:
        return 0;
    }
  };

  const priorityOrder: (keyof typeof result)[] = [
    "date",
    "description",
    "debit",
    "credit",
    "amount",
    "direction",
    "reference",
    "counterparty",
  ];

  const assignedHeaders = new Set<string>();

  priorityOrder.forEach((key) => {
    let bestHeader = "";
    let maxScore = 0;

    headers.forEach((header) => {
      if (assignedHeaders.has(header)) return;
      const score = getScore(header, key);
      if (score > maxScore) {
        maxScore = score;
        bestHeader = header;
      }
    });

    if (maxScore > 0) {
      result[key] = bestHeader;
      assignedHeaders.add(bestHeader);
    }
  });

  if (result.debit && result.credit) {
    if (!result.amount) {
      result.amount = `${result.debit}/${result.credit}`;
    }
    result.direction = ""; // Clear direction for split debit/credit files so frontend shows split inputs
  }

  return result;
}

export function findHeaderRowIndex(rows: string[][]): { index: number; score: number } {
  let bestIndex = 0;
  let bestScore = 0;

  const rowsToScan = Math.min(rows.length, 50);

  for (let i = 0; i < rowsToScan; i++) {
    const row = rows[i];
    let score = 0;

    let dateMatched = false;
    let descMatched = false;
    let amountMatched = false;
    let debitMatched = false;
    let creditMatched = false;
    let directionMatched = false;
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
      if (!directionMatched && /direction|type|transaction[ _]type|txn[ _]type|dr[ _]cr|dr\/cr|cr[ _]dr|credit[ _]debit|debit[ _]credit/i.test(c)) {
        score += 0.20;
        directionMatched = true;
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
    console.log("INFERRED: YYYY-MM-DD");
    return "YYYY-MM-DD";
  }
  if (hasDayGreaterThan12) {
    console.log("INFERRED: DD/MM/YYYY");
    return "DD/MM/YYYY";
  }
  if (hasMonthGreaterThan12) {
    console.log("INFERRED: MM/DD/YYYY");
    return "MM/DD/YYYY";
  }

  if (locale && (locale.includes("US") || locale.includes("en-US"))) {
    console.log("INFERRED: MM/DD/YYYY from locale");
    return "MM/DD/YYYY";
  }
  console.log("INFERRED: DD/MM/YYYY fallback");
  return "DD/MM/YYYY";
}
