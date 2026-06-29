import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { db } from "@/core/db";
import { auditEvents, matches } from "@/core/db/schema";
import { eq, desc, and, count } from "drizzle-orm";

/**
 * GET /api/audit-logs
 *
 * Returns the full audit trail for matches belonging to the authenticated user.
 *
 * Query params:
 *   matchId  — (optional) filter to a specific match's audit events
 *   limit    — default 100, max 500
 *   offset   — default 0
 *
 * Response:
 *   { data: AuditLogEntry[]; total: number }
 */

interface AuditLogEntry {
  id: string;
  matchId: string | null;
  action: string;
  actorEmail: string | null;
  reason: string | null;
  timestamp: string;
  metadata: any;
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = req.nextUrl;
    const matchId = searchParams.get("matchId") || undefined;
    const rawLimit = parseInt(searchParams.get("limit") || "100", 10);
    const limit = Math.min(Math.max(1, Number.isNaN(rawLimit) ? 100 : rawLimit), 500);
    const rawOffset = parseInt(searchParams.get("offset") || "0", 10);
    const offset = Math.max(0, Number.isNaN(rawOffset) ? 0 : rawOffset);

    // Build the where clause. Always scope to the requesting user's matches.
    const conditions = [eq(auditEvents.userId, userId)];
    if (matchId) {
      conditions.push(eq(auditEvents.matchId, matchId));
    }

    // F-08: Run COUNT(*) with the same conditions before fetching the page.
    // This returns the real total number of matching audit events so the caller
    // can compute page counts correctly, without loading every row into memory.
    const [{ total }] = await db
      .select({ total: count() })
      .from(auditEvents)
      .where(and(...conditions));

    const rows = await db
      .select()
      .from(auditEvents)
      .where(and(...conditions))
      .orderBy(desc(auditEvents.timestamp))
      .limit(limit)
      .offset(offset);

    const data: AuditLogEntry[] = rows.map((row) => ({
      id: row.id,
      matchId: row.matchId ?? null,
      action: row.action,
      actorEmail: row.actorEmail ?? null,
      reason: row.reason ?? null,
      timestamp:
        row.timestamp instanceof Date
          ? row.timestamp.toISOString()
          : String(row.timestamp),
      metadata: row.metadata ?? null,
    }));

    return Response.json({ data, total });
  } catch (error) {
    console.error("Audit logs error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
