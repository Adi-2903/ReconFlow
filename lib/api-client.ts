/**
 * api-client.ts — Frontend API client
 *
 * All fetch() calls to the backend go through here.
 * Frontend engineers: use this. Never write raw fetch("/api/...") in components.
 *
 * Backend engineers: your API routes are thin wrappers around /services/*.
 * Do NOT import from this file in service files.
 */

// ─── Types (mirrors what services return) ─────────────────────────────────────

export interface ReconCounts {
  bankTransactions: number;
  stripeTransactions: number;
  ledgerEntries: number;
  qboConnected: boolean;
  stripeConnected: boolean;
  qboLastSync: string | null;
  stripeLastSync: string | null;
}

export interface ReconRunBody {
  periodStart: string;
  periodEnd: string;
}

export interface ReconStats {
  total: number;
  autoMatched: number;
  needsReview: number;
  exceptions: number;
}

export interface ReconRunResult {
  runId: string | null;
  stats: ReconStats;
  message?: string;
}

export interface MatchListItem {
  id: string;
  bankRow: { amount: number; date: string; description: string; referenceId: string; source: string };
  ledgerRows: { amount: number; date: string; memo: string; invoiceRef: string }[];
  ledgerRow: { amount: number; date: string; memo: string; invoiceRef: string } | null;
  confidenceScore: number;
  matchType: string | null;
  reasonText: string;
  scoringBreakdown: { amountScore: number; dateScore: number; textScore: number };
  status: string | null;
}

export interface ExceptionItem {
  id: string;
  amount: number;
  date: string;
  source: string;
  reference: string;
  reasonTag: string;
  reasonText: string;
  flags: string[];
}

export interface ExceptionsResult {
  exceptions: ExceptionItem[];
  count: number;
}

export interface ReportStats {
  total: string;
  autoMatched: string;
  manualReview: string;
  exceptions: string;
  percentage: string;
}

export interface ReportSummaryResult {
  stats: ReportStats;
  topExceptions: {
    id: string;
    amount: number;
    date: string;
    source: string;
    reasonTag: string;
    status: string;
    statusColor: string;
  }[];
}

// ─── Helper ───────────────────────────────────────────────────────────────────

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `Request failed: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

// ─── API client ───────────────────────────────────────────────────────────────

export const api = {
  recon: {
    /** Get counts of transactions and connection status */
    counts: () => request<ReconCounts>("/api/recon/counts"),

    /** Start a reconciliation run for a date range */
    run: (body: ReconRunBody) =>
      request<ReconRunResult>("/api/recon/run", {
        method: "POST",
        body: JSON.stringify(body),
      }),
  },

  matches: {
    /** List matches, optionally filtered by status */
    list: (filter?: "all" | "pending" | "approved" | "rejected" | "exceptions") =>
      request<MatchListItem[]>(`/api/matches${filter ? `?filter=${filter}` : ""}`),

    /** Approve a single match */
    approve: (matchId: string) =>
      request<{ success: boolean; matchId: string; status: string }>(
        `/api/matches/${matchId}/approve`,
        { method: "POST" }
      ),

    /** Reject a single match */
    reject: (matchId: string) =>
      request<{ success: boolean; matchId: string; status: string }>(
        `/api/matches/${matchId}/reject`,
        { method: "POST" }
      ),

    /** Bulk approve all pending matches above a confidence threshold */
    bulkApprove: (runId: string, threshold: number) =>
      request<{ approvedCount: number }>("/api/matches/bulk-approve", {
        method: "POST",
        body: JSON.stringify({ runId, threshold }),
      }),
  },

  exceptions: {
    /** List all exceptions (unmatched + rejected matches) */
    list: () => request<ExceptionsResult>("/api/exceptions"),
  },

  stripe: {
    /** Pull latest transactions from the user's connected Stripe account */
    sync: () => request<{ count: number; message: string }>("/api/stripe/sync", { method: "POST" }),

    /** Disconnect the user's Stripe account */
    disconnect: () => request<{ success: boolean }>("/api/stripe/disconnect", { method: "POST" }),
  },

  qbo: {
    /** Pull all entity types from QuickBooks */
    sync: () =>
      request<{ count: number; message: string; breakdown: Record<string, number> }>(
        "/api/qbo/sync",
        { method: "POST" }
      ),

    /** Disconnect QuickBooks */
    disconnect: () => request<{ success: boolean }>("/api/qbo/disconnect", { method: "POST" }),
  },

  reports: {
    /** Get reconciliation summary stats for a date range */
    summary: (periodStart: string, periodEnd: string) =>
      request<ReportSummaryResult>(
        `/api/reports/summary?periodStart=${encodeURIComponent(periodStart)}&periodEnd=${encodeURIComponent(periodEnd)}`
      ),
  },

  settings: {
    /** Reset all reconciliation data (keeps the user account) */
    reset: () => request<{ message: string }>("/api/settings/reset", { method: "POST" }),

    /** Permanently delete the user account and all data */
    deleteAccount: () =>
      request<{ message: string }>("/api/settings/delete-account", { method: "POST" }),
  },
};
