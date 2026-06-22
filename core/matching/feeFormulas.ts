// core/matching/feeFormulas.ts

export interface TransactionState {
  remainingAmountMinor: bigint | number;
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

  // 3. Razorpay / generic percentages
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
    return sum + Math.round(amt * 0.029) + 2500;
  }, 0);
  if (Math.abs(diff - expectedStripeINR) <= allowedTolerance) return true;

  // 2. Stripe USD
  const expectedStripeUSD = combo.reduce((sum, bs) => {
    const amt = typeof bs.remainingAmountMinor === 'bigint' ? Number(bs.remainingAmountMinor) : bs.remainingAmountMinor;
    return sum + Math.round(amt * 0.029) + 3000;
  }, 0);
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

  return false;
}
