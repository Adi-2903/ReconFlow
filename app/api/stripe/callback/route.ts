import { NextRequest, NextResponse } from "next/server";
import { db } from "@/core/db";
import { connectors } from "@/core/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrCreateUserOrganization, getOrCreateFinancialAccount } from "@/core/db/org-helper";

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const code = searchParams.get("code");
    const userId = searchParams.get("state");   // we passed userId as state
    const error = searchParams.get("error");

    // User denied access on Stripe's side
    if (error) {
      console.error("Stripe Connect OAuth error:", error);
      return NextResponse.redirect(new URL("/connect?stripe_error=true", req.url));
    }

    if (!code || !userId) {
      return NextResponse.json({ error: "Missing required OAuth parameters" }, { status: 400 });
    }

    // Exchange the authorization code for an access token
    const tokenResponse = await fetch("https://connect.stripe.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_secret: process.env.STRIPE_SECRET_KEY!,  // our platform secret key
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json();
      console.error("Stripe token exchange failed:", errorData);
      return NextResponse.redirect(new URL("/connect?stripe_error=true", req.url));
    }

    const tokenData = await tokenResponse.json();
    // tokenData contains: access_token, stripe_user_id (acct_...), scope, token_type

    // Resolve tenant and account context
    const orgId = await getOrCreateUserOrganization(userId);
    const accountId = await getOrCreateFinancialAccount(orgId, "stripe", "Stripe Account");

    // Save the user's Stripe credentials to the connectors table
    const [existing] = await db
      .select()
      .from(connectors)
      .where(and(eq(connectors.organizationId, orgId), eq(connectors.accountId, accountId)))
      .limit(1);

    if (existing) {
      await db
        .update(connectors)
        .set({
          accessToken: tokenData.access_token,
          status: "connected",
          settings: { stripeUserId: tokenData.stripe_user_id },
        })
        .where(eq(connectors.id, existing.id));
    } else {
      await db
        .insert(connectors)
        .values({
          organizationId: orgId,
          accountId: accountId,
          connectorType: "stripe",
          accessToken: tokenData.access_token,
          status: "connected",
          settings: { stripeUserId: tokenData.stripe_user_id },
        });
    }

    return NextResponse.redirect(new URL("/connect?stripe_connected=true", req.url));
  } catch (error) {
    console.error("Error in Stripe Connect callback:", error);
    return NextResponse.redirect(new URL("/connect?stripe_error=true", req.url));
  }
}
