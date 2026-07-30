"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Download, CalendarDays, Clock, CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { sharedMatches } from "@/lib/data";

export default function ReportsPage() {
  const [selectedPeriod, setSelectedPeriod] = useState<string>("November 2024");
  const [activeTab, setActiveTab] = useState<string>("summary");
  const [page, setPage] = useState(1);
  const [isExporting, setIsExporting] = useState(false);
  
  const [isLoading, setIsLoading] = useState(false);
  const [stats, setStats] = useState({
    totalCount: 0,
    matchedCount: 0,
    pendingCount: 0,
    unmatchedCount: 0,
    highRiskCount: 0,
    totalVolumeMinor: 0
  });
  
  const [listData, setListData] = useState<any[]>([]);
  const [totalListCount, setTotalListCount] = useState(0);

  // Check for demo mode from URL
  const [isDemoMode, setIsDemoMode] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined") {
      setIsDemoMode(new URLSearchParams(window.location.search).get("demo") === "true");
    }
  }, []);

  // Derived display values from real stats
  const totalNum = Number(stats.totalCount) || 0;
  const autoNum = Number(stats.matchedCount) || 0;
  const manualNum = 0; // Phase 11 doesn't distinguish auto/manual matched on DB level yet in metrics
  const exceptionNum = (Number(stats.unmatchedCount) || 0) + (Number(stats.pendingCount) || 0);

  const autoPercent = totalNum > 0 ? Math.round((autoNum / totalNum) * 100) : 0;
  const manualPercent = totalNum > 0 ? Math.round((manualNum / totalNum) * 100) : 0;
  const exceptionPercent = totalNum > 0 ? Math.max(0, 100 - autoPercent - manualPercent) : 0;

  const healthScore = totalNum > 0
    ? Math.min(100, Math.round(
        (autoNum / totalNum) * 70 +
        (1 - Math.min(1, exceptionNum / Math.max(1, totalNum))) * 30
      ))
    : null;

  const timeSavedHours = Math.round((autoNum * 3) / 60);

  const getPeriodBounds = () => {
    let periodStart, periodEnd;
    const now = new Date();
    
    if (selectedPeriod === "Last 30 days") {
      periodEnd = now;
      periodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (selectedPeriod === "Custom range") {
      periodStart = new Date(now.getFullYear(), 0, 1);
      periodEnd = now;
    } else {
      const [monthStr, yearStr] = selectedPeriod.split(" ");
      const monthIndex = new Date(`${monthStr} 1, 2000`).getMonth();
      const year = parseInt(yearStr);
      periodStart = new Date(year, monthIndex, 1);
      periodEnd = new Date(year, monthIndex + 1, 0); // Last day of month
    }
    return { start: periodStart.toISOString(), end: periodEnd.toISOString() };
  };

  useEffect(() => {
    if (!selectedPeriod) return;
    setPage(1);
  }, [selectedPeriod, activeTab]);

  useEffect(() => {
    if (!selectedPeriod) return;

    // ── Demo mode: compute from mock data, no API calls ──
    if (isDemoMode) {
      setIsLoading(true);
      // Simulate a brief loading delay for realism
      const timer = setTimeout(() => {
        const total = sharedMatches.length;
        const matched = sharedMatches.filter(m => m.status === "approved").length;
        const pending = sharedMatches.filter(m => m.status === "pending").length;
        const unmatched = sharedMatches.filter(m => m.matchOutcome === "UNMATCHED").length;
        const highRisk = sharedMatches.filter(m => m.riskScore >= 50).length;
        const volume = sharedMatches.reduce((s, m) => s + Math.abs(m.bankRow.amount), 0) * 100;

        if (activeTab === "summary") {
          setStats({ totalCount: total, matchedCount: matched, pendingCount: pending, unmatchedCount: unmatched, highRiskCount: highRisk, totalVolumeMinor: volume });
        } else {
          // Generate list data from mock matches filtered by tab
          const filtered = activeTab === "exceptions"
            ? sharedMatches.filter(m => m.matchOutcome === "UNMATCHED" || m.status === "pending")
            : activeTab === "fees"
            ? sharedMatches.filter(m => m.discrepancyType === "PROCESSING_FEE")
            : activeTab === "fx"
            ? sharedMatches.filter(m => m.discrepancyType === "FX_DIFFERENCE")
            : activeTab === "risk"
            ? sharedMatches.filter(m => m.riskScore >= 40)
            : sharedMatches;

          const mapped = filtered.map(m => ({
            id: m.id,
            bankDescription: m.bankRow.description,
            bankAmount: m.bankRow.amount,
            bankDate: m.bankRow.date,
            ledgerMemo: m.ledgerRow?.memo || m.ledgerRows?.map(l => l.memo).join(", ") || "—",
            ledgerAmount: m.ledgerRow?.amount || m.ledgerRows?.reduce((s, l) => s + l.amount, 0) || 0,
            confidenceScore: m.confidenceScore,
            matchType: m.matchType,
            status: m.status,
            riskScore: m.riskScore,
            discrepancyType: m.discrepancyType,
            reasonText: m.reasonText,
          }));
          setListData(mapped);
          setTotalListCount(mapped.length);
        }
        setIsLoading(false);
      }, 300);
      return () => clearTimeout(timer);
    }

    let active = true;
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const { start, end } = getPeriodBounds();
        
        if (activeTab === "summary") {
          const data = await api.reports.summary(start, end);
          if (active) {
            setStats(data as any);
          }
        } else {
          const result = await api.reports.details(activeTab, start, end, page, 50);
          if (active) {
            if (result.error) {
              toast.error(result.error);
            } else {
              setListData(result.data || []);
              setTotalListCount(result.totalCount || 0);
            }
          }
        }
      } catch (error: any) {
        if (active) {
          toast.error(error.message || "Failed to fetch report data");
          console.error("Failed to fetch reports", error);
        }
      } finally {
        if (active) setIsLoading(false);
      }
    };

    fetchData();
    return () => { active = false; };
  }, [selectedPeriod, activeTab, page, isDemoMode]);

  const handleExport = async (format: "csv" | "xlsx" | "pdf") => {
    if (!selectedPeriod) {
      toast.error("Please select a period first.");
      return;
    }
    
    setIsExporting(true);
    
    try {
      const { start, end } = getPeriodBounds();
      const url = `/api/reports/export?type=${activeTab === 'summary' ? 'exceptions' : activeTab}&format=${format}&periodStart=${start}&periodEnd=${end}`;
      
      // Perform a pre-flight fetch to check for validation errors (like limit exceeded)
      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) {
        const err = await res.json().catch(()=>({}));
        toast.error(err.error || "Export failed validation.");
        setIsExporting(false);
        return;
      }
      
      // Since it's a stream download, trigger via window location
      window.location.href = url;
    } catch (error) {
      console.error(error);
      toast.error("Failed to initiate export");
    } finally {
      // Re-enable button after a short delay since stream download doesn't trigger load event
      setTimeout(() => setIsExporting(false), 2000);
    }
  };

  const renderPagination = () => {
    if (activeTab === "summary") return null;
    const totalPages = Math.ceil(totalListCount / 50);
    if (totalPages <= 1) return null;

    return (
      <div className="flex items-center justify-between mt-4 p-4 border-t border-slate-100">
        <span className="text-sm text-slate-500">
          Showing {(page - 1) * 50 + 1} to {Math.min(page * 50, totalListCount)} of {totalListCount}
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
            <ChevronLeft className="w-4 h-4 mr-1" /> Prev
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
            Next <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 sm:p-6 flex flex-col gap-6 h-full font-sans text-slate-900 mx-auto w-full max-w-5xl">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Month-end report</h1>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative">
            <select
              title="Select period"
              className="appearance-none h-10 pl-3 pr-8 w-full sm:w-[180px] rounded-md border border-slate-300 bg-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900"
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
            >
              <option value="">Select period...</option>
              <option value="June 2026">June 2026</option>
              <option value="May 2026">May 2026</option>
              <option value="April 2026">April 2026</option>
              <option value="Last 30 days">Last 30 days</option>
              <option value="Custom range">Custom range</option>
            </select>
            <div className="absolute right-3 top-3 pointer-events-none text-slate-500">
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M4.93179 5.43179C4.75605 5.60753 4.75605 5.89245 4.93179 6.06819L7.43179 8.56819C7.60753 8.74393 7.89245 8.74393 8.06819 8.56819L10.5682 6.06819C10.7439 5.89245 10.7439 5.60753 10.5682 5.43179C10.3924 5.25605 10.1075 5.25605 9.93179 5.43179L7.75 7.61358L5.56819 5.43179C5.39245 5.25605 5.10753 5.25605 4.93179 5.43179Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd"></path>
              </svg>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="h-10" onClick={() => handleExport("csv")} disabled={isExporting || !selectedPeriod}>CSV</Button>
            <Button variant="outline" className="h-10" onClick={() => handleExport("xlsx")} disabled={isExporting || !selectedPeriod}>XLSX</Button>
            <Button className="bg-slate-900 text-white hover:bg-slate-800 transition-colors h-10" onClick={() => handleExport("pdf")} disabled={isExporting || !selectedPeriod}>
              <Download className="w-4 h-4 mr-2" /> PDF
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex overflow-x-auto border-b border-slate-200">
        {[
          { id: "summary", label: "Summary" },
          { id: "exceptions", label: "Exceptions" },
          { id: "fee", label: "Fee Report" },
          { id: "fx", label: "FX Report" },
          { id: "audit", label: "Audit Activity" },
          { id: "risk", label: "Risk Distribution" }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
              activeTab === tab.id ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {!selectedPeriod ? (
        <div className="flex-1 flex flex-col items-center justify-center border border-slate-200 border-dashed rounded-lg bg-white/50 backdrop-blur-sm min-h-[400px]">
          <div className="mb-4">
            <CalendarDays className="w-12 h-12 text-slate-300" strokeWidth={1.5} />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 mb-1 tracking-tight">Select a period above</h3>
          <p className="text-sm text-slate-500 max-w-[280px] text-center mb-6">
            Your reconciliation report will preview here
          </p>
        </div>
      ) : isLoading ? (
        <div className="flex-1 flex justify-center items-center h-64 text-slate-500">Loading data...</div>
      ) : activeTab === "summary" ? (
        <div className="flex-1 flex flex-col gap-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="col-span-1 md:col-span-2 bg-slate-50 border border-slate-200 rounded-xl p-6">
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-4">Executive Summary</h2>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <div>
                  <div className="text-xs text-slate-500 mb-1">Total transactions</div>
                  <div className="text-2xl font-bold text-slate-900">{totalNum}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 mb-1">Auto-matched</div>
                  <div className="text-2xl font-bold text-slate-900">{autoNum} <span className="text-sm font-medium text-emerald-600">({autoPercent}%)</span></div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 mb-1">Manually reviewed</div>
                  <div className="text-2xl font-bold text-slate-900">{manualNum}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 mb-1">Exceptions unresolved</div>
                  <div className="text-2xl font-bold text-slate-900">{exceptionNum}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-4 pt-4 border-t border-slate-200">
                <Clock className="w-4 h-4 text-emerald-600" />
                <span className="text-sm font-medium text-emerald-700">
                  {timeSavedHours > 0 ? `Time saved this month: ~${timeSavedHours} hours` : "No transactions reconciled yet"}
                </span>
                {timeSavedHours > 0 && (
                  <span className="text-xs text-slate-400 ml-auto hidden sm:block">Based on 2 accountants × 3 min avg per transaction</span>
                )}
              </div>
            </div>

            <div className="col-span-1 bg-white border border-slate-200 rounded-xl p-6 flex flex-col items-center justify-center text-center">
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-2 w-full text-left">Health Score</h2>
              <div className="flex-1 flex flex-col items-center justify-center">
                {healthScore !== null ? (
                  <>
                    <div className="flex items-baseline mb-2">
                      <span className={`text-6xl font-bold tracking-tighter ${
                        healthScore >= 80 ? 'text-emerald-600' : healthScore >= 60 ? 'text-amber-500' : 'text-rose-500'
                      }`}>{healthScore}</span>
                      <span className="text-xl font-medium text-slate-400 ml-1">/100</span>
                    </div>
                    <p className="text-sm font-medium text-slate-600 mt-2">
                      {healthScore >= 80 ? 'Excellent — above industry average of 78' : healthScore >= 60 ? 'Good — near industry average' : 'Needs attention'}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-slate-400">No data for this period</p>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-4">Match Rate Breakdown</h2>
            {totalNum > 0 ? (
              <>
                <div className="flex h-6 w-full rounded-full overflow-hidden mb-3 shadow-inner">
                  <div className="bg-emerald-500 h-full transition-all" style={{ width: `${autoPercent}%` }} />
                  <div className="bg-amber-400 h-full transition-all" style={{ width: `${manualPercent}%` }} />
                  <div className="bg-rose-500 h-full transition-all" style={{ width: `${exceptionPercent}%` }} />
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium">
                  <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-emerald-500" />Auto-matched ({autoPercent}%)</div>
                  <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-amber-400" />Manual approval ({manualPercent}%)</div>
                  <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-rose-500" />Exceptions ({exceptionPercent}%)</div>
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-400">No reconciliation data for this period.</p>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex-1 flex flex-col">
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-500 border-b border-slate-200 font-medium bg-slate-50">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  {activeTab !== "audit" && <th className="px-4 py-3">Amount</th>}
                  {activeTab === "audit" && <th className="px-4 py-3">User</th>}
                  <th className="px-4 py-3">Details</th>
                  <th className="px-4 py-3 text-right">Status / Score</th>
                </tr>
              </thead>
              <tbody>
                {listData.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-slate-500">No data available for this report.</td>
                  </tr>
                ) : listData.map((item, i) => (
                  <tr key={item.id || i} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-500">{new Date(item.date || item.timestamp).toLocaleDateString()}</td>
                    
                    {activeTab !== "audit" && (
                      <td className="px-4 py-3 font-mono font-medium">
                        {(Number(item.amountMinor || 0) / 100).toFixed(2)}
                      </td>
                    )}
                    
                    {activeTab === "audit" && (
                      <td className="px-4 py-3 text-slate-700">{item.actorEmail || "System"}</td>
                    )}

                    <td className="px-4 py-3">
                      <span className="text-slate-700">{item.reasonText || item.action || item.reason || "-"}</span>
                    </td>
                    
                    <td className="px-4 py-3 text-right">
                      <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600">
                        {item.status || item.riskScore || "N/A"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {renderPagination()}
        </div>
      )}
    </div>
  );
}
