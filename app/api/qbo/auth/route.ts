import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import OAuthClient from "intuit-oauth";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      console.error("[QBO_AUTH_ROUTE] Unauthorized error. Session:", JSON.stringify(session, null, 2));
      return NextResponse.json({ error: "Unauthorized", details: "No active session or user ID found" }, { status: 401 });
    }

    const oauthClient = new OAuthClient({
      clientId: process.env.QBO_CLIENT_ID as string,
      clientSecret: process.env.QBO_CLIENT_SECRET as string,
      environment: (process.env.QBO_ENVIRONMENT || "sandbox") as any,
      redirectUri: `${req.nextUrl.origin}/api/qbo/callback`,
    });

    const authUri = oauthClient.authorizeUri({
      scope: [OAuthClient.scopes.Accounting],
      state: userId, // Pass userId in state to identify them in the callback
    });

    return NextResponse.redirect(authUri);
  } catch (error) {
    console.error("Error generating QBO auth URI:", error);
    return NextResponse.json({ error: "Failed to initiate QuickBooks connection" }, { status: 500 });
  }
}
