import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const clientId = process.env.STRIPE_CLIENT_ID;
    if (!clientId) {
      return NextResponse.json(
        { error: "Stripe Connect is not configured. Add STRIPE_CLIENT_ID to .env" },
        { status: 500 }
      );
    }

    const redirectUri = `${req.nextUrl.origin}/api/stripe/callback`;

    // Build Stripe Connect OAuth URL
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      scope: "read_write",          // read-write access to their Stripe account
      redirect_uri: redirectUri,
      state: userId,                // passed back in callback to identify the user
    });

    const stripeOAuthUrl = `https://connect.stripe.com/oauth/authorize?${params.toString()}`;

    return NextResponse.redirect(stripeOAuthUrl);
  } catch (error) {
    console.error("Error generating Stripe Connect auth URL:", error);
    return NextResponse.json(
      { error: "Failed to initiate Stripe connection" },
      { status: 500 }
    );
  }
}
