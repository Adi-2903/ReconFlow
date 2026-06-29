import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/core/db";
import { organizations, imports as dbImports } from "@/core/db/schema";
import { getOrCreateUserOrganization } from "@/core/db/org-helper";
import { eq, inArray } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const orgId = await getOrCreateUserOrganization(userId);
    
    const org = await db.select({
      activeBankImportId: organizations.activeBankImportId,
      activeLedgerImportId: organizations.activeLedgerImportId,
      activePeriodStart: organizations.activePeriodStart,
      activePeriodEnd: organizations.activePeriodEnd,
    }).from(organizations).where(eq(organizations.id, orgId)).limit(1);

    if (!org.length) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const activeIds = [];
    if (org[0].activeBankImportId) activeIds.push(org[0].activeBankImportId);
    if (org[0].activeLedgerImportId) activeIds.push(org[0].activeLedgerImportId);

    let activeBank = null;
    let activeLedger = null;

    if (activeIds.length > 0) {
      const activeImports = await db.select().from(dbImports).where(inArray(dbImports.id, activeIds));
      activeBank = activeImports.find(i => i.id === org[0].activeBankImportId) || null;
      activeLedger = activeImports.find(i => i.id === org[0].activeLedgerImportId) || null;
    }

    return NextResponse.json({
      bank: activeBank ? {
        id: activeBank.id,
        filename: activeBank.filename,
        uploadedAt: activeBank.createdAt,
        transactionCount: activeBank.successCount || activeBank.rowCount || 0,
        fileType: activeBank.sourceType
      } : null,
      ledger: activeLedger ? {
        id: activeLedger.id,
        filename: activeLedger.filename,
        uploadedAt: activeLedger.createdAt,
        transactionCount: activeLedger.successCount || activeLedger.rowCount || 0,
        fileType: activeLedger.sourceType
      } : null,
      periodStart: org[0].activePeriodStart,
      periodEnd: org[0].activePeriodEnd
    });
  } catch (error: any) {
    console.error("Fetch Active Session Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch active session." },
      { status: 500 }
    );
  }
}
