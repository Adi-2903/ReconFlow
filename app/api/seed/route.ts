import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/core/db";
import { bankTransactions, ledgerEntries, matches } from "@/core/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 1. Clear existing data for this user
    await db.delete(matches).where(eq(matches.userId, userId));
    await db.delete(bankTransactions).where(eq(bankTransactions.userId, userId));
    await db.delete(ledgerEntries).where(eq(ledgerEntries.userId, userId));

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

    const bankSeed = [
      { userId, amount: exact1.amount, date: exact1.date, description: "Stripe Payout - INV001", source: "Stripe", status: "unmatched" },
      { userId, amount: exact2.amount, date: exact2.date, description: "Stripe Payout - INV002", source: "Stripe", status: "unmatched" },
      { userId, amount: stripeFee.bankAmt, date: stripeFee.date, description: "Stripe Payout - INV003 (Net)", source: "Stripe", status: "unmatched" },
      { userId, amount: partialPayment.bankAmt, date: partialPayment.date, description: "Stripe Partial - INV004", source: "Stripe", status: "unmatched" },
      { userId, amount: missingInvoice.bankAmt, date: missingInvoice.date, description: "Direct Bank Transfer - Unknown", source: "Bank", status: "unmatched" },
    ];

    const ledgerSeed = [
      { userId, amount: exact1.amount, date: exact1.date, memo: "Invoice #001", invoiceRef: "INV001", source: "quickbooks", status: "unmatched" },
      { userId, amount: exact2.amount, date: exact2.date, memo: "Invoice #002", invoiceRef: "INV002", source: "quickbooks", status: "unmatched" },
      { userId, amount: stripeFee.ledgerAmt, date: stripeFee.date, memo: "Invoice #003", invoiceRef: "INV003", source: "quickbooks", status: "unmatched" },
      { userId, amount: partialPayment.ledgerAmt, date: partialPayment.date, memo: "Invoice #004", invoiceRef: "INV004", source: "quickbooks", status: "unmatched" },
      { userId, amount: missingBank.ledgerAmt, date: missingBank.date, memo: "Invoice #005 - Pending", invoiceRef: "INV005", source: "quickbooks", status: "unmatched" },
    ];

    await db.insert(bankTransactions).values(bankSeed);
    await db.insert(ledgerEntries).values(ledgerSeed);

    return NextResponse.json({ 
      success: true, 
      message: `Successfully seeded ${bankSeed.length} bank transactions and ${ledgerSeed.length} ledger entries.` 
    });

  } catch (error: any) {
    console.error("Seed Error:", error);
    return NextResponse.json({ error: error.message || "Failed to seed database" }, { status: 500 });
  }
}
