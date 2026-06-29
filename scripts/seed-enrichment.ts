import "dotenv/config";
import { db } from "../core/db";
import {
  organizations,
  fxRates,
  feeRules,
  counterpartyProfiles,
  learnedPatterns,
} from "../core/db/schema";
import { eq, and, sql } from "drizzle-orm";

async function main() {
  console.log("====================================");
  console.log("RUNNING ENRICHMENT SEEDER");
  console.log("====================================\n");

  // 1. Get or create organization
  let orgList = await db.select().from(organizations);
  if (orgList.length === 0) {
    console.log("Creating default organization...");
    const [newOrg] = await db
      .insert(organizations)
      .values({
        name: "Bluepeak Studios Private Limited",
        baseCurrency: "USD",
      })
      .returning();
    orgList = [newOrg];
  }
  const org = orgList[0];
  console.log(`Using Organization: ${org.name} (ID: ${org.id})`);

  // 2. Seed Historical Exchange Rates for January 2026
  console.log("\nSeeding FX Rates for January 2026...");
  const baseCurrencies = ["USD", "INR"];
  const quotesMap: Record<string, Record<string, number>> = {
    USD: { EUR: 0.92, GBP: 0.76, AED: 3.67, INR: 83.15 },
    INR: { USD: 0.012, EUR: 0.011, GBP: 0.009 },
  };

  let ratesInserted = 0;
  for (let day = 1; day <= 31; day++) {
    const dayStr = String(day).padStart(2, "0");
    const rateDate = `2026-01-${dayStr}`;

    for (const base of baseCurrencies) {
      const quotes = quotesMap[base] || {};
      for (const [quote, baseRate] of Object.entries(quotes)) {
        // Apply slight daily variations
        const dailyVariation = 1 + (Math.sin(day) * 0.01);
        const rate = (baseRate * dailyVariation).toFixed(6);

        try {
          await db
            .insert(fxRates)
            .values({
              baseCurrency: base,
              quoteCurrency: quote,
              exchangeRate: rate,
              rateDate: rateDate,
            })
            .onConflictDoUpdate({
              target: [fxRates.baseCurrency, fxRates.quoteCurrency, fxRates.rateDate],
              set: { exchangeRate: rate },
            });
          ratesInserted++;
        } catch (e: any) {
          console.error(`FX Rate conflict/error for ${base}/${quote} on ${rateDate}:`, e.message);
        }
      }
    }
  }
  console.log(`Seeded ${ratesInserted} historical exchange rates.`);

  // 3. Seed Fee Rules
  console.log("\nSeeding Fee Rules...");
  const rulesToSeed = [
    {
      provider: "stripe",
      ruleName: "Stripe Standard Processing Fee",
      feeConfig: { percentage: 2.9, fixedFeeMinor: 30, currency: "USD" },
    },
    {
      provider: "bank",
      ruleName: "Bank Standard IMPS Fee",
      feeConfig: { percentage: 0.0, fixedFeeMinor: 1500, currency: "INR" }, // 15 INR
    },
    {
      provider: "wire",
      ruleName: "Wire Transfer Inward Fee",
      feeConfig: { percentage: 0.0, fixedFeeMinor: 2500, currency: "USD" }, // 25 USD
    },
  ];

  for (const rule of rulesToSeed) {
    const [existing] = await db
      .select()
      .from(feeRules)
      .where(and(eq(feeRules.organizationId, org.id), eq(feeRules.ruleName, rule.ruleName)))
      .limit(1);

    if (!existing) {
      await db.insert(feeRules).values({
        organizationId: org.id,
        provider: rule.provider,
        ruleName: rule.ruleName,
        feeConfig: rule.feeConfig,
        active: true,
      });
      console.log(`Created fee rule: ${rule.ruleName}`);
    } else {
      console.log(`Fee rule already exists: ${rule.ruleName}`);
    }
  }

  // 4. Seed Counterparty Profiles & Learned Patterns
  console.log("\nSeeding Counterparty Profiles & Patterns...");
  const profilesToSeed = ["amazon", "stripe", "FX Service"];

  for (const name of profilesToSeed) {
    const [existing] = await db
      .select()
      .from(counterpartyProfiles)
      .where(and(eq(counterpartyProfiles.organizationId, org.id), eq(counterpartyProfiles.normalizedName, name)))
      .limit(1);

    let profileId: string;
    if (!existing) {
      const [newProfile] = await db
        .insert(counterpartyProfiles)
        .values({
          organizationId: org.id,
          normalizedName: name,
          totalTransactions: 0,
        })
        .returning();
      profileId = newProfile.id;
      console.log(`Created counterparty profile: ${name}`);
    } else {
      profileId = existing.id;
      console.log(`Counterparty profile already exists: ${name}`);
    }

    // Seed patterns for amazon
    if (name === "amazon") {
      const aliases = ["Amazon.com", "AMZN", "Amazon Inc", "Amazon Digital Services"];
      for (const alias of aliases) {
        const [existingPattern] = await db
          .select()
          .from(learnedPatterns)
          .where(
            and(
              eq(learnedPatterns.organizationId, org.id),
              eq(learnedPatterns.counterpartyProfileId, profileId),
              sql`pattern_data->>'alias' = ${alias}`
            )
          )
          .limit(1);

        if (!existingPattern) {
          await db.insert(learnedPatterns).values({
            organizationId: org.id,
            counterpartyProfileId: profileId,
            patternType: "counterparty_alias",
            confidence: "0.95",
            patternData: { alias: alias, profileName: "amazon" },
          });
          console.log(`Created pattern for ${name} -> alias: ${alias}`);
        }
      }
    }
  }

  console.log("\nEnrichment seeder run completed successfully!");
}

main().catch((err) => {
  console.error("Seeder failed:", err);
  process.exit(1);
});
