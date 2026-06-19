/**
 * Utility to convert amounts between currencies based on direction of stored FX rates.
 */
export function convertCurrency(
  amountMinor: bigint,
  rate: number | string,
  rateBase: string,
  rateQuote: string,
  txnCurrency: string,
  targetCurrency: string
): bigint {
  const rateVal = typeof rate === "string" ? parseFloat(rate) : rate;
  if (isNaN(rateVal) || rateVal <= 0) {
    throw new Error(`Invalid exchange rate value: ${rate}`);
  }

  const cleanTxnCurrency = txnCurrency.trim().toUpperCase();
  const cleanTargetCurrency = targetCurrency.trim().toUpperCase();
  const cleanRateBase = rateBase.trim().toUpperCase();
  const cleanRateQuote = rateQuote.trim().toUpperCase();

  // If txn currency matches rate base currency, we convert from base to quote.
  // e.g., txn is USD, target is INR, rate is USD/INR. We multiply: amount * rate.
  if (cleanTxnCurrency === cleanRateBase && cleanTargetCurrency === cleanRateQuote) {
    return BigInt(Math.round(Number(amountMinor) * rateVal));
  }

  // If txn currency matches rate quote currency, we convert from quote to base.
  // e.g., txn is INR, target is USD, rate is USD/INR. We divide: amount / rate.
  if (cleanTxnCurrency === cleanRateQuote && cleanTargetCurrency === cleanRateBase) {
    return BigInt(Math.round(Number(amountMinor) / rateVal));
  }

  throw new Error(
    `Unsupported conversion direction: rate is ${cleanRateBase}/${cleanRateQuote}, trying to convert ${cleanTxnCurrency} to ${cleanTargetCurrency}`
  );
}
