import { CanonicalTransaction } from "../types/CanonicalTransaction";
import { CandidateResult, CandidateReason, ConfidenceBand, CandidateReasonType } from "../types/CandidateResult";
import { daysBetween, referenceMatches, nameMatches, directionMatches } from "./utils";
import { isDigitTransposition, hasReferenceConflict, getConfidenceBand, getEditDistance } from "../../core/matching/matchingHelpers";

const TOLERANCE_BPS = 2000n; // 20% in basis points
const MIN_AMOUNT_TOLERANCE = 500n; // 500 paise / ₹5
const DEFAULT_DATE_TOLERANCE_DAYS = 7;
const MAX_CANDIDATES = 50;


function getDateTolerance(txn: CanonicalTransaction): number {
    const channel = txn.matchingSignals?.channel || "";
    if (channel === "STRIPE") return 7;
    if (channel === "NEFT" || channel === "RTGS") return 4;
    if (channel === "UPI") return 2;
    if (channel === "WIRE") return 15;

    const desc = (txn.description || "").toLowerCase();
    if (desc.includes("stripe")) return 7;
    if (desc.includes("neft") || desc.includes("rtgs")) return 4;
    if (desc.includes("upi")) return 2;
    if (desc.includes("wire")) return 15;

    return DEFAULT_DATE_TOLERANCE_DAYS;
}

export interface GenerateCandidatesOptions {
    skipAmountGate?: boolean;
}

