import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/core/db";
import { matches, canonicalTransactions } from "@/core/db/schema";
import { eq } from "drizzle-orm";
import { getOrCreateUserOrganization, getOrCreateFinancialAccount } from "@/core/db/org-helper";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const orgId = await getOrCreateUserOrganization(userId);

    // 1. Clear existing data for this user
    await db.delete(matches).where(eq(matches.userId, userId));
    await db.delete(canonicalTransactions).where(eq(canonicalTransactions.organizationId, orgId));

    const today = new Date();
    const d = (daysAgo: number) => new Date(today.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString();

    // 2. Generate Seed Data
    // Amounts in paise/cents (e.g., 500000 = ₹5,000.00)
    
    // Exact Matches (Perfect)
    const exact1 = { amount: "1500000", date: d(1) }; // ₹15,000
    const exact2 = { amount: "800000", date: d(2) }; // ₹8,000
    
    // Fuzzy Matches (Fees, Partial, Typos)
    const stripeFee = { bankAmt: "1960000", ledgerAmt: "2000000", date: d(3) }; // ₹20,000 invoice, but Stripe took ₹400 fee
    const partialPayment = { bankAmt: "500000", ledgerAmt: "1000000", date: d(4) }; // ₹10,000 invoice, only ₹5,000 paid
    
    // Anomalies (Missing, Duplicates)
    const missingInvoice = { bankAmt: "1250000", date: d(5) }; // Bank deposit exists, no ledger entry
    const missingBank = { ledgerAmt: "750000", date: d(6) }; // Invoice exists, never paid

    const bankAccountId = await getOrCreateFinancialAccount(orgId, "bank", "Demo Bank Account");
    const stripeAccountId = await getOrCreateFinancialAccount(orgId, "stripe", "Stripe Account");
    const qboAccountId = await getOrCreateFinancialAccount(orgId, "quickbooks", "Demo QuickBooks Account");

    const bankSeed = [
      {
        organizationId: orgId,
        accountId: stripeAccountId,
        side: "money" as const,
        direction: "inflow" as const,
        status: "AVAILABLE" as const,
        transactionDate: exact1.date.split("T")[0],
        amountMinor: BigInt(exact1.amount),
        currency: "INR",
        description: "Stripe Payout - INV001",
        sourceTransactionId: "seed-bank-exact1",
        metadata: { source: "Stripe", layout: "stripe_export" },
      },
      {
        organizationId: orgId,
        accountId: stripeAccountId,
        side: "money" as const,
        direction: "inflow" as const,
        status: "AVAILABLE" as const,
        transactionDate: exact2.date.split("T")[0],
        amountMinor: BigInt(exact2.amount),
        currency: "INR",
        description: "Stripe Payout - INV002",
        sourceTransactionId: "seed-bank-exact2",
        metadata: { source: "Stripe", layout: "stripe_export" },
      },
      {
        organizationId: orgId,
        accountId: stripeAccountId,
        side: "money" as const,
        direction: "inflow" as const,
        status: "AVAILABLE" as const,
        transactionDate: stripeFee.date.split("T")[0],
        amountMinor: BigInt(stripeFee.bankAmt),
        currency: "INR",
        description: "Stripe Payout - INV003 (Net)",
        sourceTransactionId: "seed-bank-stripe-fee",
        metadata: { source: "Stripe", layout: "stripe_export" },
      },
      {
        organizationId: orgId,
        accountId: stripeAccountId,
        side: "money" as const,
        direction: "inflow" as const,
        status: "AVAILABLE" as const,
        transactionDate: partialPayment.date.split("T")[0],
        amountMinor: BigInt(partialPayment.bankAmt),
        currency: "INR",
        description: "Stripe Partial - INV004",
        sourceTransactionId: "seed-bank-partial",
        metadata: { source: "Stripe", layout: "stripe_export" },
      },
      {
        organizationId: orgId,
        accountId: bankAccountId,
        side: "money" as const,
        direction: "inflow" as const,
        status: "AVAILABLE" as const,
        transactionDate: missingInvoice.date.split("T")[0],
        amountMinor: BigInt(missingInvoice.bankAmt),
        currency: "INR",
        description: "Direct Bank Transfer - Unknown",
        sourceTransactionId: "seed-bank-missing-invoice",
        metadata: { source: "Bank", layout: "bank_csv" },
      },
    ];

    const ledgerSeed = [
      {
        organizationId: orgId,
        accountId: qboAccountId,
        side: "books" as const,
        direction: "inflow" as const,
        status: "AVAILABLE" as const,
        transactionDate: exact1.date.split("T")[0],
        amountMinor: BigInt(exact1.amount),
        currency: "INR",
        description: "Invoice #001",
        referenceNumber: "INV001",
        sourceTransactionId: "seed-ledger-exact1",
        metadata: { source: "quickbooks", layout: "qbo_export" },
      },
      {
        organizationId: orgId,
        accountId: qboAccountId,
        side: "books" as const,
        direction: "inflow" as const,
        status: "AVAILABLE" as const,
        transactionDate: exact2.date.split("T")[0],
        amountMinor: BigInt(exact2.amount),
        currency: "INR",
        description: "Invoice #002",
        referenceNumber: "INV002",
        sourceTransactionId: "seed-ledger-exact2",
        metadata: { source: "quickbooks", layout: "qbo_export" },
      },
      {
        organizationId: orgId,
        accountId: qboAccountId,
        side: "books" as const,
        direction: "inflow" as const,
        status: "AVAILABLE" as const,
        transactionDate: stripeFee.date.split("T")[0],
        amountMinor: BigInt(stripeFee.ledgerAmt),
        currency: "INR",
        description: "Invoice #003",
        referenceNumber: "INV003",
        sourceTransactionId: "seed-ledger-stripe-fee",
        metadata: { source: "quickbooks", layout: "qbo_export" },
      },
      {
        organizationId: orgId,
        accountId: qboAccountId,
        side: "books" as const,
        direction: "inflow" as const,
        status: "AVAILABLE" as const,
        transactionDate: partialPayment.date.split("T")[0],
        amountMinor: BigInt(partialPayment.ledgerAmt),
        currency: "INR",
        description: "Invoice #004",
        referenceNumber: "INV004",
        sourceTransactionId: "seed-ledger-partial",
        metadata: { source: "quickbooks", layout: "qbo_export" },
      },
      {
        organizationId: orgId,
        accountId: qboAccountId,
        side: "books" as const,
        direction: "inflow" as const,
        status: "AVAILABLE" as const,
        transactionDate: missingBank.date.split("T")[0],
        amountMinor: BigInt(missingBank.ledgerAmt),
        currency: "INR",
        description: "Invoice #005 - Pending",
        referenceNumber: "INV005",
        sourceTransactionId: "seed-ledger-missing-bank",
        metadata: { source: "quickbooks", layout: "qbo_export" },
      },
    ];

    const finalBankSeed = bankSeed.map(b => ({
      ...b,
      sourceSystem: b.accountId === stripeAccountId ? ("stripe" as const) : ("bank" as const),
      transactionDate: new Date(b.transactionDate),
      metadata: {},
    }));

    const finalLedgerSeed = ledgerSeed.map(l => ({
      ...l,
      sourceSystem: "quickbooks" as const,
      transactionDate: new Date(l.transactionDate),
      metadata: {},
    }));

    await db.insert(canonicalTransactions).values([...finalBankSeed, ...finalLedgerSeed]);

    return NextResponse.json({ 
      success: true, 
      message: `Successfully seeded ${bankSeed.length} bank transactions and ${ledgerSeed.length} ledger entries into canonical transactions.` 
    });

  } catch (error: any) {
    console.error("Seed Error:", error);
    return NextResponse.json({ error: error.message || "Failed to seed database" }, { status: 500 });
  }
}
