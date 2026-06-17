import { db } from "@/core/db";
import { connectors as dbConnectors } from "@/core/db/schema";
import { eq, and } from "drizzle-orm";
import Stripe from "stripe";
import { Connector, NormalizedConnectorRecord } from "./connector.interface";

export class StripeConnector implements Connector {
  async connect(userId: string, orgId: string, accountId: string, params?: any): Promise<any> {
    const clientId = process.env.STRIPE_CLIENT_ID;
    if (!clientId) {
      throw new Error("Stripe Connect is not configured. Add STRIPE_CLIENT_ID to .env");
    }

    const appBaseUrl = params?.appBaseUrl || "http://localhost:3000";
    const redirectUri = `${appBaseUrl}/api/stripe/callback`;

    const oauthParams = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      scope: "read_write",
      redirect_uri: redirectUri,
      state: `${userId}:${orgId}:${accountId}`,
    });

    const authUri = `https://connect.stripe.com/oauth/authorize?${oauthParams.toString()}`;
    return { authUri };
  }

  async disconnect(userId: string, orgId: string, accountId: string): Promise<any> {
    await db
      .update(dbConnectors)
      .set({
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
        status: "disconnected",
      })
      .where(
        and(
          eq(dbConnectors.organizationId, orgId),
          eq(dbConnectors.accountId, accountId)
        )
      );
    return { success: true };
  }

  async sync(userId: string, orgId: string, accountId: string, params?: any): Promise<NormalizedConnectorRecord[]> {
    const [conn] = await db
      .select()
      .from(dbConnectors)
      .where(
        and(
          eq(dbConnectors.organizationId, orgId),
          eq(dbConnectors.accountId, accountId)
        )
      )
      .limit(1);

    if (!conn || !conn.accessToken) {
      throw new Error("Stripe not connected for this account.");
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2026-05-27.dahlia", // Matches original API version
    });

    // Stripe accounts connected via OAuth require passing the user's stripe account ID
    // We store this user/account ID in standard connector configuration or settings
    const stripeUserId = (conn.settings as any)?.stripeUserId || conn.refreshToken; // Use refreshToken or settings parameter if it contains stripeUserId

    const balanceTransactions = await stripe.balanceTransactions.list(
      { limit: 100, expand: ["data.source"] },
      { stripeAccount: stripeUserId || undefined }
    );

    const records: NormalizedConnectorRecord[] = [];

    balanceTransactions.data.forEach((bt) => {
      const date = new Date(bt.created * 1000);
      const currency = bt.currency.toUpperCase();

      if (bt.type === "charge" || bt.type === "payment") {
        // 1. Map Charge
        let description = bt.description || "Stripe Charge";
        const sourceObj = bt.source as any;
        if (sourceObj && sourceObj.receipt_email) {
          description = `Stripe Charge - ${sourceObj.receipt_email}`;
        }
        records.push({
          sourceTransactionId: bt.id,
          transactionDate: date,
          amountMinor: BigInt(bt.amount), // positive value
          currency,
          description,
          transactionType: "CHARGE",
        });

        // 2. Map Stripe Fee (if present)
        if (bt.fee > 0) {
          records.push({
            sourceTransactionId: `fee_${bt.id}`,
            transactionDate: date,
            amountMinor: BigInt(-bt.fee), // negative value
            currency,
            description: `Stripe Fee for Charge ${bt.id}`,
            transactionType: "FEE",
          });
        }
      } else if (bt.type === "refund" || bt.type === "payment_refund") {
        // 3. Map Refund (always negative amount change on balance)
        records.push({
          sourceTransactionId: bt.id,
          transactionDate: date,
          amountMinor: BigInt(bt.amount),
          currency,
          description: bt.description || "Stripe Refund",
          transactionType: "REFUND",
        });
      } else if (bt.type === "payout" || bt.type === "payout_failure") {
        // 4. Map Payout
        records.push({
          sourceTransactionId: bt.id,
          transactionDate: date,
          amountMinor: BigInt(bt.amount), // negative value since moving out of Stripe balance
          currency,
          description: "Stripe Payout to Bank",
          transactionType: "PAYOUT",
        });
      } else {
        // Generic fall-through for other balance types (adjustment, transfer, etc.)
        records.push({
          sourceTransactionId: bt.id,
          transactionDate: date,
          amountMinor: BigInt(bt.amount),
          currency,
          description: bt.description || `Stripe Transaction (${bt.type})`,
          transactionType: bt.type.toUpperCase(),
        });
      }
    });

    return records;
  }
}
