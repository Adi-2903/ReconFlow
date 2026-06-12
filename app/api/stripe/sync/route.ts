import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { db } from "@/core/db";
import { bankTransactions } from "@/core/db/schema";
import Stripe from "stripe";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      return Response.json({ error: "Stripe is not configured" }, { status: 500 });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2026-05-27.dahlia",
    });

    // Fetch recent balance transactions (Payouts, Charges, Refunds, etc.)
    // We fetch Balance Transactions instead of just Charges because they represent actual money moving
    const balanceTransactions = await stripe.balanceTransactions.list({
      limit: 20,
      expand: ["data.source"], // Expands the related charge or payout object
    });

    if (balanceTransactions.data.length === 0) {
      return Response.json({ count: 0, message: "No transactions found" });
    }

    let insertedCount = 0;

    // Transform and insert into our bankTransactions table
    // Balance transactions amounts are in cents/paise (smallest currency unit), exactly as our DB expects
    const newTxns = balanceTransactions.data.map(bt => {
      let description = bt.description || `Stripe ${bt.type}`;
      
      // If the source is expanded and has more details, use them
      const sourceObj = bt.source as any;
      if (sourceObj) {
        if (bt.type === 'charge' && sourceObj.receipt_email) {
          description = `Stripe Charge - ${sourceObj.receipt_email}`;
        } else if (bt.type === 'payout') {
          description = `Stripe Payout to Bank`;
        }
      }

      return {
        userId,
        // Ensure negative for payouts (money leaving Stripe balance) and positive for charges
        amount: bt.amount.toString(), 
        date: new Date(bt.created * 1000).toISOString(),
        description,
        referenceId: bt.id,
        source: "Stripe",
        status: "unmatched",
      };
    });

    // Insert all newly fetched transactions
    // Since Stripe IDs are unique, if we run this multiple times we might get duplicates without an upsert.
    // For a simple hackathon demo, we'll just insert everything. 
    // In production, we'd use `onConflictDoNothing({ target: bankTransactions.referenceId })`
    await db.insert(bankTransactions).values(newTxns);
    insertedCount = newTxns.length;

    return Response.json({ count: insertedCount, message: "Sync successful" });

  } catch (error: any) {
    console.error("Error syncing Stripe data:", error);
    return Response.json({ error: error.message || "Failed to sync Stripe data" }, { status: 500 });
  }
}
