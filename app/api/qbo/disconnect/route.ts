import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { disconnectQbo } from "@/services/qbo.service";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const result = await disconnectQbo(userId);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Error disconnecting QBO:", error);
    return NextResponse.json({ error: error.message || "Failed to disconnect" }, { status: 500 });
  }
}
