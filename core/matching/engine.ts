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
  confidenceScore: number;  // 0.0 to 1.0, 2 decimal places max
  matchType: "exact" | "fuzzy" | "bulk" | "none";
  scoringBreakdown: {
    amountScore: number;
    dateScore: number;
    textScore: number;
  };
}

// ── Scoring functions ─────────────────────────────────────────────────────────

export function scoreAmount(bankAmount: number, ledgerAmount: number): number {
  if (bankAmount === ledgerAmount) return 1.0;

  const diff = Math.abs(bankAmount - ledgerAmount);
  const larger = Math.max(bankAmount, ledgerAmount);

  // Hard reject: difference exceeds 20% of the larger amount
  if (diff / larger > 0.20) return 0;

  // Smooth exponential decay
  // At diff=0        → 1.0
  // At diff=₹500     → ~0.78
  // At diff=₹1,000   → ~0.61
  // At diff=₹2,000   → ~0.37
  return Math.exp(-diff / 120_000); // 120_000 paise = ₹1200 decay constant
}

export function scoreDate(bankDate: Date, ledgerDate: Date): number {
  const diffDays = Math.abs(differenceInDays(bankDate, ledgerDate));
  if (diffDays === 0) return 1.0;
  if (diffDays === 1) return 0.85;
  if (diffDays === 2) return 0.70;
  if (diffDays === 3) return 0.55;
  return 0; // More than 3 days → no contribution
}

export function scoreText(bankDesc: string, ledgerRef: string): number {
  const normalize = (s: string) =>
    s.toLowerCase().split(/\W+/).filter((token) => token.length > 2);

  const bankTokens = new Set(normalize(bankDesc));
  const ledgerTokens = new Set(normalize(ledgerRef));

  // Strong signal: shared numeric sequence (invoice/reference number match)
  const bankNums = new Set((bankDesc.match(/\d{4,}/g) || []));
  const ledgerNums = new Set((ledgerRef.match(/\d{4,}/g) || []));
  const numericOverlap = [...bankNums].some((n) => ledgerNums.has(n));
  if (numericOverlap) return 0.92;

  // Jaccard similarity on word tokens
  const intersection = new Set([...bankTokens].filter((t) => ledgerTokens.has(t)));
  const union = new Set([...bankTokens, ...ledgerTokens]);

  if (union.size === 0) return 0.10; // Both empty → low but not zero

  return Math.round((intersection.size / union.size) * 100) / 100;
}

// ── Utility ───────────────────────────────────────────────────────────────────

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

// ── Main engine ───────────────────────────────────────────────────────────────

export function matchTransactions(
  banks: BankTransaction[],
  ledgers: LedgerEntry[]
): MatchResult[] {
  const results: MatchResult[] = [];
  const claimedBankIds = new Set<string>();
  const claimedLedgerIds = new Set<string>();

  // ── Pass 1: Exact match ───────────────────────────────────────────────────
  // Finds the BEST exact candidate (not just the first), so duplicate-amount
  // invoices are disambiguated by text similarity.
  for (const bank of banks) {
    if (claimedBankIds.has(bank.id)) continue;

    const combinedBankDesc = `${bank.description} ${bank.referenceId}`;

    let bestLedgerId: string | null = null;
    let bestTextScore = -1;
    let bestDateScore = 0;

    for (const ledger of ledgers) {
      if (claimedLedgerIds.has(ledger.id)) continue;

      const sAmt = scoreAmount(bank.amount, ledger.amount);
      const sDate = scoreDate(bank.date, ledger.date);

      // Exact pass: amount must be identical, date within 1 day
      if (sAmt !== 1.0 || sDate < 0.85) continue;

      const combinedLedgerRef = `${ledger.memo} ${ledger.invoiceRef}`;
      const sText = scoreText(combinedBankDesc, combinedLedgerRef);

      // FIX: pick the candidate with the highest text score, not just the first
      if (sText > bestTextScore) {
        bestTextScore = sText;
        bestDateScore = sDate;
        bestLedgerId = ledger.id;
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
          dateScore: bestDateScore,
          textScore: bestTextScore,
        },
      });
      claimedBankIds.add(bank.id);
      claimedLedgerIds.add(bestLedgerId);
    }
  }

  // ── Pass 2: Bulk match (subset-sum) ──────────────────────────────────────
  for (const bank of banks) {
    if (claimedBankIds.has(bank.id)) continue;

    // Candidate ledgers: unclaimed and within a 5-day window of the bank date
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

    const combinedBankDesc = `${bank.description} ${bank.referenceId}`;

    for (const combo of combos) {
      const sumAmount = combo.reduce((s, l) => s + l.amount, 0);
      const sAmt = scoreAmount(bank.amount, sumAmount);
      if (sAmt === 0) continue; // Outside 20% tolerance → skip immediately

      const sDate =
        combo.reduce((acc, l) => acc + scoreDate(bank.date, l.date), 0) /
        combo.length;

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
        bestBreakdown = { amountScore: sAmt, dateScore: sDate, textScore: sText };
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

  // ── Pass 3: Fuzzy match ───────────────────────────────────────────────────
  for (const bank of banks) {
    if (claimedBankIds.has(bank.id)) continue;

    const combinedBankDesc = `${bank.description} ${bank.referenceId}`;

    let bestLedgerId: string | null = null;
    let bestConfidence = 0;
    let bestBreakdown = { amountScore: 0, dateScore: 0, textScore: 0 };

    for (const ledger of ledgers) {
      if (claimedLedgerIds.has(ledger.id)) continue;

      const sAmt = scoreAmount(bank.amount, ledger.amount);

      // FIX: hard gate — if amounts are completely unrelated, skip.
      // Prevents a transaction matching purely on date+text with no amount signal.
      if (sAmt === 0) continue;

      const sDate = scoreDate(bank.date, ledger.date);
      const combinedLedgerRef = `${ledger.memo} ${ledger.invoiceRef}`;
      const sText = scoreText(combinedBankDesc, combinedLedgerRef);

      const confidence = sAmt * 0.5 + sDate * 0.3 + sText * 0.2;

      // Minimum confidence threshold: 0.60
      if (confidence >= 0.60 && confidence > bestConfidence) {
        bestConfidence = confidence;
        bestLedgerId = ledger.id;
        bestBreakdown = { amountScore: sAmt, dateScore: sDate, textScore: sText };
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

  // ── Pass 4: Unmatched / Exceptions ───────────────────────────────────────
  for (const bank of banks) {
    if (!claimedBankIds.has(bank.id)) {
      results.push({
        bankTransactionId: bank.id,
        ledgerEntryIds: [],
        confidenceScore: 0,
        matchType: "none",
        scoringBreakdown: { amountScore: 0, dateScore: 0, textScore: 0 },
      });
    }
  }

  // ── Sort for dashboard ────────────────────────────────────────────────────
  // FIX: High confidence first, exceptions last.
  // Original code had this inverted (ascending confidence, none first).
  const typeOrder: Record<MatchResult["matchType"], number> = {
    exact: 0,
    bulk: 1,
    fuzzy: 2,
    none: 3,
  };

  results.sort((a, b) => {
    const typeDiff = typeOrder[a.matchType] - typeOrder[b.matchType];
    if (typeDiff !== 0) return typeDiff;
    return b.confidenceScore - a.confidenceScore; // descending within type
  });

  return results;
}