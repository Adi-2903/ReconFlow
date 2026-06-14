import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/core/db";
import { users } from "@/core/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await db.update(users).set({
      qboAccessToken: null,
      qboRefreshToken: null,
      qboRealmId: null,
      qboTokenExpiresAt: null,
    }).where(eq(users.id, userId));

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error disconnecting QBO:", error);
    return NextResponse.json({ error: error.message || "Failed to disconnect" }, { status: 500 });
  }
}
