import { db } from "@/core/db";
import { bankTransactions, users } from "@/core/db/schema";
import { eq } from "drizzle-orm";
import Stripe from "stripe";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StripeSyncResult {
  count: number;
  message: string;
}

export interface StripeDisconnectResult {
  success: boolean;
}

// ─── Service functions ────────────────────────────────────────────────────────

export async function syncStripeTransactions(userId: string): Promise<StripeSyncResult> {
  const [user] = await db
    .select({ stripeAccessToken: users.stripeAccessToken, stripeUserId: users.stripeUserId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user?.stripeAccessToken) {
    throw Object.assign(
      new Error("Stripe not connected. Go to the Connect page and link your Stripe account."),
      { statusCode: 401 }
    );
  }

  // Use the platform secret key targeting the user's connected account
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: "2026-05-27.dahlia",
  });

  const balanceTransactions = await stripe.balanceTransactions.list(
    { limit: 100, expand: ["data.source"] },
    { stripeAccount: user.stripeUserId! }
  );

  if (balanceTransactions.data.length === 0) {
    return { count: 0, message: "No transactions found in this Stripe account" };
  }

  const newTxns = balanceTransactions.data.map((bt) => {
    let description = bt.description || `Stripe ${bt.type}`;
    const sourceObj = bt.source as any;
    if (sourceObj) {
      if (bt.type === "charge" && sourceObj.receipt_email) {
        description = `Stripe Charge - ${sourceObj.receipt_email}`;
      } else if (bt.type === "payout") {
        description = "Stripe Payout to Bank";
      }
    }

    return {
      userId,
      amount: bt.amount.toString(),
      date: new Date(bt.created * 1000).toISOString(),
      description,
      referenceId: bt.id,
      source: "Stripe",
      status: "unmatched",
    };
  });

  // Idempotent upsert — safe to call multiple times
  await db.insert(bankTransactions).values(newTxns).onConflictDoNothing();
  await db.update(users).set({ stripeLastSync: new Date() }).where(eq(users.id, userId));

  return { count: newTxns.length, message: "Sync successful" };
}

export async function disconnectStripe(userId: string): Promise<StripeDisconnectResult> {
  await db
    .update(users)
    .set({ stripeAccessToken: null, stripeUserId: null })
    .where(eq(users.id, userId));

  return { success: true };
}
