// TestingFolder/matching/runMatcher.ts

import { Match, MatchType } from "../types/Match";
import { CanonicalTransaction } from "../types/CanonicalTransaction";
import { generateCandidates, getDateTolerance, getAmountTolerance } from "./candidateGenerator";
import { CandidateReason, ConfidenceBand, CandidateReasonType, CandidateResult } from "../types/CandidateResult";
import { daysBetween, referenceMatches, nameMatches, directionMatches, normalizeReference, normalizeName } from "./utils";
import { classifyMatch } from "../../core/matching/classifier";
import { isStripePayoutTransaction, getConfidenceBand, bandToConfidence, getEditDistance } from "../../core/matching/matchingHelpers";
import { matchesProcessorFee, matchesProcessorFeeForCombo } from "../../core/matching/feeFormulas";
import { computeRiskScore } from "../../core/matching/riskEngine";

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


function isFuzzyMatch(s1: string, s2: string): boolean {
    if (Math.abs(s1.length - s2.length) > 1) return false;
    let edits = 0;
    let i = 0, j = 0;
    while (i < s1.length && j < s2.length) {
        if (s1[i] !== s2[j]) {
            edits++;
            if (edits > 1) return false;
            if (s1.length > s2.length) i++;
            else if (s2.length > s1.length) j++;
            else { i++; j++; }
        } else {
            i++;
            j++;
        }
    }
    return true;
}

function hasTypoOrMismatch(bankTxn: CanonicalTransaction, bookTxn: CanonicalTransaction): boolean {
    const bankDesc = (bankTxn.description || "").toUpperCase();
    const bankRef = (bankTxn.referenceNumber || "").toUpperCase();

    const bookRef = normalizeReference(bookTxn.referenceNumber);
    const bookName = normalizeName(bookTxn.counterparty);

    // 1. Check invoice/bill reference typo (INV-XXXX or BILL-XXXX)
    const invoiceRegex = /(INV|BILL|JE)-\d+/g;
    const bankInvoiceRefs = (bankDesc + " " + bankRef).match(invoiceRegex);
    if (bankInvoiceRefs) {
        for (const ref of bankInvoiceRefs) {
            const normRef = normalizeReference(ref);
            if (normRef && normRef !== bookRef) {
                return true; // reference typo/mismatch!
            }
        }
    }

    // 2. Check name typo
    if (bookName && bookTxn.counterparty) {
        const cleanBookName = bookTxn.counterparty
            .toUpperCase()
            .replace(/\b(CORPORATION|CORP|PVT|PRIVATE|LTD|LIMITED|SOLUTIONS|SOLUTION)\b/g, "")
            .replace(/[^A-Z0-9\s]/g, "");
        const bookTokens = cleanBookName.split(/\s+/).filter(t => t.length > 3);

        const cleanBankDesc = bankDesc.split("|")[0].replace(/[^A-Z0-9\s]/g, "");
        const cleanBankRef = bankRef.replace(/[^A-Z0-9\s]/g, "");
        const bankTokens = (cleanBankDesc + " " + cleanBankRef).split(/\s+/).filter(t => t.length > 3);

        for (const bToken of bankTokens) {
            for (const bkToken of bookTokens) {
                if (bToken !== bkToken && isFuzzyMatch(bToken, bkToken)) {
                    if (!bankTokens.includes(bkToken)) {
                        return true; // name typo/mismatch!
                    }
                }
            }
        }
    }

    return false;
}


