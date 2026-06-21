// TestingFolder/matching/runMatcher.ts

import { Match, MatchType } from "../types/Match";
import { CanonicalTransaction } from "../types/CanonicalTransaction";
import { generateCandidates } from "./candidateGenerator";
import { CandidateReason, ConfidenceBand, CandidateReasonType, CandidateResult } from "../types/CandidateResult";
import { daysBetween, referenceMatches, nameMatches, directionMatches } from "./utils";

function getEffectiveAmountMinor(txn: CanonicalTransaction): bigint {
    const amt = txn.convertedAmountMinor !== undefined && txn.convertedAmountMinor !== null
        ? txn.convertedAmountMinor
        : txn.amountMinor;
    if (amt !== undefined && amt !== null) {
        return amt;
    }
    return BigInt(Math.round(txn.amount * 100));
}

function getCounterpartySimilarity(a?: string, b?: string): number {
    if (!a || !b) return 0;
    const normalize = (s: string) =>
        s.toLowerCase().split(/\W+/).filter((token) => token.length > 2);

    const setA = new Set(normalize(a));
    const setB = new Set(normalize(b));

    const intersection = new Set([...setA].filter((x) => setB.has(x)));
    const union = new Set([...setA, ...setB]);

    if (union.size === 0) return 0;
    return intersection.size / union.size;
}

