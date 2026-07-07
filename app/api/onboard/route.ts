import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/core/db";
import { users } from "@/core/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    console.log("[onboard] POST called");
    console.log("[onboard] AUTH_SECRET set:", !!process.env.AUTH_SECRET);
    console.log("[onboard] AUTH_URL:", process.env.AUTH_URL || process.env.NEXTAUTH_URL || "NOT SET");

    const session = await auth();
    console.log("[onboard] session:", JSON.stringify(session));

    const userId = session?.user?.id;
    console.log("[onboard] userId:", userId);

    if (!userId) {
      console.error("[onboard] No userId in session — returning 401");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Set onboarded to true in the database
    await db
      .update(users)
      .set({ onboarded: true })
      .where(eq(users.id, userId));

    console.log("[onboard] Successfully set onboarded=true for userId:", userId);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[onboard] API error:", error?.message, error?.stack);
    return NextResponse.json(
      { error: error.message || "Failed to finalize onboarding" },
      { status: 500 }
    );
  }
}
