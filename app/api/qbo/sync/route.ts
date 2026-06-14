import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/core/db";
import { users, ledgerEntries } from "@/core/db/schema";
import { eq } from "drizzle-orm";
import OAuthClient from "intuit-oauth";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      console.error("[QBO_SYNC_ROUTE] Unauthorized error. Session:", JSON.stringify(session, null, 2));
      return NextResponse.json({ error: "Unauthorized", details: "No active session or user ID found" }, { status: 401 });
    }

    // Fetch user to get QBO tokens
    const [user] = await db.select().from(users).where(eq(users.id, userId));

    if (!user || !user.qboAccessToken || !user.qboRealmId) {
      return NextResponse.json({ error: "QuickBooks is not connected" }, { status: 400 });
    }

    const oauthClient = new OAuthClient({
      clientId: process.env.QBO_CLIENT_ID as string,
      clientSecret: process.env.QBO_CLIENT_SECRET as string,
      environment: (process.env.QBO_ENVIRONMENT || "sandbox") as any,
      redirectUri: `${req.nextUrl.origin}/api/qbo/callback`,
    });

    // We must manually set the token on the client
    oauthClient.setToken({
      access_token: user.qboAccessToken,
      refresh_token: user.qboRefreshToken || "",
      realmId: user.qboRealmId as string,
    });

    // Check if token needs refresh (if close to expiry)
    if (user.qboTokenExpiresAt && new Date() > new Date(user.qboTokenExpiresAt.getTime() - 5 * 60000)) {
      try {
        const authResponse = await oauthClient.refresh();
        const tokenData = authResponse.getJson();
        const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

        await db.update(users).set({
          qboAccessToken: tokenData.access_token,
          qboRefreshToken: tokenData.refresh_token,
          qboTokenExpiresAt: expiresAt,
        }).where(eq(users.id, userId));

      } catch (refreshErr) {
        console.error("Failed to refresh QBO token:", refreshErr);
        return NextResponse.json({ error: "QuickBooks session expired. Please reconnect." }, { status: 401 });
      }
    }

    // Fetch Invoices and Deposits using QBO API
    const query = `select * from Invoice maxresults 15`;
    const qboResponse = await oauthClient.makeApiCall({
      url: `${oauthClient.environment == 'sandbox' ? OAuthClient.environment.sandbox : OAuthClient.environment.production}v3/company/${user.qboRealmId}/query?query=${encodeURIComponent(query)}`,
      method: "GET"
    });

    const qboData = typeof (qboResponse as any).json === 'function' 
      ? await (qboResponse as any).json() 
      : (qboResponse as any).data;
    const invoices = qboData?.QueryResponse?.Invoice || [];

    if (invoices.length === 0) {
      return NextResponse.json({ count: 0, message: "No invoices found in QuickBooks" });
    }

    // Map QBO Invoices to our ledgerEntries schema
    const newLedgers = invoices.map((inv: any) => {
      const amountPaise = Math.round(Number(inv.TotalAmt) * 100).toString();

      return {
        userId,
        amount: amountPaise,
        date: inv.TxnDate || new Date().toISOString().split('T')[0],
        memo: inv.CustomerRef?.name ? `Invoice for ${inv.CustomerRef.name}` : "QuickBooks Invoice",
        invoiceRef: inv.DocNumber || inv.Id,
        status: "unmatched",
      };
    });

    // Insert into ledgerEntries
    await db.insert(ledgerEntries).values(newLedgers);

    return NextResponse.json({ count: newLedgers.length, message: "Sync successful" });

  } catch (error: any) {
    console.error("Error syncing QBO data:", error);
    return NextResponse.json({ 
      error: error.message || "Failed to sync QuickBooks data",
      stack: error.stack,
      details: error.response?.data || error
    }, { status: 500 });
  }
}
