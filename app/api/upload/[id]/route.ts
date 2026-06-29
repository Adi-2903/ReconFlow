import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/core/db";
import { 
  imports as dbImports, 
  rawRecords, 
  canonicalTransactions,
  transactionCandidates,
  matchItems,
  matchGroups,
  matches,
  auditLogs,
  reconciliationRunTransactions,
  organizations
} from "@/core/db/schema";
import { getOrCreateUserOrganization } from "@/core/db/org-helper";
import { eq, inArray, or, and } from "drizzle-orm";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: importId } = await params;
    if (!importId) {
      return NextResponse.json({ error: "Import ID is required" }, { status: 400 });
    }

    const force = req.nextUrl.searchParams.get("force") === "true";
    const orgId = await getOrCreateUserOrganization(userId);

    // Verify the import belongs to the user's organization
    const importRecord = await db
      .select()
      .from(dbImports)
      .where(
        and(
          eq(dbImports.id, importId),
          eq(dbImports.organizationId, orgId)
        )
      )
      .limit(1);

    if (importRecord.length === 0) {
      return NextResponse.json({ error: "Import not found" }, { status: 404 });
    }

    // Find all canonical transactions associated with this import
    const txns = await db.select({ id: canonicalTransactions.id })
      .from(canonicalTransactions)
      .innerJoin(rawRecords, eq(canonicalTransactions.rawRecordId, rawRecords.id))
      .where(eq(rawRecords.importId, importId));

    const txnIds = txns.map(t => t.id);

    if (txnIds.length > 0) {
      // Check for existing matches (reconciliation guard)
      const existingMatches = await db.select({ id: matchItems.id }).from(matchItems).where(inArray(matchItems.transactionId, txnIds)).limit(1);
      
      if (existingMatches.length > 0 && !force) {
        return NextResponse.json(
          { error: "This file is actively participating in a reconciliation. Deleting it will remove the associated reconciliation history." }, 
          { status: 409 }
        );
      }

      // Delete dependent records first to avoid foreign key constraints
      
      // 1. Matches (legacy table)
      await db.delete(matches)
        .where(inArray(matches.bankTransactionId, txnIds));

      // 2. Audit logs
      await db.delete(auditLogs)
        .where(inArray(auditLogs.entityId, txnIds));

      // 3. Match Items & Match Groups
      // Find match groups that will be affected
      const affectedMatchItems = await db.select({ matchGroupId: matchItems.matchGroupId })
        .from(matchItems)
        .where(inArray(matchItems.transactionId, txnIds));
        
      const matchGroupIdsToCheck = [...new Set(affectedMatchItems.map(m => m.matchGroupId))];

      await db.delete(matchItems)
        .where(inArray(matchItems.transactionId, txnIds));

      if (matchGroupIdsToCheck.length > 0) {
        // Find which ones still have items
        const groupsWithItems = await db.selectDistinct({ matchGroupId: matchItems.matchGroupId })
          .from(matchItems)
          .where(inArray(matchItems.matchGroupId, matchGroupIdsToCheck));
          
        const groupsWithItemsSet = new Set(groupsWithItems.map(g => g.matchGroupId));
        const orphanedGroupIds = matchGroupIdsToCheck.filter(id => !groupsWithItemsSet.has(id));
        
        if (orphanedGroupIds.length > 0) {
          await db.delete(matchGroups).where(inArray(matchGroups.id, orphanedGroupIds));
        }
      }

      // 4. Transaction Candidates
      await db.delete(transactionCandidates)
        .where(or(
          inArray(transactionCandidates.sourceTransactionId, txnIds),
          inArray(transactionCandidates.candidateTransactionId, txnIds)
        ));

      // 5. Reconciliation Run Transactions
      await db.delete(reconciliationRunTransactions)
        .where(inArray(reconciliationRunTransactions.transactionId, txnIds));

      // Now delete the canonical transactions
      await db.delete(canonicalTransactions)
        .where(inArray(canonicalTransactions.id, txnIds));
    }

    // Delete raw records
    await db.delete(rawRecords)
      .where(eq(rawRecords.importId, importId));

    // Finally, delete the import record itself
    await db.delete(dbImports)
      .where(eq(dbImports.id, importId));

    // Clear active session references if they match
    const orgData = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (orgData.length > 0) {
      const updateData: any = {};
      if (orgData[0].activeBankImportId === importId) updateData.activeBankImportId = null;
      if (orgData[0].activeLedgerImportId === importId) updateData.activeLedgerImportId = null;
      if (Object.keys(updateData).length > 0) {
        await db.update(organizations).set(updateData).where(eq(organizations.id, orgId));
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Delete Upload Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete upload." },
      { status: 500 }
    );
  }
}
