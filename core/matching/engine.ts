import { differenceInDays } from "date-fns";

export interface BankTransaction {
  id: string;
  amount: number; // in paise (integer, no decimals)
  date: Date;
  description: string;
  referenceId: string;
}

export interface LedgerEntry {
  id: string;
  amount: number; // in paise
  date: Date;
  memo: string;
  invoiceRef: string;
}

export interface MatchResult {
  bankTransactionId: string;
  ledgerEntryIds: string[]; // array supports bulk matches
  confidenceScore: number; // 0.0 to 1.0, 2 decimal places max
  matchType: "exact" | "fuzzy" | "bulk" | "none";
  scoringBreakdown: {
    amountScore: number;
    dateScore: number;
    textScore: number;
  };
}

// FIXED: scoreAmount discontinuity at 50000 paise inverted logic [2026-06-12]
export function scoreAmount(bankAmount: number, ledgerAmount: number): number {
  if (bankAmount === ledgerAmount) return 1.0

  const diff = Math.abs(bankAmount - ledgerAmount)
  const larger = Math.max(bankAmount, ledgerAmount)

  // Reject if difference exceeds 20% of the larger amount
  if (diff / larger > 0.20) return 0

  // Single smooth decay curve — no discontinuity
  // At diff=0: score=1.0
  // At diff=50000 paise (₹500): score≈0.78
  // At diff=100000 paise (₹1000): score≈0.61
  // At diff=200000 paise (₹2000): score≈0.37
  return Math.exp(-diff / 120000)
}

export function scoreDate(bankDate: Date, ledgerDate: Date): number {
  const diffDays = Math.abs(differenceInDays(bankDate, ledgerDate));
  if (diffDays === 0) return 1.0;
  if (diffDays === 1) return 0.85;
  if (diffDays === 2) return 0.70;
  if (diffDays === 3) return 0.55;
  return 0; // More than 3 days
}

// FIXED: scoreText floor of 0.5 artificially inflates unrelated strings [2026-06-12]
export function scoreText(bankDesc: string, ledgerRef: string): number {
  const normalize = (s: string) =>
    s.toLowerCase().split(/\W+/).filter(token => token.length > 2)

  const bankTokens = new Set(normalize(bankDesc))
  const ledgerTokens = new Set(normalize(ledgerRef))

  // Extract numeric sequences (invoice numbers, reference IDs)
  const bankNums = new Set((bankDesc.match(/\d{4,}/g) || []))
  const ledgerNums = new Set((ledgerRef.match(/\d{4,}/g) || []))

  // Strong signal: shared numeric sequence (invoice number match)
  const numericOverlap = [...bankNums].some(n => ledgerNums.has(n))
  if (numericOverlap) return 0.92

  // Jaccard similarity on word tokens
  const intersection = new Set([...bankTokens].filter(t => ledgerTokens.has(t)))
  const union = new Set([...bankTokens, ...ledgerTokens])

  if (union.size === 0) return 0.10  // Both empty strings — low but not zero

  const jaccard = intersection.size / union.size

  // NO floor — return actual similarity
  // Completely unrelated strings will return 0.0–0.15
  // Partially related will return 0.15–0.60
  // Strong text match will return 0.60–0.92
  return Math.round(jaccard * 100) / 100
}

const getCombinations = <T>(arr: T[], maxSize: number): T[][] => {
  const result: T[][] = [];
  const f = (start: number, combo: T[]) => {
    if (combo.length >= 2 && combo.length <= maxSize) {
      result.push([...combo]);
    }
    if (combo.length >= maxSize) return;
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      f(i + 1, combo);
      combo.pop();
    }
  };
  f(0, []);
  return result;
};