function getCombinations<T>(arr: T[], minSize: number, maxSize: number): T[][] {
    const result: T[][] = [];
    const f = (start: number, combo: T[]) => {
        if (combo.length >= minSize && combo.length <= maxSize) {
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
}

function getConfidenceBand(score: number): ConfidenceBand | "NONE" {
    if (score >= 150) return "VERY_HIGH";
    if (score >= 100) return "HIGH";
    if (score >= 60) return "MEDIUM";
    if (score > 0) return "LOW";
    return "NONE";
}

function matchesProcessorFee(bankAmtMinor: bigint, bookAmtMinor: bigint): boolean {
    const diff = bookAmtMinor - bankAmtMinor;
    if (diff <= 0n) return false;
    
    // Check if difference matches typical Razorpay / Stripe fees:
    // 1.18%, 2.36%, 3.776%, 4.72%, 2.9%, 2%, 3%
    const commonRates = [0.0118, 0.0236, 0.03776, 0.0472, 0.029, 0.02, 0.03];
    for (const rate of commonRates) {
        const expectedFee = Math.round(Number(bookAmtMinor) * rate);
        if (Math.abs(Number(diff) - expectedFee) <= 100) { // allow 1 INR/USD rounding
            return true;
        }
    }
    // Stripe standard USD payout: 2.9% + $0.30 (30 cents = 3000 paise equivalent)
    const expectedStripeUSD = Math.round(Number(bookAmtMinor) * 0.029) + 3000;
    if (Math.abs(Number(diff) - expectedStripeUSD) <= 100) {
        return true;
    }
    return false;
}

interface TransactionState {
    id: string;
    txn: CanonicalTransaction;
    status: "UNMATCHED" | "PARTIALLY_MATCHED" | "MATCHED";
    matchedAmountMinor: bigint;
    remainingAmountMinor: bigint;
}

export function runMatcher(
    bankTxns: CanonicalTransaction[],
    bookTxns: CanonicalTransaction[]
): Match[] {
    const matches: Match[] = [];

    // State initialization
    const bankStates = new Map<string, TransactionState>();
    for (const b of bankTxns) {
        const amt = getEffectiveAmountMinor(b);
        bankStates.set(b.id, {
            id: b.id,
            txn: b,
            status: "UNMATCHED",
            matchedAmountMinor: 0n,
            remainingAmountMinor: amt
        });
    }

    const bookStates = new Map<string, TransactionState>();
    for (const b of bookTxns) {
        const amt = getEffectiveAmountMinor(b);
        bookStates.set(b.id, {
            id: b.id,
            txn: b,
            status: "UNMATCHED",
            matchedAmountMinor: 0n,
            remainingAmountMinor: amt
        });
    }

    // Helpers to get unmatched / partially matched transactions
    const getAvailableBooks = () =>
        Array.from(bookStates.values())
            .filter((state) => state.status !== "MATCHED")
            .map((state) => state.txn);

    const getAvailableBanks = () =>
        Array.from(bankStates.values())
            .filter((state) => state.status !== "MATCHED")
            .map((state) => state.txn);

    // ==========================================
    // PASS 1: EXACT MATCH (Layer 6A)
    // ==========================================
    for (const bankState of bankStates.values()) {
        if (bankState.status === "MATCHED") continue;

        const bankTxn = bankState.txn;
        const candidates = generateCandidates(bankTxn, getAvailableBooks());
        const exactMatches: { candidate: CandidateResult; score: number }[] = [];

        for (const cand of candidates) {
            const bookState = bookStates.get(cand.candidate.id)!;
            if (bookState.status === "MATCHED") continue;

            const bankAmt = bankState.remainingAmountMinor;
            const bookAmt = bookState.remainingAmountMinor;
            const dayDiff = daysBetween(bankTxn.transactionDate, cand.candidate.transactionDate);
            const refMatch = referenceMatches(bankTxn.referenceNumber, cand.candidate.referenceNumber);

            // Exact rules: Same amount, Same reference (or ref matches/normalized match), date within 1 day
            if (bankAmt === bookAmt && dayDiff <= 1.0 && refMatch) {
                const finalScore = cand.score + 50;
                exactMatches.push({ candidate: cand, score: finalScore });
            }
        }

        if (exactMatches.length > 0) {
            // Sort by tie-breaker: candidate score, date proximity, text similarity, stable sorting
            exactMatches.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                const dateDiffA = daysBetween(bankTxn.transactionDate, a.candidate.candidate.transactionDate);
                const dateDiffB = daysBetween(bankTxn.transactionDate, b.candidate.candidate.transactionDate);
                if (dateDiffA !== dateDiffB) return dateDiffA - dateDiffB;
                return a.candidate.candidate.id.localeCompare(b.candidate.candidate.id);
            });

            const best = exactMatches[0].candidate;
            const bookState = bookStates.get(best.candidate.id)!;

            bankState.status = "MATCHED";
            bankState.matchedAmountMinor = bankState.remainingAmountMinor;
            bankState.remainingAmountMinor = 0n;

            bookState.status = "MATCHED";
            bookState.matchedAmountMinor = bookState.remainingAmountMinor;
            bookState.remainingAmountMinor = 0n;

            const baseReasons = best.reasons.map((r) => ({ ...r }));
            baseReasons.push({ reason: "exact_match_validated" as CandidateReasonType, points: 50 });
            const finalScore = exactMatches[0].score;

            matches.push({
                bankTransactionIds: [bankTxn.id],
                bookTransactionIds: [best.candidate.id],
                score: finalScore,
                confidenceBand: getConfidenceBand(finalScore),
                matchType: "exact",
                reasons: baseReasons
            });
        }
    }

    // ==========================================
    // PASS 2: PROCESSOR FEE MATCH (Layer 6E)
    // ==========================================
    for (const bankState of bankStates.values()) {
        if (bankState.status === "MATCHED") continue;

        const bankTxn = bankState.txn;
        // Search candidates with skipped amount gate to retrieve potential fee discrepancies
        const candidates = generateCandidates(bankTxn, getAvailableBooks(), { skipAmountGate: true });
        const feeMatches: { candidate: CandidateResult; score: number }[] = [];

        for (const cand of candidates) {
            const bookState = bookStates.get(cand.candidate.id)!;
            if (bookState.status === "MATCHED") continue;

            const bankAmt = bankState.remainingAmountMinor;
            const bookAmt = bookState.remainingAmountMinor;
            const dayDiff = daysBetween(bankTxn.transactionDate, cand.candidate.transactionDate);
            const refMatch = referenceMatches(bankTxn.referenceNumber, cand.candidate.referenceNumber);
            const nameMatch = nameMatches(bankTxn.counterparty, cand.candidate.counterparty);

            if (dayDiff <= 7.0 && (refMatch || nameMatch)) {
                if (matchesProcessorFee(bankAmt, bookAmt)) {
                    const finalScore = cand.score + 20;
                    feeMatches.push({ candidate: cand, score: finalScore });
                }
            }
        }

        if (feeMatches.length > 0) {
            feeMatches.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                const dateDiffA = daysBetween(bankTxn.transactionDate, a.candidate.candidate.transactionDate);
                const dateDiffB = daysBetween(bankTxn.transactionDate, b.candidate.candidate.transactionDate);
                if (dateDiffA !== dateDiffB) return dateDiffA - dateDiffB;
                return a.candidate.candidate.id.localeCompare(b.candidate.candidate.id);
            });

            const best = feeMatches[0].candidate;
            const bookState = bookStates.get(best.candidate.id)!;

            bankState.status = "MATCHED";
            bankState.matchedAmountMinor = bankState.remainingAmountMinor;
            bankState.remainingAmountMinor = 0n;

            bookState.status = "MATCHED";
            bookState.matchedAmountMinor = bookState.remainingAmountMinor;
            bookState.remainingAmountMinor = 0n;

            const baseReasons = best.reasons.map((r) => ({ ...r }));
            baseReasons.push({ reason: "fee_match_validated" as CandidateReasonType, points: 20 });
            const finalScore = feeMatches[0].score;

            matches.push({
                bankTransactionIds: [bankTxn.id],
                bookTransactionIds: [best.candidate.id],
                score: finalScore,
                confidenceBand: getConfidenceBand(finalScore),
                matchType: "fee_adjustment",
                reasons: baseReasons
            });
        }
    }

    // ==========================================
    // PASS 3: SUBSET MATCH (Layer 6C)
    // ==========================================
    // Pass 3A: One-to-Many (1 Bank to N Books)
    for (const bankState of bankStates.values()) {
        if (bankState.status === "MATCHED") continue;

        const bankTxn = bankState.txn;
        const bankAmt = bankState.remainingAmountMinor;

        // Find candidate books: date window <= 5, same direction, similarity >= 0.4
        const bookCandidates = Array.from(bookStates.values())
            .filter((bs) => {
                if (bs.status === "MATCHED") return false;
                const dayDiff = daysBetween(bankTxn.transactionDate, bs.txn.transactionDate);
                if (dayDiff > 5.0) return false;
                if (!directionMatches(bankTxn, bs.txn)) return false;
                
                const sim = getCounterpartySimilarity(bankTxn.counterparty, bs.txn.counterparty);
                const hasRefOverlap = referenceMatches(bankTxn.referenceNumber, bs.txn.referenceNumber) ||
                    (bankTxn.description && bs.txn.description && getCounterpartySimilarity(bankTxn.description, bs.txn.description) >= 0.4);
                return sim >= 0.4 || hasRefOverlap;
            });

        if (bookCandidates.length >= 2) {
            // Sort by score or date similarity and take top 10
            bookCandidates.sort((a, b) => {
                const dateDiffA = daysBetween(bankTxn.transactionDate, a.txn.transactionDate);
                const dateDiffB = daysBetween(bankTxn.transactionDate, b.txn.transactionDate);
                return dateDiffA - dateDiffB;
            });
            const topCandidates = bookCandidates.slice(0, 10);

            // Generate combinations of size 2 to 4 (since 1 bank + up to 4 books = group size <= 5)
            const combos = getCombinations(topCandidates, 2, 4);
            const validCombos: { combo: TransactionState[]; score: number }[] = [];

            for (const combo of combos) {
                const sumAmt = combo.reduce((sum, bs) => sum + bs.remainingAmountMinor, 0n);
                // Allow a small rounding difference of <= 100 paise/cents
                const diff = sumAmt > bankAmt ? sumAmt - bankAmt : bankAmt - sumAmt;
                if (diff <= 100n) {
                    // Score = max(candidate generator base scores) + 15 validation bonus
                    const baseScores = combo.map((bs) => {
                        const candidatesResult = generateCandidates(bankTxn, [bs.txn], { skipAmountGate: true });
                        return candidatesResult.length > 0 ? candidatesResult[0].score : 50;
                    });
                    const finalScore = Math.max(...baseScores) + 15;
                    validCombos.push({ combo, score: finalScore });
                }
            }

            if (validCombos.length > 0) {
                // Resolve ambiguity/tie-breakers
                validCombos.sort((a, b) => {
                    if (b.score !== a.score) return b.score - a.score;
                    // Proximity spread: min range to max range of dates
                    const spreadA = Math.max(...a.combo.map((c) => c.txn.transactionDate.getTime())) - Math.min(...a.combo.map((c) => c.txn.transactionDate.getTime()));
                    const spreadB = Math.max(...b.combo.map((c) => c.txn.transactionDate.getTime())) - Math.min(...b.combo.map((c) => c.txn.transactionDate.getTime()));
                    if (spreadA !== spreadB) return spreadA - spreadB;
                    // Stable ordering
                    const idsA = a.combo.map((c) => c.id).sort().join(",");
                    const idsB = b.combo.map((c) => c.id).sort().join(",");
                    return idsA.localeCompare(idsB);
                });

                const bestCombo = validCombos[0].combo;

                bankState.status = "MATCHED";
                bankState.matchedAmountMinor = bankAmt;
                bankState.remainingAmountMinor = 0n;

                for (const bs of bestCombo) {
                    bs.status = "MATCHED";
                    bs.matchedAmountMinor = bs.remainingAmountMinor;
                    bs.remainingAmountMinor = 0n;
                }

                const finalScore = validCombos[0].score;
                matches.push({
                    bankTransactionIds: [bankTxn.id],
                    bookTransactionIds: bestCombo.map((bs) => bs.id),
                    score: finalScore,
                    confidenceBand: getConfidenceBand(finalScore),
                    matchType: "one_to_many",
                    reasons: [{ reason: "subset_match_validated" as CandidateReasonType, points: 15 }]
                });
            }
        }
    }

    // Pass 3B: Many-to-One (N Banks to 1 Book)
    for (const bookState of bookStates.values()) {
        if (bookState.status === "MATCHED") continue;

        const bookTxn = bookState.txn;
        const bookAmt = bookState.remainingAmountMinor;

        // Find candidate banks: date window <= 5, same direction, similarity >= 0.4
        const bankCandidates = Array.from(bankStates.values())
            .filter((bs) => {
                if (bs.status === "MATCHED") return false;
                const dayDiff = daysBetween(bookTxn.transactionDate, bs.txn.transactionDate);
                if (dayDiff > 5.0) return false;
                if (!directionMatches(bookTxn, bs.txn)) return false;

                const sim = getCounterpartySimilarity(bookTxn.counterparty, bs.txn.counterparty);
                const hasRefOverlap = referenceMatches(bookTxn.referenceNumber, bs.txn.referenceNumber) ||
                    (bookTxn.description && bs.txn.description && getCounterpartySimilarity(bookTxn.description, bs.txn.description) >= 0.4);
                return sim >= 0.4 || hasRefOverlap;
            });

        if (bankCandidates.length >= 2) {
            bankCandidates.sort((a, b) => {
                const dateDiffA = daysBetween(bookTxn.transactionDate, a.txn.transactionDate);
                const dateDiffB = daysBetween(bookTxn.transactionDate, b.txn.transactionDate);
                return dateDiffA - dateDiffB;
            });
            const topCandidates = bankCandidates.slice(0, 10);

            const combos = getCombinations(topCandidates, 2, 4);
            const validCombos: { combo: TransactionState[]; score: number }[] = [];

            for (const combo of combos) {
                const sumAmt = combo.reduce((sum, bs) => sum + bs.remainingAmountMinor, 0n);
                const diff = sumAmt > bookAmt ? sumAmt - bookAmt : bookAmt - sumAmt;
                if (diff <= 100n) {
                    const baseScores = combo.map((bs) => {
                        const candidatesResult = generateCandidates(bs.txn, [bookTxn], { skipAmountGate: true });
                        return candidatesResult.length > 0 ? candidatesResult[0].score : 50;
                    });
                    const finalScore = Math.max(...baseScores) + 15;
                    validCombos.push({ combo, score: finalScore });
                }
            }

            if (validCombos.length > 0) {
                validCombos.sort((a, b) => {
                    if (b.score !== a.score) return b.score - a.score;
                    const spreadA = Math.max(...a.combo.map((c) => c.txn.transactionDate.getTime())) - Math.min(...a.combo.map((c) => c.txn.transactionDate.getTime()));
                    const spreadB = Math.max(...b.combo.map((c) => c.txn.transactionDate.getTime())) - Math.min(...b.combo.map((c) => c.txn.transactionDate.getTime()));
                    if (spreadA !== spreadB) return spreadA - spreadB;
                    const idsA = a.combo.map((c) => c.id).sort().join(",");
                    const idsB = b.combo.map((c) => c.id).sort().join(",");
                    return idsA.localeCompare(idsB);
                });

                const bestCombo = validCombos[0].combo;

                bookState.status = "MATCHED";
                bookState.matchedAmountMinor = bookAmt;
                bookState.remainingAmountMinor = 0n;

                for (const bs of bestCombo) {
                    bs.status = "MATCHED";
                    bs.matchedAmountMinor = bs.remainingAmountMinor;
                    bs.remainingAmountMinor = 0n;
                }

                const finalScore = validCombos[0].score;
                matches.push({
                    bankTransactionIds: bestCombo.map((bs) => bs.id),
                    bookTransactionIds: [bookTxn.id],
                    score: finalScore,
                    confidenceBand: getConfidenceBand(finalScore),
                    matchType: "many_to_one",
                    reasons: [{ reason: "subset_match_validated" as CandidateReasonType, points: 15 }]
                });
            }
        }
    }

    // ==========================================
    // PASS 4: PARTIAL PAYMENT (Layer 6D)
    // ==========================================
    for (const bankState of bankStates.values()) {
        if (bankState.status === "MATCHED") continue;

        const bankTxn = bankState.txn;
        const bankAmt = bankState.remainingAmountMinor;

        // Candidate search with skipAmountGate
        const candidates = generateCandidates(bankTxn, getAvailableBooks(), { skipAmountGate: true });
        const partialMatches: { candidate: CandidateResult; score: number }[] = [];

        for (const cand of candidates) {
            const bookState = bookStates.get(cand.candidate.id)!;
            // Invoice (book entry) must be unmatched or partially matched
            if (bookState.status === "MATCHED") continue;

            const refMatch = referenceMatches(bankTxn.referenceNumber, cand.candidate.referenceNumber);
            const isPartialAmountValid = bankAmt <= bookState.remainingAmountMinor;

            // Strict remaining balance validation: payment cannot exceed remaining amount.
            if (refMatch && isPartialAmountValid) {
                const finalScore = cand.score + 5;
                partialMatches.push({ candidate: cand, score: finalScore });
            }
        }

        if (partialMatches.length > 0) {
            partialMatches.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                const dateDiffA = daysBetween(bankTxn.transactionDate, a.candidate.candidate.transactionDate);
                const dateDiffB = daysBetween(bankTxn.transactionDate, b.candidate.candidate.transactionDate);
                if (dateDiffA !== dateDiffB) return dateDiffA - dateDiffB;
                return a.candidate.candidate.id.localeCompare(b.candidate.candidate.id);
            });

            const best = partialMatches[0].candidate;
            const bookState = bookStates.get(best.candidate.id)!;

            // Partially match invoice, fully consume received bank transaction
            bankState.status = "MATCHED";
            bankState.matchedAmountMinor = bankAmt;
            bankState.remainingAmountMinor = 0n;

            bookState.matchedAmountMinor += bankAmt;
            bookState.remainingAmountMinor -= bankAmt;
            bookState.status = bookState.remainingAmountMinor === 0n ? "MATCHED" : "PARTIALLY_MATCHED";

            const baseReasons = best.reasons.map((r) => ({ ...r }));
            baseReasons.push({ reason: "partial_payment_validated" as CandidateReasonType, points: 5 });
            const finalScore = partialMatches[0].score;

            matches.push({
                bankTransactionIds: [bankTxn.id],
                bookTransactionIds: [best.candidate.id],
                score: finalScore,
                confidenceBand: getConfidenceBand(finalScore),
                matchType: "partial_payment",
                reasons: baseReasons
            });
        }
    }

    // ==========================================
    // PASS 5: TOLERANCE / NEAR / FX (Layers 6B & 6F)
    // ==========================================
    for (const bankState of bankStates.values()) {
        if (bankState.status === "MATCHED") continue;

        const bankTxn = bankState.txn;
        const candidates = generateCandidates(bankTxn, getAvailableBooks(), { skipAmountGate: true });
        const toleranceMatches: { candidate: CandidateResult; score: number; matchType: MatchType; reasons: CandidateReason[] }[] = [];

        for (const cand of candidates) {
            const bookState = bookStates.get(cand.candidate.id)!;
            if (bookState.status === "MATCHED") continue;

            const bankAmt = bankState.remainingAmountMinor;
            const bookAmt = bookState.remainingAmountMinor;
            const dayDiff = daysBetween(bankTxn.transactionDate, cand.candidate.transactionDate);
            const refMatch = referenceMatches(bankTxn.referenceNumber, cand.candidate.referenceNumber);
            const nameMatch = nameMatches(bankTxn.counterparty, cand.candidate.counterparty);

            // FX Match
            const currenciesDiffer = bankTxn.currency && cand.candidate.currency && bankTxn.currency !== cand.candidate.currency;
            const sharesBaseCurrency = bankTxn.baseCurrency && cand.candidate.baseCurrency && bankTxn.baseCurrency === cand.candidate.baseCurrency;

            if (currenciesDiffer && sharesBaseCurrency) {
                // If base conversion matches within rounding difference of <= 100 paise/cents
                const convertedBank = bankTxn.convertedAmountMinor;
                const convertedBook = cand.candidate.convertedAmountMinor;
                if (convertedBank !== undefined && convertedBook !== undefined && convertedBank !== null && convertedBook !== null) {
                    const diffConverted = convertedBank > convertedBook ? convertedBank - convertedBook : convertedBook - convertedBank;
                    if (diffConverted <= 100n) {
                        const finalScore = cand.score + 15;
                        const reasons = cand.reasons.map((r) => ({ ...r }));
                        reasons.push({ reason: "fx_difference_validated" as CandidateReasonType, points: 15 });
                        toleranceMatches.push({
                            candidate: cand,
                            score: finalScore,
                            matchType: "fx_difference",
                            reasons
                        });
                        continue;
                    }
                }
            }

            // Standard Tolerance match (near match)
            if (dayDiff <= 7.0 && (refMatch || nameMatch)) {
                const diffAmt = bankAmt > bookAmt ? bankAmt - bookAmt : bookAmt - bankAmt;
                const comparisonAmount = bankAmt > bookAmt ? bankAmt : bookAmt;
                const calculatedTolerance = (comparisonAmount * 500n) / 10000n; // 5% BPS
                const allowedTolerance = calculatedTolerance > 500n ? calculatedTolerance : 500n; // MIN_AMOUNT_TOLERANCE = 500 paise

                if (diffAmt <= allowedTolerance) {
                    const finalScore = cand.score + 10;
                    const reasons = cand.reasons.map((r) => ({ ...r }));
                    reasons.push({ reason: "tolerance_match_validated" as CandidateReasonType, points: 10 });
                    toleranceMatches.push({
                        candidate: cand,
                        score: finalScore,
                        // Maintain compatibility with existing tests by returning 'near' match type
                        matchType: "near",
                        reasons
                    });
                }
            }
        }

        if (toleranceMatches.length > 0) {
            toleranceMatches.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                const dateDiffA = daysBetween(bankTxn.transactionDate, a.candidate.candidate.transactionDate);
                const dateDiffB = daysBetween(bankTxn.transactionDate, b.candidate.candidate.transactionDate);
                if (dateDiffA !== dateDiffB) return dateDiffA - dateDiffB;
                return a.candidate.candidate.id.localeCompare(b.candidate.candidate.id);
            });

            const best = toleranceMatches[0];
            const bookState = bookStates.get(best.candidate.candidate.id)!;

            bankState.status = "MATCHED";
            bankState.matchedAmountMinor = bankState.remainingAmountMinor;
            bankState.remainingAmountMinor = 0n;

            bookState.status = "MATCHED";
            bookState.matchedAmountMinor = bookState.remainingAmountMinor;
            bookState.remainingAmountMinor = 0n;

            matches.push({
                bankTransactionIds: [bankTxn.id],
                bookTransactionIds: [best.candidate.candidate.id],
                score: best.score,
                confidenceBand: getConfidenceBand(best.score),
                matchType: best.matchType,
                reasons: best.reasons
            });
        }
    }

    return matches;
}