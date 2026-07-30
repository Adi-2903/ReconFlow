"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { VirtualMatchTable } from "@/components/virtual-match-table";
import { EvidencePanel } from "@/components/evidence-panel/EvidencePanel";
import { MatchTableSkeleton } from "@/components/skeletons";
import { CheckCircle2, AlertCircle, FileStack, TrendingUp, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useData } from "@/lib/data-context";
import { EmptyDashboardState } from "@/components/empty-dashboard-state";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { NewRunModal } from "@/components/new-run-modal/NewRunModal";
import { Play } from "lucide-react";

export default function DashboardPage() {
  const { matches, setMatches, handleApprove, handleReject, isLoading, isDemoMode, refreshMatches, refreshExceptions } = useData();
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [isBulkApproving, setIsBulkApproving] = useState(false);
  const [isRunModalOpen, setIsRunModalOpen] = useState(false);

  const handleBulkApprove = useCallback(async (threshold: number) => {
    if (isDemoMode) {
      setMatches((prev) =>
        prev.map((m) =>
          m.status === "pending" && m.confidenceScore >= threshold
            ? { ...m, status: "approved" }
            : m
        )
      );
      toast.success("Bulk approved matches (demo mode)");
      return;
    }
    
    setIsBulkApproving(true);
    try {
      const data = await api.matches.bulkApprove(threshold);
      toast.success(`Successfully approved ${data.approvedCount} matches`);
      await Promise.all([refreshMatches(), refreshExceptions()]);
    } catch (e: any) {
      console.error("Bulk approve error:", e);
      toast.error(e.message || "Failed to bulk approve matches");
      // We still refresh in case of partial failures or out-of-sync state
      await Promise.all([refreshMatches(), refreshExceptions()]);
    } finally {
      setIsBulkApproving(false);
    }
  }, [isDemoMode, setMatches, refreshMatches, refreshExceptions]);

  const handleRowClick = useCallback((id: string) => {
    setSelectedMatchId(id);
  }, []);

  const [summary, setSummary] = useState({
    totalCount: 0,
    matchedCount: 0,
    pendingCount: 0,
    unmatchedCount: 0,
    totalVolumeMinor: 0
  });

  useEffect(() => {
    if (isDemoMode) {
      // Compute summary from client-side mock data — no API needed
      const total = matches.length;
      const matched = matches.filter(m => m.status === "approved").length;
      const pending = matches.filter(m => m.status === "pending").length;
      const unmatched = matches.filter(m => m.matchOutcome === "UNMATCHED").length;
      const volume = matches.reduce((sum, m) => sum + Math.abs(m.bankRow.amount), 0) * 100;
      setSummary({ totalCount: total, matchedCount: matched, pendingCount: pending, unmatchedCount: unmatched, totalVolumeMinor: volume });
      return;
    }

    let active = true;
    const fetchSummary = async () => {
      // Default to last 2 years for dashboard to ensure test data is included
      const now = new Date();
      const start = new Date(now.getFullYear() - 2, now.getMonth(), 1).toISOString();
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();
      try {
        const data = await api.reports.summary(start, end);
        if (active) {
          setSummary(data as any);
        }
      } catch (e) {
        console.error("Failed to fetch dashboard summary", e);
      }
    };
    fetchSummary();
    return () => { active = false; };
  }, [isDemoMode, matches]);

  const autoMatchedCount = summary?.matchedCount ?? 0;
  const needReviewCount = summary?.pendingCount ?? 0;
  const exceptionsCount = summary?.unmatchedCount ?? 0;
  const totalReconciledValue = (summary?.totalVolumeMinor ?? 0) / 100;
  
  const formatter = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });

  const selectedMatch = matches.find(m => m.id === selectedMatchId) || null;

  if (!isLoading && matches.length === 0 && !isDemoMode) {
    return (
      <div className="p-4 sm:p-6 sm:px-8 flex flex-col h-full font-sans text-slate-900 mx-auto w-full max-w-7xl relative">
        <EmptyDashboardState />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 sm:px-8 flex flex-col gap-6 sm:gap-8 h-full font-sans text-slate-900 mx-auto w-full max-w-7xl relative">
      {/* Premium subtle background grid */}
      <div className="absolute inset-0 z-0 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, rgba(148, 163, 184, 0.15) 1px, transparent 0)', backgroundSize: '24px 24px' }}></div>
      
      <div className="shrink-0 flex flex-col sm:flex-row sm:items-start justify-between gap-4 pt-2 sm:pt-4 relative z-10">
        <div className="flex flex-col">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 font-serif">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1 font-medium">
            Overview of your reconciliation status for this period.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button 
            onClick={() => setIsRunModalOpen(true)} 
            variant="outline"
            className="w-full sm:w-auto bg-white hover:bg-slate-50"
          >
            <Play className="w-4 h-4 mr-2" />
            Re-Reconcile
          </Button>
          <Button 
            onClick={() => handleBulkApprove(0.95)} 
            disabled={isBulkApproving}
            className="w-full sm:w-auto bg-slate-900 text-white hover:bg-slate-800"
          >
            {isBulkApproving ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4 mr-2" />
            )}
            Bulk Approve
          </Button>
        </div>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 shrink-0 relative z-10">
        {/* Metric Cards */}
        <MetricCard title="Auto-matched" value={autoMatchedCount.toString()} change={`${autoMatchedCount} transactions matched`} icon={<CheckCircle2 className="w-5 h-5 text-accent-teal" />} />
        <MetricCard title="Need review" value={needReviewCount.toString()} change={`${needReviewCount} transactions pending`} icon={<FileStack className="w-5 h-5 text-accent-ink" />} />
        <MetricCard title="Exceptions" value={exceptionsCount.toString()} change={exceptionsCount > 0 ? "Requires attention" : "All caught up"} alert={exceptionsCount > 0} icon={<AlertCircle className="w-5 h-5 text-accent-warm" />} />
        <MetricCard title="Total reconciled" value={formatter.format(totalReconciledValue)} change="Calculated dynamically" icon={<TrendingUp className="w-5 h-5 text-slate-700" />} />
      </div>

      <div className="flex-1 overflow-hidden min-h-[400px]">
        <Suspense fallback={<MatchTableSkeleton />}>
          <VirtualMatchTable
            matches={matches}
            onApprove={handleApprove}
            onReject={handleReject}
            onRowClick={handleRowClick}
            filter="all"
          />
        </Suspense>
      </div>

      {selectedMatch && (
        <EvidencePanel 
          match={selectedMatch as any} 
          onApprove={handleApprove}
          onReject={handleReject}
          onClose={() => setSelectedMatchId(null)} 
        />
      )}

      <NewRunModal open={isRunModalOpen} onOpenChange={setIsRunModalOpen} />
    </div>
  );
}

function MetricCard({ title, value, change, alert = false, icon }: { title: string; value: string; change: string; alert?: boolean; icon?: React.ReactNode }) {
  return (
    <div className="bg-white/80 backdrop-blur-sm p-5 border border-slate-200 rounded-xl shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 group flex flex-col justify-between h-full relative overflow-hidden">
      {alert && <div className="absolute top-0 left-0 w-full h-1 bg-accent-warm" />}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">{title}</p>
          <div className="p-1.5 bg-slate-50 border border-slate-100 rounded-lg group-hover:bg-white group-hover:shadow-sm transition-all duration-300">
            {icon}
          </div>
        </div>
        <p className="text-3xl font-serif font-semibold text-slate-900 tracking-tight">{value}</p>
      </div>
      <p className={`text-xs font-semibold mt-4 flex items-center gap-1 ${alert ? "text-accent-warm" : "text-accent-teal"}`}>
        {change}
      </p>
    </div>
  );
}