export function matchTransactions(
  banks: BankTransaction[],
  ledgers: LedgerEntry[]
): MatchResult[] {
  const results: MatchResult[] = [];
  const claimedBankIds = new Set<string>();
  const claimedLedgerIds = new Set<string>();

  // Pass 1 - Exact match
  for (const bank of banks) {
    if (claimedBankIds.has(bank.id)) continue;

    let bestLedgerId: string | null = null;
    let bestLedgerTextScore = 0;
    let bestLedgerDateScore = 0;

    for (const ledger of ledgers) {
      if (claimedLedgerIds.has(ledger.id)) continue;

      const sAmt = scoreAmount(bank.amount, ledger.amount);
      const sDate = scoreDate(bank.date, ledger.date);

      if (sAmt === 1.0 && sDate >= 0.85) {
        bestLedgerId = ledger.id;
        bestLedgerDateScore = sDate;
        // Text property might be combined between memo and invoiceRef depending on how it's matched
        const combinedLedgerRef = `${ledger.memo} ${ledger.invoiceRef}`;
        const combinedBankDesc = `${bank.description} ${bank.referenceId}`;
        bestLedgerTextScore = scoreText(combinedBankDesc, combinedLedgerRef);
        break; // found match, break to assign
      }
    }

    if (bestLedgerId) {
      results.push({
        bankTransactionId: bank.id,
        ledgerEntryIds: [bestLedgerId],
        confidenceScore: 1.0,
        matchType: "exact",
        scoringBreakdown: {
          amountScore: 1.0,
          dateScore: bestLedgerDateScore,
          textScore: bestLedgerTextScore,
        },
      });
      claimedBankIds.add(bank.id);
      claimedLedgerIds.add(bestLedgerId);
    }
  }

  // Pass 2 - Bulk match (subset-sum)
  for (const bank of banks) {
    if (claimedBankIds.has(bank.id)) continue;

    const candidateLedgers = ledgers.filter(
      (l) =>
        !claimedLedgerIds.has(l.id) &&
        Math.abs(differenceInDays(bank.date, l.date)) <= 5
    );

    if (candidateLedgers.length < 2) continue;

    const combos = getCombinations(candidateLedgers, 4);

    let bestCombo: LedgerEntry[] | null = null;
    let bestConfidence = 0;
    let bestBreakdown = { amountScore: 0, dateScore: 0, textScore: 0 };

    for (const combo of combos) {
      const sumAmount = combo.reduce((s, l) => s + l.amount, 0);
      const diff = Math.abs(sumAmount - bank.amount);

      if (diff <= 50000) {
        const sAmt = scoreAmount(bank.amount, sumAmount);
        const sDate =
          combo.reduce((acc, l) => acc + scoreDate(bank.date, l.date), 0) /
          combo.length;

        const combinedBankDesc = `${bank.description} ${bank.referenceId}`;
        const sText =
          combo.reduce(
            (acc, l) =>
              acc + scoreText(combinedBankDesc, `${l.memo} ${l.invoiceRef}`),
            0
          ) / combo.length;

        const confidence = sAmt * 0.5 + sDate * 0.3 + sText * 0.2;

        if (confidence > bestConfidence) {
          bestConfidence = confidence;
          bestCombo = combo;
          bestBreakdown = {
            amountScore: sAmt,
            dateScore: sDate,
            textScore: sText,
          };
        }
      }
    }

    if (bestCombo) {
      results.push({
        bankTransactionId: bank.id,
        ledgerEntryIds: bestCombo.map((c) => c.id),
        confidenceScore: parseFloat(bestConfidence.toFixed(2)),
        matchType: "bulk",
        scoringBreakdown: bestBreakdown,
      });
      claimedBankIds.add(bank.id);
      bestCombo.forEach((c) => claimedLedgerIds.add(c.id));
    }
  }

  // Pass 3 - Fuzzy match
  for (const bank of banks) {
    if (claimedBankIds.has(bank.id)) continue;

    let bestLedgerId: string | null = null;
    let bestConfidence = 0;
    let bestBreakdown = { amountScore: 0, dateScore: 0, textScore: 0 };

    for (const ledger of ledgers) {
      if (claimedLedgerIds.has(ledger.id)) continue;

      const sAmt = scoreAmount(bank.amount, ledger.amount);
      const sDate = scoreDate(bank.date, ledger.date);

      const combinedBankDesc = `${bank.description} ${bank.referenceId}`;
      const combinedLedgerRef = `${ledger.memo} ${ledger.invoiceRef}`;
      const sText = scoreText(combinedBankDesc, combinedLedgerRef);

      const confidence = sAmt * 0.5 + sDate * 0.3 + sText * 0.2;

      if (confidence >= 0.6 && confidence > bestConfidence) {
        bestConfidence = confidence;
        bestLedgerId = ledger.id;
        bestBreakdown = {
          amountScore: sAmt,
          dateScore: sDate,
          textScore: sText,
        };
      }
    }

    if (bestLedgerId) {
      results.push({
        bankTransactionId: bank.id,
        ledgerEntryIds: [bestLedgerId],
        confidenceScore: parseFloat(bestConfidence.toFixed(2)),
        matchType: "fuzzy",
        scoringBreakdown: bestBreakdown,
      });
      claimedBankIds.add(bank.id);
      claimedLedgerIds.add(bestLedgerId);
    }
  }

  // Pass 4 - Unmatched
  for (const bank of banks) {
    if (!claimedBankIds.has(bank.id)) {
      results.push({
        bankTransactionId: bank.id,
        ledgerEntryIds: [],
        confidenceScore: 0,
        matchType: "none",
        scoringBreakdown: {
          amountScore: 0,
          dateScore: 0,
          textScore: 0,
        },
      });
    }
  }

  // Sort results
  results.sort((a, b) => {
    if (a.matchType === "none" && b.matchType !== "none") return -1;
    if (b.matchType === "none" && a.matchType !== "none") return 1;
    return a.confidenceScore - b.confidenceScore;
  });

  return results;
}
