"use client";

import { Suspense, useState } from "react";
import { VirtualMatchTable } from "@/components/virtual-match-table";
import { EvidencePanel } from "@/components/evidence-panel/EvidencePanel";
import { MatchTableSkeleton } from "@/components/skeletons";
import { CheckCircle2, AlertCircle, FileStack, TrendingUp, X } from "lucide-react";
import { useData } from "@/lib/data-context";



export default function DashboardPage() {
  const { matches, setMatches, handleApprove, handleReject } = useData();
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);

  const handleBulkApprove = (threshold: number) => {
    setMatches((prev) =>
      prev.map((m) =>
        m.status === "pending" && m.confidenceScore >= threshold
          ? { ...m, status: "approved" }
          : m
      )
    );
  };

  const handleRowClick = (id: string) => {
    setSelectedMatchId(id);
  };

  const autoMatchedCount = matches.filter((m) => m.matchType === "exact" || m.status === "approved").length;
  const needReviewCount = matches.filter((m) => m.status === "pending" && (m.matchType === "fuzzy" || m.matchType === "bulk")).length;
  const exceptionsCount = matches.filter((m) => m.matchType === "none" && m.status !== "approved").length;
  const totalReconciledValue = matches
    .filter((m) => m.matchType === "exact" || m.status === "approved")
    .reduce((sum, m) => sum + Math.abs(m.bankRow.amount), 0);
  
  const formatter = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });

  const selectedMatch = matches.find(m => m.id === selectedMatchId) || null;

  return (
    <div className="p-4 sm:p-6 sm:px-8 flex flex-col gap-6 sm:gap-8 h-full font-sans text-slate-900 mx-auto w-full max-w-7xl relative">
      <div className="shrink-0 flex flex-col pt-2 sm:pt-4">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-1 font-medium">
          Overview of your reconciliation status for this period.
        </p>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 shrink-0">
        {/* Metric Cards */}
        <MetricCard title="Auto-matched" value={autoMatchedCount.toString()} change={`${autoMatchedCount} transactions matched`} icon={<CheckCircle2 className="w-5 h-5 text-green-600" />} />
        <MetricCard title="Need review" value={needReviewCount.toString()} change={`${needReviewCount} transactions pending`} icon={<FileStack className="w-5 h-5 text-blue-600" />} />
        <MetricCard title="Exceptions" value={exceptionsCount.toString()} change={exceptionsCount > 0 ? "Requires attention" : "All caught up"} alert={exceptionsCount > 0} icon={<AlertCircle className="w-5 h-5 text-amber-600" />} />
        <MetricCard title="Total reconciled" value={formatter.format(totalReconciledValue)} change="Calculated dynamically" icon={<TrendingUp className="w-5 h-5 text-slate-600" />} />
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
    </div>
  );
}

function MetricCard({ title, value, change, alert = false, icon }: { title: string; value: string; change: string; alert?: boolean; icon?: React.ReactNode }) {
  return (
    <div className="bg-white p-4 sm:p-5 border border-slate-200 rounded-lg shadow-sm hover:shadow-md transition-shadow duration-200 group flex flex-col justify-between h-full relative overflow-hidden">
      {alert && <div className="absolute top-0 left-0 w-full h-1 bg-amber-500" />}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] sm:text-xs font-semibold text-slate-500 uppercase tracking-widest">{title}</p>
          <div className="p-1.5 bg-slate-50 rounded-md group-hover:bg-slate-100 transition-colors">
            {icon}
          </div>
        </div>
        <p className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">{value}</p>
      </div>
      <p className={`text-[11px] sm:text-xs font-bold mt-3 ${alert ? "text-amber-600" : "text-emerald-600"} flex items-center gap-1`}>
        {change}
      </p>
    </div>
  );
}
