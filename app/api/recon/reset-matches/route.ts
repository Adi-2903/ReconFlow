import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { resetMatches } from "@/services/settings.service";

export async function POST() {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await resetMatches(userId);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Error resetting matches:", error);
    return NextResponse.json(
      { error: error.message || "Failed to reset matches" },
      { status: 500 }
    );
  }
}