export function generateCandidates(
    bankTxn: CanonicalTransaction,
    bookTxns: CanonicalTransaction[],
    options?: GenerateCandidatesOptions
): CandidateResult[] {
    const results: CandidateResult[] = [];

    if (!bankTxn.matchingSignals) {
        console.warn(`[Warning] matchingSignals are missing for bank transaction ID: ${bankTxn.id}`);
    }

    for (const bookTxn of bookTxns) {
        // 1. Direction blocker
        if (!directionMatches(bankTxn, bookTxn)) {
            continue;
        }

        // 2. Currency blocker
        const currenciesDiffer = bankTxn.currency && bookTxn.currency && bankTxn.currency !== bookTxn.currency;
        if (currenciesDiffer && bankTxn.fxStatus === "MISSING_RATE") {
            continue;
        }

        const reportCurrencyBank = bankTxn.baseCurrency || bankTxn.currency;
        const reportCurrencyBook = bookTxn.baseCurrency || bookTxn.currency;
        const currencyMatch =
            (!bankTxn.currency || !bookTxn.currency) ||
            (bankTxn.currency === bookTxn.currency) ||
            (reportCurrencyBank && reportCurrencyBook && reportCurrencyBank === reportCurrencyBook);

        if (!currencyMatch) {
            continue;
        }

        // 3. Amount blocker with cents-precision BigInt Math
        const bankAmtMinor = bankTxn.convertedAmountMinor !== undefined && bankTxn.convertedAmountMinor !== null
            ? bankTxn.convertedAmountMinor
            : bankTxn.amountMinor;

        const bookAmtMinor = bookTxn.convertedAmountMinor !== undefined && bookTxn.convertedAmountMinor !== null
            ? bookTxn.convertedAmountMinor
            : bookTxn.amountMinor;

        if (bankAmtMinor === undefined || bookAmtMinor === undefined) {
            throw new Error(`amountMinor is missing: bankId=${bankTxn.id}, bookId=${bookTxn.id}`);
        }

        const diff = bankAmtMinor > bookAmtMinor ? bankAmtMinor - bookAmtMinor : bookAmtMinor - bankAmtMinor;
        const comparisonAmount = bankAmtMinor > bookAmtMinor ? bankAmtMinor : bookAmtMinor;
        
        const calculatedTolerance = (comparisonAmount * TOLERANCE_BPS) / 10000n;
        const allowedTolerance = calculatedTolerance > MIN_AMOUNT_TOLERANCE ? calculatedTolerance : MIN_AMOUNT_TOLERANCE;

        if (!options?.skipAmountGate && diff > allowedTolerance) {
            continue;
        }

        // 4. Date blocker
        const dayDiff = daysBetween(bankTxn.transactionDate, bookTxn.transactionDate);
        const maxDateDifference = getDateTolerance(bankTxn);
        if (Math.floor(dayDiff) > maxDateDifference) {
            continue;
        }

        // ── Ranking Score & Diagnostics ──────────────────────────────────────────
        let score = 0;
        const reasons: CandidateReason[] = [];

        // Exact or Near Amount Match
        if (diff === 0n) {
            score += 50;
            reasons.push({ reason: "amount_match", points: 50 });
        } else {
            const scorePoints = Number(50n - (diff * 50n) / allowedTolerance);
            const finalPoints = Math.max(0, Math.round(scorePoints));
            score += finalPoints;
            reasons.push({ reason: "amount_near_match", points: finalPoints });
        }

        // Date proximity
        const datePoints = Math.max(0, Math.round(30 - dayDiff * 3));
        if (datePoints > 0) {
            score += datePoints;
            reasons.push({ reason: "date_match", points: datePoints });
        }

        // Matching Signals (Mutually Exclusive Precedence Group)
        const bankSignals = bankTxn.matchingSignals || {};
        const bookSignals = bookTxn.matchingSignals || {};

        let signalScore = 0;
        let signalReason: CandidateReasonType | null = null;

        if (bankSignals.utr && bookSignals.utr && bankSignals.utr === bookSignals.utr) {
            signalScore = 100;
            signalReason = "utr_match";
        } else if (bankSignals.relatedTransactionId && bookSignals.relatedTransactionId && bankSignals.relatedTransactionId === bookSignals.relatedTransactionId) {
            signalScore = 80;
            signalReason = "related_id_match";
        } else if (bankSignals.invoiceNumber && bookSignals.invoiceNumber && bankSignals.invoiceNumber === bookSignals.invoiceNumber) {
            signalScore = 80;
            signalReason = "invoice_match";
        } else if (bankSignals.voucherNumber && bookSignals.voucherNumber && bankSignals.voucherNumber === bookSignals.voucherNumber) {
            signalScore = 80;
            signalReason = "voucher_match";
        }

        if (signalReason) {
            score += signalScore;
            reasons.push({ reason: signalReason, points: signalScore });
        }

        // Reference similarity
        const bankRef = (bankTxn.referenceNumber || "").trim().toLowerCase();
        const bookRef = (bookTxn.referenceNumber || "").trim().toLowerCase();
        if (bankRef && bookRef) {
            if (bankRef.includes(bookRef) || bookRef.includes(bankRef)) {
                score += 30;
                reasons.push({ reason: "reference_match", points: 30 });
            } else {
                const bankSignals = bankTxn.matchingSignals || {};
                const bookSignals = bookTxn.matchingSignals || {};
                const bankInv = bankSignals.invoiceNumber || "";
                const bookInv = bookSignals.invoiceNumber || "";
                if (isDigitTransposition(bankRef, bookRef) || (bankInv && bookInv && isDigitTransposition(bankInv, bookInv))) {
                    score += 15;
                    reasons.push({ reason: "reference_typo_transposition" as CandidateReasonType, points: 15 });
                } else {
                    score -= 20;
                    reasons.push({ reason: "reference_mismatch_penalty" as CandidateReasonType, points: -20 });
                }
            }
        }

        // Counterparty similarity
        if (nameMatches(bankTxn.counterparty, bookTxn.counterparty)) {
            score += 20;
            reasons.push({ reason: "counterparty_match", points: 20 });
        } else if (bankTxn.counterparty && bookTxn.counterparty) {
            const cleanBank = bankTxn.counterparty.toUpperCase().replace(/\b(CORPORATION|CORP|PVT|PRIVATE|LTD|LIMITED|SOLUTIONS|SOLUTION|INCORPORATED|INC)\b/g, "").replace(/[^A-Z0-9]/g, "").trim();
            const cleanBook = bookTxn.counterparty.toUpperCase().replace(/\b(CORPORATION|CORP|PVT|PRIVATE|LTD|LIMITED|SOLUTIONS|SOLUTION|INCORPORATED|INC)\b/g, "").replace(/[^A-Z0-9]/g, "").trim();
            if (cleanBank && cleanBook && getEditDistance(cleanBank, cleanBook) <= 2) {
                score += 15;
                reasons.push({ reason: "counterparty_typo_match" as CandidateReasonType, points: 15 });
            }
        }

        // Source system alignment boost
        const bankSource = bankTxn.metadata?.source || bankSignals.merchantName;
        const bookSource = bookTxn.metadata?.source;
        if (bankSource && bookSource && bankSource.toLowerCase() === bookSource.toLowerCase()) {
            score += 15;
            reasons.push({ reason: "source_alignment", points: 15 });
        }

        // Reference conflict penalty — must be applied here (before results.push / sort)
        // so the penalised score participates in candidate ranking.
        const refAlreadyMatched = reasons.some(r => r.reason === "reference_match" || r.reason === "reference_typo_transposition");
        const refConflict = hasReferenceConflict(
            bankTxn.referenceNumber,
            bookTxn.referenceNumber,
            refAlreadyMatched
        );
        const signalMatch = reasons.some(r =>
            r.reason === "utr_match" ||
            r.reason === "invoice_match" ||
            r.reason === "voucher_match"
        );
        if (refConflict && !signalMatch) {
            // Both sides carry non-empty refs that disagree and no signal disambiguates.
            // Apply a heavy penalty so the candidate falls below the Pass 1 threshold
            // and drops to later passes. Do NOT hard-reject — preserves recall for
            // txns without signals (e.g. ordinary ref-mismatch that still matches on
            // counterparty + amount + date in Pass 5).
            score -= 50;
            reasons.push({ reason: "reference_conflict_penalty" as CandidateReasonType, points: -50 });
        }

        // Confidence band mapping
        let confidenceBand: ConfidenceBand = getConfidenceBand(score) as ConfidenceBand;

        results.push({
            candidate: bookTxn,
            score,
            confidenceBand,
            reasons
        });
    }

    // Sort descending by score
    results.sort((a, b) => b.score - a.score);

    // Return top MAX_CANDIDATES
    return results.slice(0, MAX_CANDIDATES);
}