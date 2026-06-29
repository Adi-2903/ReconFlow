// core/matching/feeFormulas.ts

export interface TransactionState {
  remainingAmountMinor: bigint | number;
}

/**
 * A single Indian TDS (Tax Deducted at Source) deduction rule.
 * Exported so that new sections can be registered in one place and
 * automatically picked up by all fee-matching and classification logic.
 */
export interface TdsDeductionRule {
  /** Income Tax Act section number, e.g. "194C" */
  section: string;
  /** Deduction rate as a decimal fraction, e.g. 0.01 for 1% */
  rate: number;
  /** Human-readable description for audit evidence messages */
  description: string;
}

/**
 * Canonical set of Indian TDS deduction rules supported by the engine.
 *
 * To add a new rate: append an entry to this array.
 * No other code changes are required — the rate is automatically used
 * in matchesProcessorFee, matchesProcessorFeeForCombo, and the classifier.
 */
export const TDS_DEDUCTION_RULES: readonly TdsDeductionRule[] = [
  { section: "194C-individual", rate: 0.01, description: "TDS on contractor payments to individual (194C) @ 1%" },
  { section: "194C-company",    rate: 0.02, description: "TDS on contractor payments to company (194C) @ 2%" },
  { section: "194H",            rate: 0.02, description: "TDS on commission or brokerage (194H) @ 2%" },
  { section: "194A",            rate: 0.05, description: "TDS on interest other than securities (194A) @ 5%" },
  { section: "194J",            rate: 0.10, description: "TDS on professional/technical services (194J) @ 10%" },
];

/**
 * Returns the first TDS_DEDUCTION_RULE that best explains the difference
 * between bankAmtMinor and bookAmtMinor, or null if no TDS rule applies.
 *
 * Used by the classifier to emit a TDS_DEDUCTION evidence code with the
 * relevant section number, independent of the boolean fee-match gate.
 */
export function detectTdsDeduction(
  bankAmtMinor: bigint | number,
  bookAmtMinor: bigint | number
): TdsDeductionRule | null {
  const bank = typeof bankAmtMinor === "bigint" ? Number(bankAmtMinor) : bankAmtMinor;
  const book = typeof bookAmtMinor === "bigint" ? Number(bookAmtMinor) : bookAmtMinor;
  const diff = book - bank;
  if (diff <= 0) return null;

  const allowedTolerance = Math.max(500, Math.round(book * 0.005));
  for (const rule of TDS_DEDUCTION_RULES) {
    const expectedDeduction = Math.round(book * rule.rate);
    if (Math.abs(diff - expectedDeduction) <= allowedTolerance) return rule;
  }
  return null;
}

export function matchesProcessorFee(bankAmtMinor: bigint | number, bookAmtMinor: bigint | number): boolean {
  const bank = typeof bankAmtMinor === 'bigint' ? Number(bankAmtMinor) : bankAmtMinor;
  const book = typeof bookAmtMinor === 'bigint' ? Number(bookAmtMinor) : bookAmtMinor;
  
  const diff = book - bank;
  if (diff <= 0) return false;
  
  const allowedTolerance = Math.max(500, Math.round(book * 0.005));
  
  // 1. Stripe INR: 2.9% + Rs. 25 (2500 paise)
  const expectedStripeINR = Math.round(book * 0.029) + 2500;
  if (Math.abs(diff - expectedStripeINR) <= allowedTolerance) return true;

  // 2. Stripe USD: 2.9% + $0.30 (3000 paise/cents)
  const expectedStripeUSD = Math.round(book * 0.029) + 3000;
  if (Math.abs(diff - expectedStripeUSD) <= allowedTolerance) return true;

  // 3. Razorpay / generic percentage rates
  const commonRates = [0.0118, 0.0236, 0.03776, 0.0472, 0.029, 0.02, 0.03];
  for (const rate of commonRates) {
    const expectedFee = Math.round(book * rate);
    if (Math.abs(diff - expectedFee) <= allowedTolerance) {
      return true;
    }
  }

  // 4. Flat Indian banking fees: NEFT/RTGS/wire processing charges (in paise)
  const commonFlatFees = [100, 118, 177, 236, 354, 500, 590, 1000, 1180, 2360, 5000];
  for (const flatFee of commonFlatFees) {
    if (Math.abs(diff - flatFee) <= 50) return true; // ±50 paise rounding tolerance for flat fees
  }

  // 5. Indian TDS deduction rates — centralised in TDS_DEDUCTION_RULES
  for (const rule of TDS_DEDUCTION_RULES) {
    const expectedDeduction = Math.round(book * rule.rate);
    if (Math.abs(diff - expectedDeduction) <= allowedTolerance) return true;
  }

  return false;
}

export function matchesProcessorFeeForCombo(bankAmtMinor: bigint | number, combo: TransactionState[]): boolean {
  const bank = typeof bankAmtMinor === 'bigint' ? Number(bankAmtMinor) : bankAmtMinor;
  
  const sumBookAmt = combo.reduce((sum, bs) => {
    const amt = typeof bs.remainingAmountMinor === 'bigint' ? Number(bs.remainingAmountMinor) : bs.remainingAmountMinor;
    return sum + amt;
  }, 0);
  
  const diff = sumBookAmt - bank;
  if (diff <= 0) return false;

  const allowedTolerance = combo.reduce((sum, bs) => {
    const amt = typeof bs.remainingAmountMinor === 'bigint' ? Number(bs.remainingAmountMinor) : bs.remainingAmountMinor;
    return sum + Math.max(500, Math.round(amt * 0.005));
  }, 0);

  // 1. Stripe INR
  const expectedStripeINR = combo.reduce((sum, bs) => {
    const amt = typeof bs.remainingAmountMinor === 'bigint' ? Number(bs.remainingAmountMinor) : bs.remainingAmountMinor;
    return sum + Math.round(amt * 0.029);
  }, 0) + (2500 * combo.length);
  if (Math.abs(diff - expectedStripeINR) <= allowedTolerance) return true;

  // 2. Stripe USD
  const expectedStripeUSD = combo.reduce((sum, bs) => {
    const amt = typeof bs.remainingAmountMinor === 'bigint' ? Number(bs.remainingAmountMinor) : bs.remainingAmountMinor;
    return sum + Math.round(amt * 0.029);
  }, 0) + (3000 * combo.length);
  if (Math.abs(diff - expectedStripeUSD) <= allowedTolerance) return true;

  // 3. Simple rates
  const commonRates = [0.0118, 0.0236, 0.03776, 0.0472, 0.029, 0.02, 0.03];
  for (const rate of commonRates) {
    const expectedFee = combo.reduce((sum, bs) => {
      const amt = typeof bs.remainingAmountMinor === 'bigint' ? Number(bs.remainingAmountMinor) : bs.remainingAmountMinor;
      return sum + Math.round(amt * rate);
    }, 0);
    if (Math.abs(diff - expectedFee) <= allowedTolerance) {
      return true;
    }
  }

  // 4. Flat Indian banking fees: NEFT/RTGS/wire processing charges (in paise)
  const commonFlatFees = [100, 118, 177, 236, 354, 500, 590, 1000, 1180, 2360, 5000];
  for (const flatFee of commonFlatFees) {
    if (Math.abs(diff - flatFee) <= 50) return true; // ±50 paise rounding tolerance for flat fees
  }

  // 5. Indian TDS deduction rates applied to the combined book sum
  for (const rule of TDS_DEDUCTION_RULES) {
    const expectedDeduction = Math.round(sumBookAmt * rule.rate);
    if (Math.abs(diff - expectedDeduction) <= allowedTolerance) return true;
  }

  return false;
}
