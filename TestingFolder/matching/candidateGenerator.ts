import { CanonicalTransaction } from "../types/CanonicalTransaction";
import { CandidateResult, CandidateReason, ConfidenceBand, CandidateReasonType } from "../types/CandidateResult";
import { daysBetween, referenceMatches, nameMatches, directionMatches } from "./utils";

const TOLERANCE_BPS = 500n; // 5% in basis points
const MIN_AMOUNT_TOLERANCE = 500n; // 500 paise / ₹5
const DEFAULT_DATE_TOLERANCE_DAYS = 7;
const MAX_CANDIDATES = 50;

const CONFIDENCE_THRESHOLDS: Record<Exclude<ConfidenceBand, "LOW">, number> = {
    VERY_HIGH: 120,
    HIGH: 80,
    MEDIUM: 50
};

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

export function generateCandidates(
    bankTxn: CanonicalTransaction,
    bookTxns: CanonicalTransaction[]
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

        const currencyMatch =
            (!bankTxn.currency || !bookTxn.currency) ||
            (bankTxn.currency === bookTxn.currency) ||
            (bankTxn.convertedAmountMinor !== undefined && bankTxn.convertedAmountMinor !== null &&
             bookTxn.convertedAmountMinor !== undefined && bookTxn.convertedAmountMinor !== null &&
             bankTxn.baseCurrency && bookTxn.baseCurrency &&
             bankTxn.baseCurrency === bookTxn.baseCurrency);

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

        if (diff > allowedTolerance) {
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
        if (referenceMatches(bankTxn.referenceNumber, bookTxn.referenceNumber)) {
            score += 30;
            reasons.push({ reason: "reference_match", points: 30 });
        }

        // Counterparty similarity
        if (nameMatches(bankTxn.counterparty, bookTxn.counterparty)) {
            score += 20;
            reasons.push({ reason: "counterparty_match", points: 20 });
        }

        // Source system alignment boost
        const bankSource = bankTxn.metadata?.source || bankSignals.merchantName;
        const bookSource = bookTxn.metadata?.source;
        if (bankSource && bookSource && bankSource.toLowerCase() === bookSource.toLowerCase()) {
            score += 15;
            reasons.push({ reason: "source_alignment", points: 15 });
        }

        // Confidence band mapping
        let confidenceBand: ConfidenceBand = "LOW";
        if (score >= CONFIDENCE_THRESHOLDS.VERY_HIGH) {
            confidenceBand = "VERY_HIGH";
        } else if (score >= CONFIDENCE_THRESHOLDS.HIGH) {
            confidenceBand = "HIGH";
        } else if (score >= CONFIDENCE_THRESHOLDS.MEDIUM) {
            confidenceBand = "MEDIUM";
        }

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