import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/core/db";
import { imports as dbImports } from "@/core/db/schema";
import { getOrCreateUserOrganization } from "@/core/db/org-helper";
import { eq, desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const orgId = await getOrCreateUserOrganization(userId);

    const history = await db
      .select()
      .from(dbImports)
      .where(eq(dbImports.organizationId, orgId))
      .orderBy(desc(dbImports.createdAt));

    return NextResponse.json(history);
  } catch (error: any) {
    console.error("Fetch Upload History Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch upload history." },
      { status: 500 }
    );
  }
}
