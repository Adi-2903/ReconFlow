import { NextRequest, NextResponse } from "next/server";
import { db } from "@/core/db";
import { users } from "@/core/db/schema";
import { eq } from "drizzle-orm";
import OAuthClient from "intuit-oauth";

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const authCode = searchParams.get("code");
    const realmId = searchParams.get("realmId");
    const userId = searchParams.get("state"); // We passed userId in the state parameter

    if (!authCode || !realmId || !userId) {
      return NextResponse.json({ error: "Missing required OAuth parameters" }, { status: 400 });
    }

    const oauthClient = new OAuthClient({
      clientId: process.env.QBO_CLIENT_ID as string,
      clientSecret: process.env.QBO_CLIENT_SECRET as string,
      environment: (process.env.QBO_ENVIRONMENT || "sandbox") as any,
      redirectUri: `${req.nextUrl.origin}/api/qbo/callback`,
    });

    // Exchange the code for tokens
    const authResponse = await oauthClient.createToken(req.url);
    const tokenData = authResponse.getJson();

    // Calculate expiry
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

    // Save tokens securely in the database
    await db
      .update(users)
      .set({
        qboAccessToken: tokenData.access_token,
        qboRefreshToken: tokenData.refresh_token,
        qboRealmId: realmId,
        qboTokenExpiresAt: expiresAt,
      })
      .where(eq(users.id, userId));

    // Redirect the user back to the connect page with a success parameter
    return NextResponse.redirect(new URL("/connect?qbo_connected=true", req.url));
  } catch (error: any) {
    console.error("==========================================");
    console.error("Error in QBO callback:", error);
    if (error?.authResponse) {
      console.error("QBO AuthResponse JSON:", error.authResponse.getJson());
    }
    console.error("==========================================");
    return NextResponse.redirect(new URL("/connect?qbo_error=true", req.url));
  }
}
