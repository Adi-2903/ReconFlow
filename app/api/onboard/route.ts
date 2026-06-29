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

    // Set onboarded to true in the database
    await db
      .update(users)
      .set({ onboarded: true })
      .where(eq(users.id, userId));

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Onboarding API error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to finalize onboarding" },
      { status: 500 }
    );
  }
}
