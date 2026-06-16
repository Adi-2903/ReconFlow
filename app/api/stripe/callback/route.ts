import { NextRequest, NextResponse } from "next/server";
import { db } from "@/core/db";
import { users } from "@/core/db/schema";
import { eq } from "drizzle-orm";

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

    // Save the user's Stripe credentials to their DB row
    await db
      .update(users)
      .set({
        stripeAccessToken: tokenData.access_token,
        stripeUserId: tokenData.stripe_user_id,
      })
      .where(eq(users.id, userId));

    return NextResponse.redirect(new URL("/connect?stripe_connected=true", req.url));
  } catch (error) {
    console.error("Error in Stripe Connect callback:", error);
    return NextResponse.redirect(new URL("/connect?stripe_error=true", req.url));
  }
}
