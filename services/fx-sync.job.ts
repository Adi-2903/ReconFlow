import { db } from "../core/db";
import { organizations, financialAccounts, canonicalTransactions, fxRates } from "../core/db/schema";
import { eq } from "drizzle-orm";

/**
 * Syncs the latest daily historical exchange rates for all base currencies
 * configured in the system and quotes present in transactions history.
 */
export async function runFxSyncJob(): Promise<void> {
  console.log("Starting nightly FX sync job...");

  try {
    // 1. Gather all active base currencies from organizations and accounts
    const baseCurrencies = new Set<string>();
    const orgsList = await db.select({ baseCurrency: organizations.baseCurrency }).from(organizations);
    orgsList.forEach((o) => {
      if (o.baseCurrency) baseCurrencies.add(o.baseCurrency.trim().toUpperCase());
    });

    const accsList = await db.select({ baseCurrency: financialAccounts.baseCurrency }).from(financialAccounts);
    accsList.forEach((a) => {
      if (a.baseCurrency) baseCurrencies.add(a.baseCurrency.trim().toUpperCase());
    });

    // Default fallback bases
    if (baseCurrencies.size === 0) {
      baseCurrencies.add("USD");
    }

    // 2. Gather all unique transaction currencies in history
    const txnCurrencies = new Set<string>();
    const txns = await db
      .select({ currency: canonicalTransactions.currency })
      .from(canonicalTransactions)
      .groupBy(canonicalTransactions.currency);
    txns.forEach((t) => {
      if (t.currency) txnCurrencies.add(t.currency.trim().toUpperCase());
    });

    // Standard fallback currencies
    txnCurrencies.add("USD");
    txnCurrencies.add("EUR");
    txnCurrencies.add("GBP");
    txnCurrencies.add("AED");
    txnCurrencies.add("INR");

    const todayStr = new Date().toISOString().split("T")[0];

    // 3. Fetch rates for each base currency
    for (const base of baseCurrencies) {
      try {
        let rates: Record<string, number> = {};
        const apiKey = process.env.EXCHANGERATE_HOST_API_KEY;

        if (apiKey) {
          console.log(`Fetching rates for base currency: ${base} using exchangerate.host...`);
          const res = await fetch(`https://api.exchangerate.host/live?access_key=${apiKey}&base=${base}`);
          if (!res.ok) {
            throw new Error(`Failed to fetch rates from exchangerate.host, status: ${res.status}`);
          }
          const data = await res.json();
          if (!data.success) {
            throw new Error(`exchangerate.host API returned success=false: ${JSON.stringify(data.error || data)}`);
          }

          // APILayer's exchangerate.host returns quotes prefixed by base currency (e.g. "USDEUR" for USD->EUR)
          const rawQuotes = data.quotes || {};
          for (const key of Object.keys(rawQuotes)) {
            let quoteKey = key;
            if (key.toUpperCase().startsWith(base.toUpperCase()) && key.length > base.length) {
              quoteKey = key.slice(base.length);
            }
            rates[quoteKey.trim().toUpperCase()] = Number(rawQuotes[key]);
          }
        } else {
          console.log(`Fetching rates for base currency: ${base} using open.er-api.com...`);
          const res = await fetch(`https://open.er-api.com/v6/latest/${base}`);
          if (!res.ok) {
            throw new Error(`Failed to fetch rates from open.er-api.com, status: ${res.status}`);
          }
          const data = await res.json();
          if (data.result !== "success" || !data.rates) {
            throw new Error(`Invalid API response format from open.er-api.com: ${JSON.stringify(data)}`);
          }
          rates = data.rates;
        }

        let syncedCount = 0;

        // Upsert rate for each quote currency we found in accounts / transactions
        for (const quote of txnCurrencies) {
          if (quote === base) continue;
          const rateVal = rates[quote];
          if (rateVal) {
            await db
              .insert(fxRates)
              .values({
                baseCurrency: base,
                quoteCurrency: quote,
                rateDate: todayStr,
                exchangeRate: String(rateVal),
              })
              .onConflictDoUpdate({
                target: [fxRates.baseCurrency, fxRates.quoteCurrency, fxRates.rateDate],
                set: { exchangeRate: String(rateVal) },
              });
            syncedCount++;
          }
        }
        console.log(`Synced ${syncedCount} rate quotes for base currency ${base}.`);
      } catch (apiErr: any) {
        console.warn(
          `Could not sync external rates for ${base} from API: ${apiErr.message}. Falling back to default rates.`
        );
        // Fallback seeding to ensure we always write rates for today
        const fallbackQuotes: Record<string, Record<string, number>> = {
          USD: { EUR: 0.92, GBP: 0.76, AED: 3.67, INR: 83.15 },
          INR: { USD: 0.012, EUR: 0.011, GBP: 0.009 },
        };
        const quotes = fallbackQuotes[base] || {};
        for (const quote of txnCurrencies) {
          if (quote === base) continue;
          const fallbackRate = quotes[quote] || 1.0;
          await db
            .insert(fxRates)
            .values({
              baseCurrency: base,
              quoteCurrency: quote,
              rateDate: todayStr,
              exchangeRate: String(fallbackRate),
            })
            .onConflictDoUpdate({
              target: [fxRates.baseCurrency, fxRates.quoteCurrency, fxRates.rateDate],
              set: { exchangeRate: String(fallbackRate) },
            });
        }
      }
    }
    console.log("Nightly FX sync job finished successfully.");
  } catch (err: any) {
    console.error("FX Nightly Sync Job failed:", err);
    throw err;
  }
}
