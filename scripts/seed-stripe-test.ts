import "dotenv/config";
import { db } from "../core/db";
import { users, canonicalTransactions, matches } from "../core/db/schema";
import { eq } from "drizzle-orm";
import { getOrCreateUserOrganization, getOrCreateFinancialAccount } from "../core/db/org-helper";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Error: DATABASE_URL must be set in environment variables.");
    process.exit(1);
  }

  const email = process.env.USER_EMAIL || "demo@example.com";

  // Find or create user by email
  let userRows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (userRows.length === 0) {
    console.log(`User '${email}' not found. Creating new demo user...`);
    userRows = await db.insert(users).values({
      email,
      name: "Demo Company"
    }).returning();
  }
  const userId = userRows[0].id;

  const orgId = await getOrCreateUserOrganization(userId);
  const bankAccountId = await getOrCreateFinancialAccount(orgId, "bank", "Stripe Bank Account");
  const stripeAccountId = await getOrCreateFinancialAccount(orgId, "stripe", "Stripe Account");

  // Check if bank transactions already exist in canonicalTransactions
  const existingBanks = await db.select().from(canonicalTransactions).where(eq(canonicalTransactions.organizationId, orgId)).limit(1);
  if (existingBanks.length > 0) {
    console.log("Already seeded in canonicalTransactions. Deleting existing matching data first...");
    await db.delete(matches).where(eq(matches.userId, userId));
    await db.delete(canonicalTransactions).where(eq(canonicalTransactions.organizationId, orgId));
  }

  console.log("Seeding test data...");

  const banksData = [
    { amount: "12400.00", date: "2026-06-03", description: "Stripe payout INV-2891", source: "stripe" },
    { amount: "49800.00", date: "2026-06-04", description: "NEFT transfer AXIS-0044", source: "csv" },
    { amount: "8250.00", date: "2026-06-04", description: "UPI GPAY-9910 payment", source: "stripe" },
    { amount: "125000.00", date: "2026-06-06", description: "Stripe payout bulk", source: "stripe" },
    { amount: "23800.00", date: "2026-06-08", description: "NEFT HDFC-corp-0091", source: "csv" },
    { amount: "5500.00", date: "2026-06-10", description: "UPI payment 77821", source: "stripe" },
    { amount: "88000.00", date: "2026-06-12", description: "Wire transfer INT-4421", source: "csv" },
    { amount: "14750.00", date: "2026-06-15", description: "Stripe payout INV-2897", source: "stripe" },
    { amount: "50200.00", date: "2026-06-17", description: "NEFT unknown source", source: "csv" },
    // Fuzzy #1 — fee difference vs Ledger 14. ₹18,500 - ₹232 fee = ₹18,268
    { amount: "18268.00", date: "2026-06-27", description: "Stripe payout INV-2903 (net of fees)", source: "stripe" },
    // Fuzzy #2 — exact amount but 2-day settlement delay vs Ledger 15
    { amount: "27500.00", date: "2026-06-30", description: "NEFT transfer ref INV2904", source: "csv" },
  ];

  const ledgerData = [
    { amount: "12400.00", date: "2026-06-03", memo: "INV-2891 · Razorpay settlement", invoiceRef: "INV-2891" },
    { amount: "48550.00", date: "2026-06-04", memo: "INV-2892 · enterprise client", invoiceRef: "INV-2892" },
    { amount: "1250.00", date: "2026-06-04", memo: "WireFee-Jun-04 · AXIS bank charge", invoiceRef: "WireFee-Jun-04" },
    { amount: "8250.00", date: "2026-06-04", memo: "INV-2893 · UPI payment", invoiceRef: "INV-2893" },
    { amount: "75000.00", date: "2026-06-06", memo: "INV-2894 · monthly retainer", invoiceRef: "INV-2894" },
    { amount: "50000.00", date: "2026-06-06", memo: "INV-2895 · license fee", invoiceRef: "INV-2895" },
    { amount: "23800.00", date: "2026-06-08", memo: "INV-2896 · consulting", invoiceRef: "INV-2896" },
    { amount: "5500.00", date: "2026-06-10", memo: "INV-2897-partial · advance", invoiceRef: "INV-2897-partial" },
    { amount: "88000.00", date: "2026-06-12", memo: "INV-2898 · international", invoiceRef: "INV-2898" },
    { amount: "14750.00", date: "2026-06-15", memo: "INV-2899 · Stripe settlement", invoiceRef: "INV-2899" },
    { amount: "32000.00", date: "2026-06-20", memo: "INV-2900 · undeposited", invoiceRef: "INV-2900" },
    { amount: "15500.00", date: "2026-06-22", memo: "INV-2901 · pending", invoiceRef: "INV-2901" },
    { amount: "9800.00", date: "2026-06-25", memo: "INV-2902 · credit note", invoiceRef: "INV-2902" },
    // Fuzzy #1 target — full invoice amount before Stripe fee deduction
    { amount: "18500.00", date: "2026-06-27", memo: "INV-2903 · subscription renewal", invoiceRef: "INV-2903" },
    // Fuzzy #2 target — booked 2 days before the NEFT actually settles
    { amount: "27500.00", date: "2026-06-28", memo: "INV-2904 · annual plan", invoiceRef: "INV-2904" },
  ];

  await db.transaction(async (tx: any) => {
    const dbBanks = banksData.map((b, i) => ({
      organizationId: orgId,
      accountId: b.source === "stripe" ? stripeAccountId : bankAccountId,
      side: "money" as const,
      direction: "inflow" as const,
      status: "AVAILABLE" as const,
      transactionDate: b.date,
      amountMinor: BigInt(Math.round(Number(b.amount) * 100)),
      currency: "INR",
      description: b.description,
      sourceTransactionId: `seed-stripe-bank-${i}`,
      metadata: { source: b.source, layout: b.source === "stripe" ? "stripe_export" : "bank_csv" },
    }));

    const dbLedgers = ledgerData.map((l, i) => ({
      organizationId: orgId,
      accountId: bankAccountId,
      side: "books" as const,
      direction: "inflow" as const,
      status: "AVAILABLE" as const,
      transactionDate: l.date,
      amountMinor: BigInt(Math.round(Number(l.amount) * 100)),
      currency: "INR",
      referenceNumber: l.invoiceRef,
      description: l.memo,
      sourceTransactionId: `seed-stripe-ledger-${i}`,
      metadata: { source: "ledger", layout: "qbo_export" },
    }));

    await tx.insert(canonicalTransactions).values([...dbBanks, ...dbLedgers]);
  });

  const totalBankStr = banksData.reduce((acc, curr) => acc + Number(curr.amount), 0).toLocaleString("en-IN");
  const totalLedgerStr = ledgerData.reduce((acc, curr) => acc + Number(curr.amount), 0).toLocaleString("en-IN");

  console.log(`Seeded into canonicalTransactions:`);
  console.log(`  ${banksData.length} bank transactions (₹${totalBankStr} total)`);
  console.log(`  ${ledgerData.length} ledger entries (₹${totalLedgerStr} total)`);
  console.log(``);
  console.log(`Run POST /api/recon/run to start matching.`);
  console.log(`Expected results after running /api/recon/run with periodStart=2026-06-01, periodEnd=2026-06-30:`);
  console.log(`  6 exact matches (auto-approved)`);
  console.log(`  2 bulk/many-to-one matches (pending review)`);
  console.log(`  2 fuzzy matches (pending review, AI-explained — fee diff + date gap)`);
  console.log(`  1 exception (no match found)`);
  console.log(`  3 ledger entries left unmatched (L11, L12, L13)`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Seeding failed", err);
  process.exit(1);
});