function evaluateComboScore(primaryTxn: CanonicalTransaction, comboTxns: CanonicalTransaction[], isExactSum: boolean): number {
    let comboScore = isExactSum ? 100 : 80;
    
    let cpMatches = false;
    for (const ctxn of comboTxns) {
        if (nameMatches(primaryTxn.counterparty, ctxn.counterparty)) {
            cpMatches = true;
            break;
        }
    }
    if (cpMatches || isStripePayoutTransaction(primaryTxn)) {
        comboScore += 30;
    } else {
        let cpTypo = false;
        const cleanPrimary = (primaryTxn.counterparty || "").toUpperCase().replace(/\b(CORPORATION|CORP|PVT|PRIVATE|LTD|LIMITED|SOLUTIONS|SOLUTION|INCORPORATED|INC)\b/g, "").replace(/[^A-Z0-9]/g, "").trim();
        for (const ctxn of comboTxns) {
            const cleanSecondary = (ctxn.counterparty || "").toUpperCase().replace(/\b(CORPORATION|CORP|PVT|PRIVATE|LTD|LIMITED|SOLUTIONS|SOLUTION|INCORPORATED|INC)\b/g, "").replace(/[^A-Z0-9]/g, "").trim();
            if (cleanPrimary && cleanSecondary && getEditDistance(cleanPrimary, cleanSecondary) <= 2) {
                cpTypo = true;
                break;
            }
        }
        if (cpTypo) {
            comboScore += 20;
        }
    }

    const maxDayDiff = Math.max(...comboTxns.map(ctxn => daysBetween(primaryTxn.transactionDate, ctxn.transactionDate)));
    const datePoints = Math.max(0, Math.round(20 - maxDayDiff * 2));
    comboScore += datePoints;

    let hasRefOverlap = false;
    for (const ctxn of comboTxns) {
        if (referenceMatches(primaryTxn.referenceNumber, ctxn.referenceNumber) ||
            (primaryTxn.description && ctxn.description && getCounterpartySimilarity(primaryTxn.description, ctxn.description) >= 0.4)) {
            hasRefOverlap = true;
            break;
        }
    }
    if (hasRefOverlap) {
        comboScore += 20;
    }

    return comboScore;
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
            const nameMatch = nameMatches(bankTxn.counterparty, cand.candidate.counterparty);
            const diffAmt = bankAmt > bookAmt ? bankAmt - bookAmt : bookAmt - bankAmt;
            const currenciesDiffer = bankTxn.currency && cand.candidate.currency && bankTxn.currency !== cand.candidate.currency;

            // Exact rules: Same currency, Amount within rounding tolerance (<= 100 paise), ref matches or name matches, date within 1 day, no typos
            if (!currenciesDiffer && diffAmt <= 100n && dayDiff <= 1.0 && (refMatch || nameMatch) && !hasTypoOrMismatch(bankTxn, cand.candidate)) {
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
                const refA = a.candidate.candidate.referenceNumber || "";
                const refB = b.candidate.candidate.referenceNumber || "";
                if (refA !== refB) return refA.localeCompare(refB);
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
                confidenceBand: getConfidenceBand(finalScore) as ConfidenceBand,
                matchType: "exact",
                riskScore: 0,
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

            if (dayDiff <= getDateTolerance(bankTxn) && (refMatch || nameMatch)) {
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
                confidenceBand: getConfidenceBand(finalScore) as ConfidenceBand,
                matchType: "fee_adjustment",
                riskScore: 0,
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
                if (dayDiff > getDateTolerance(bankTxn)) return false;
                if (!directionMatches(bankTxn, bs.txn)) return false;

                // Currency guard — always applies even for Stripe payouts
                const currenciesDiffer = bankTxn.currency && bs.txn.currency
                    && bankTxn.currency !== bs.txn.currency;
                const sharesBase = (bankTxn.baseCurrency || bankTxn.currency)
                    === (bs.txn.baseCurrency || bs.txn.currency);
                if (currenciesDiffer && !sharesBase) return false;

                // Stripe escape hatch: bypass counterparty/ref gate only.
                // Date, direction, and currency guards above still apply.
                if (isStripePayoutTransaction(bankTxn)) return true;

                // Standard counterparty/ref gate
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
                const isExactSum = diff <= 100n;
                const isFeeSum = matchesProcessorFeeForCombo(bankAmt, combo);

                if (isExactSum || isFeeSum) {
                    const comboScore = evaluateComboScore(bankTxn, combo.map(bs => bs.txn), isExactSum);
                    validCombos.push({ combo, score: comboScore });
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
                    confidenceBand: getConfidenceBand(finalScore) as ConfidenceBand,
                    matchType: "one_to_many",
                    riskScore: 0,
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
                if (dayDiff > getDateTolerance(bs.txn)) return false;
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
                    const comboScore = evaluateComboScore(bookTxn, combo.map(bs => bs.txn), true);
                    validCombos.push({ combo, score: comboScore });
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
                    confidenceBand: getConfidenceBand(finalScore) as ConfidenceBand,
                    matchType: "many_to_one",
                    riskScore: 0,
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
            const nameMatch = nameMatches(bankTxn.counterparty, cand.candidate.counterparty);
            const isPartialAmountValid = bankAmt <= bookState.remainingAmountMinor;
            const currenciesDiffer = bankTxn.currency && cand.candidate.currency && bankTxn.currency !== cand.candidate.currency;
            const meetsToleranceOrHasRef = refMatch || (nameMatch && (Number(bankAmt) >= Number(bookState.remainingAmountMinor) * 0.8));



            // Strict remaining balance validation: payment cannot exceed remaining amount. Same currency only.
            if (!currenciesDiffer && (refMatch || nameMatch) && isPartialAmountValid && meetsToleranceOrHasRef) {
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
                confidenceBand: getConfidenceBand(finalScore) as ConfidenceBand,
                matchType: "partial_payment",
                riskScore: 0,
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
                const convertedBank = bankTxn.convertedAmountMinor !== undefined && bankTxn.convertedAmountMinor !== null
                    ? bankTxn.convertedAmountMinor
                    : bankTxn.amountMinor;
                const convertedBook = cand.candidate.convertedAmountMinor !== undefined && cand.candidate.convertedAmountMinor !== null
                    ? cand.candidate.convertedAmountMinor
                    : cand.candidate.amountMinor;
                if (convertedBank !== undefined && convertedBook !== undefined && convertedBank !== null && convertedBook !== null) {
                    const diffConverted = convertedBank > convertedBook ? convertedBank - convertedBook : convertedBook - convertedBank;
                    const comparisonAmount = convertedBank > convertedBook ? convertedBank : convertedBook;
                    const allowedTolerance = getAmountTolerance(comparisonAmount);

                    if (diffConverted <= allowedTolerance && dayDiff <= getDateTolerance(bankTxn) && (refMatch || nameMatch)) {
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



            const hasTypo = cand.reasons.some(r => 
                r.reason === "reference_typo_transposition" || 
                r.reason === "counterparty_typo_match"
            );

            if (cand.candidate.referenceNumber === "INV-2051") {
                console.log(`F4 Pass 5 check: dayDiff=${dayDiff}, refMatch=${refMatch}, nameMatch=${nameMatch}, hasTypo=${hasTypo}`);
                console.log(`F4 debug: bank_cp='${bankTxn.counterparty}', book_cp='${cand.candidate.counterparty}'`);
            }

            // Standard Tolerance match (near match)
            if (dayDiff <= getDateTolerance(bankTxn) && (refMatch || nameMatch || hasTypo)) {
                const diffAmt = bankAmt > bookAmt ? bankAmt - bookAmt : bookAmt - bankAmt;
                const comparisonAmount = bankAmt > bookAmt ? bankAmt : bookAmt;
                const allowedTolerance = getAmountTolerance(comparisonAmount);

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

            const finalScore = best.score;
            matches.push({
                bankTransactionIds: [bankTxn.id],
                bookTransactionIds: [best.candidate.candidate.id],
                score: finalScore,
                confidenceBand: getConfidenceBand(finalScore) as ConfidenceBand,
                matchType: best.matchType,
                riskScore: 0,
                reasons: best.reasons
            });
        }
    }

    // Apply classifier to all generated matches
    const allBanksForDuplicate = bankTxns.map(b => ({
        amount: Number(getEffectiveAmountMinor(b)),
        date: b.transactionDate,
        description: b.description || "",
        referenceId: b.referenceNumber || "",
        counterparty: b.counterparty || undefined
    }));

    for (const match of matches) {
        const bankTxn = bankTxns.find(b => match.bankTransactionIds.includes(b.id));
        const matchedLedgers = bookTxns.filter(b => match.bookTransactionIds.includes(b.id));

        if (bankTxn) {
            const classifierBank = {
                amount: Number(getEffectiveAmountMinor(bankTxn)),
                date: bankTxn.transactionDate,
                description: bankTxn.description || "",
                referenceId: bankTxn.referenceNumber || "",
                counterparty: bankTxn.counterparty || undefined,
                currency: bankTxn.currency || undefined,
                baseCurrency: bankTxn.baseCurrency || undefined,
                convertedAmountMinor: bankTxn.convertedAmountMinor ? Number(bankTxn.convertedAmountMinor) : undefined,
                matchingSignals: bankTxn.matchingSignals || undefined
            };

            const classifierLedgers = matchedLedgers.map(l => ({
                amount: Number(getEffectiveAmountMinor(l)),
                date: l.transactionDate,
                memo: l.description || "",
                invoiceRef: l.referenceNumber || "",
                counterparty: l.counterparty || undefined,
                currency: l.currency || undefined,
                baseCurrency: l.baseCurrency || undefined,
                convertedAmountMinor: l.convertedAmountMinor ? Number(l.convertedAmountMinor) : undefined,
                matchingSignals: l.matchingSignals || undefined
            }));

            const classification = classifyMatch(
                classifierBank,
                classifierLedgers,
                match.matchType,
                match.reasons || [],
                allBanksForDuplicate,
                match.score
            );

            match.matchOutcome = classification.matchOutcome;
            match.discrepancyType = classification.discrepancyType;
            match.evidence = classification.evidence;
        }
    }

    // ==========================================
    // PASS 6: UNMATCHED LEDGER ENTRIES
    // ==========================================
    for (const bookState of bookStates.values()) {
        if (bookState.status !== "MATCHED") {
            matches.push({
                matchOutcome: "UNKNOWN",
                bankTransactionIds: [],
                bookTransactionIds: [bookState.txn.id],
                score: 0,
                confidenceBand: "NONE",
                matchType: "unmatched_ledger" as MatchType,
                riskScore: 0,
                reasons: [],
                discrepancyType: "NONE",
                evidence: []
            });
        }
    }

    // Phase 8 — Risk Scoring loop.
    // Uses bandToConfidence(getConfidenceBand(score)) — the shared canonical mapper.
    // BACKFILL NOTE: during live test runs all bank transactions in the run are available;
    // for historical backfill the migration passes empty arrays (Option B strategy).
    for (const match of matches) {
      const bankTxn = bankTxns.find(b => match.bankTransactionIds.includes(b.id));
      if (!bankTxn) {
        // unmatched_ledger — no bank side; assign minimum risk
        match.riskScore = 0;
        continue;
      }
      const matchedBooks = bookTxns.filter(b => match.bookTransactionIds.includes(b.id));
      const matchingConfidence = bandToConfidence(match.confidenceBand);
      const breakdown = computeRiskScore({
        amountMinor: Number(getEffectiveAmountMinor(bankTxn)),
        matchingConfidence,
        matchType: match.matchType,
        discrepancyType: match.discrepancyType || "NONE",
        bankDate: bankTxn.transactionDate,
        ledgerDates: matchedBooks.map(b => b.transactionDate),
        allBankDescriptions: bankTxns.map(b => b.description || ""),
        allBankCounterparties: bankTxns.map(b => b.counterparty || ""),
        thisBankDescription: bankTxn.description || "",
        thisBankCounterparty: bankTxn.counterparty || undefined,
      });
      match.riskScore = breakdown.compositeScore;
    }

    return matches;
}
