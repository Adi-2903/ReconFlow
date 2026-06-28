"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useData } from "@/lib/data-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Search,
  AlertCircle,
  CheckCircle2,
  XCircle,
  History,
  User,
  Clock,
  Sparkles,
  ArrowRight,
  TrendingUp,
  FileSpreadsheet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { api, ExceptionItem, AvailableLedgerEntry, AuditLogEntry } from "@/lib/api-client";

export default function ExceptionsPage() {
  const { handleApprove, handleReject, handleManualMatch, isDemoMode } = useData();

  // State
  const [exceptions, setExceptions] = useState<ExceptionItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<ExceptionItem | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [activeTab, setActiveTab] = useState<"resolve" | "manual" | "audit">("resolve");

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Comments for Resolve Match
  const [resolveComment, setResolveComment] = useState("");

  // Manual Match State
  const [availableLedgers, setAvailableLedgers] = useState<AvailableLedgerEntry[]>([]);
  const [isLoadingLedgers, setIsLoadingLedgers] = useState(false);
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [selectedLedgerIds, setSelectedLedgerIds] = useState<Set<string>>(new Set());
  const [manualComment, setManualComment] = useState("");

  // Audit Logs State
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);

  // Fetch Exception Items
  const fetchExceptions = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (isDemoMode) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const { sharedMatches } = await import("@/lib/data");
        const demoData = sharedMatches
          .filter((m) => m.status === "pending" && m.confidenceScore < 0.9)
          .map((m) => ({
            id: m.id,
            bankTransactionId: m.bankTransactionId || m.id,
            ledgerEntryIds: m.ledgerEntryIds || [],
            amount: m.bankRow.amount,
            date: m.bankRow.date,
            source: "Bank",
            reference: m.bankRow.referenceId,
            reasonTag: m.reasonText,
            reasonText: m.reasonText,
            flags: m.evidenceList?.map((e) => e.code) || [],
          }));
        setExceptions(demoData);
        if (demoData.length > 0 && !selectedItem) {
          setSelectedItem(demoData[0]);
        }
      } else {
        const data = await api.exceptions.list();
        const list = data.exceptions || [];
        setExceptions(list);
        if (list.length > 0) {
          // Retain active selection if still in list, or select first
          const found = list.find((x: ExceptionItem) => x.id === selectedItem?.id);
          if (!found) {
            setSelectedItem(list[0]);
          } else {
            setSelectedItem(found);
          }
        } else {
          setSelectedItem(null);
        }
      }
    } catch (err) {
      console.error(err);
      setError("Failed to fetch exceptions");
    } finally {
      setIsLoading(false);
    }
  }, [isDemoMode, selectedItem?.id]);

  useEffect(() => {
    fetchExceptions();
  }, [isDemoMode]);

  // Fetch Available Ledgers for Manual Match
  const fetchAvailableLedgers = useCallback(
    async (query: string = "") => {
      if (!selectedItem) return;
      setIsLoadingLedgers(true);
      try {
        if (isDemoMode) {
          await new Promise((resolve) => setTimeout(resolve, 300));
          // Mock available invoices
          setAvailableLedgers([
            {
              id: "inv-1",
              amount: Math.abs(selectedItem.amount) / 100,
              currency: "INR",
              date: "2026-06-15",
              description: "Customer Invoice INV-2026-09",
              referenceNumber: "INV-2026-09",
              counterpartyName: "Acme Corp",
              side: "books",
              direction: selectedItem.amount < 0 ? "outflow" : "inflow",
              sourceSystem: "quickbooks",
              score: 95,
              confidenceBand: "VERY_HIGH",
              reasons: [{ reason: "Amount matched exactly", points: 80 }],
            },
            {
              id: "inv-2",
              amount: (Math.abs(selectedItem.amount) + 500) / 100,
              currency: "INR",
              date: "2026-06-16",
              description: "Alternative Ledger Reference",
              referenceNumber: "INV-2026-10",
              counterpartyName: "Acme Corp",
              side: "books",
              direction: selectedItem.amount < 0 ? "outflow" : "inflow",
              sourceSystem: "quickbooks",
              score: 72,
              confidenceBand: "MEDIUM",
              reasons: [{ reason: "Counterparty fuzzy match", points: 30 }],
            },
          ]);
        } else {
          const params = new URLSearchParams();
          params.set("bankId", selectedItem.bankTransactionId);
          if (query) params.set("query", query);
          const result = await api.transactions.available(params);
          setAvailableLedgers(result.data || []);
        }
      } catch (err) {
        console.error(err);
        toast.error("Failed to load available transactions");
      } finally {
        setIsLoadingLedgers(false);
      }
    },
    [selectedItem, isDemoMode]
  );

  // Trigger loading of available transactions when manual match tab is opened
  useEffect(() => {
    if (activeTab === "manual" && selectedItem) {
      setSelectedLedgerIds(new Set());
      setLedgerSearch("");
      fetchAvailableLedgers("");
    }
  }, [activeTab, selectedItem, fetchAvailableLedgers]);

  // Fetch Audit Logs when Audit Trail tab is opened
  const fetchAuditLogs = useCallback(async () => {
    if (!selectedItem) return;
    setIsLoadingAudit(true);
    try {
      if (isDemoMode) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        setAuditLogs([
          {
            id: "audit-1",
            matchId: selectedItem.id,
            action: "suggested_match_created",
            actorEmail: "engine@reconflow.ai",
            reason: "AI auto classification completed with low confidence",
            timestamp: new Date().toISOString(),
            metadata: {},
          },
        ]);
      } else {
        const result = await api.auditLogs.list(selectedItem.id);
        setAuditLogs(result.data || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingAudit(false);
    }
  }, [selectedItem, isDemoMode]);

  useEffect(() => {
    if (activeTab === "audit" && selectedItem) {
      fetchAuditLogs();
    }
  }, [activeTab, selectedItem, fetchAuditLogs]);

  // Search Filter on exception list
  const filteredExceptions = useMemo(() => {
    let result = exceptions;
    
    if (filterType !== "all") {
      result = result.filter(item => {
        const norm = item.reasonTag.toLowerCase();
        if (filterType === "amount" && (norm.includes("amount mismatch") || norm.includes("delta"))) return true;
        if (filterType === "missing" && (norm.includes("no ledger") || norm.includes("missing"))) return true;
        if (filterType === "duplicate" && norm.includes("duplicate")) return true;
        return false;
      });
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (item) =>
          item.reference.toLowerCase().includes(q) ||
          item.reasonTag.toLowerCase().includes(q) ||
          item.reasonText.toLowerCase().includes(q) ||
          (item.amount / 100).toString().includes(q)
      );
    }
    
    return result;
  }, [exceptions, searchQuery, filterType]);

  // Formatter helpers
  const formatAmountINR = (amountMinor: number) => {
    const amount = Math.abs(amountMinor) / 100;
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 2,
    }).format(amount);
  };

  const getReasonBadgeStyles = (tag: string) => {
    const norm = tag.toLowerCase();
    if (norm.includes("no ledger") || norm.includes("rejected")) {
      return "bg-red-50 text-red-700 border-red-200/60";
    }
    if (norm.includes("amount mismatch") || norm.includes("delta")) {
      return "bg-amber-50 text-amber-700 border-amber-200/60";
    }
    if (norm.includes("duplicate")) {
      return "bg-orange-50 text-orange-700 border-orange-200/60";
    }
    return "bg-slate-50 text-slate-700 border-slate-200/60";
  };

  // Submit Approve Match
  const handleApproveAction = useCallback(async () => {
    if (!selectedItem) return;
    setIsSubmitting(true);
    try {
      const ok = await handleApprove(selectedItem.id, resolveComment.trim() || undefined);
      if (ok) {
        setResolveComment("");
        await fetchExceptions();
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedItem, handleApprove, resolveComment, fetchExceptions]);

  // Submit Reject Match
  const handleRejectAction = useCallback(async () => {
    if (!selectedItem) return;
    setIsSubmitting(true);
    try {
      const ok = await handleReject(selectedItem.id, resolveComment.trim() || undefined);
      if (ok) {
        setResolveComment("");
        await fetchExceptions();
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedItem, handleReject, resolveComment, fetchExceptions]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        if (e.key === "Enter" && activeTab === "resolve" && selectedItem) {
          e.preventDefault();
          handleApproveAction();
        } else if (e.key === "Backspace" && activeTab === "resolve" && selectedItem) {
          e.preventDefault();
          handleRejectAction();
        }
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (filteredExceptions.length > 0) {
          e.preventDefault();
          const currentIndex = selectedItem ? filteredExceptions.findIndex(item => item.id === selectedItem.id) : -1;
          let nextIndex = currentIndex;
          
          if (e.key === "ArrowDown") {
            nextIndex = currentIndex < filteredExceptions.length - 1 ? currentIndex + 1 : currentIndex;
          } else {
            nextIndex = currentIndex > 0 ? currentIndex - 1 : 0;
          }
          
          if (nextIndex !== currentIndex && nextIndex >= 0) {
            setSelectedItem(filteredExceptions[nextIndex]);
            setActiveTab("resolve");
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedItem, filteredExceptions, activeTab, handleApproveAction, handleRejectAction]);

  // Toggle ledger checkbox selection
  const handleToggleLedgerSelection = (id: string) => {
    setSelectedLedgerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Run search query for available invoices
  const handleAvailableLedgersSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchAvailableLedgers(ledgerSearch);
  };

  // Calculate sum of selected available invoices
  const selectedLedgersSum = useMemo(() => {
    let sum = 0;
    availableLedgers.forEach((l) => {
      if (selectedLedgerIds.has(l.id)) {
        sum += l.amount * 100;
      }
    });
    return sum;
  }, [availableLedgers, selectedLedgerIds]);

  const selectedLedgersDelta = useMemo(() => {
    if (!selectedItem) return 0;
    const bankAmount = Math.abs(selectedItem.amount);
    return Math.abs(bankAmount - selectedLedgersSum);
  }, [selectedItem, selectedLedgersSum]);

  // Execute manual match submission
  const handleManualMatchConfirm = async () => {
    if (!selectedItem) return;
    if (selectedLedgerIds.size === 0) {
      toast.error("Please select at least one ledger entry to match.");
      return;
    }
    if (!manualComment.trim()) {
      toast.error("Explanation comment is required for manual matching.");
      return;
    }

    setIsSubmitting(true);
    try {
      const selectedIds = Array.from(selectedLedgerIds);
      const ok = await handleManualMatch(
        selectedItem.bankTransactionId,
        selectedIds,
        manualComment.trim()
      );
      if (ok) {
        setSelectedLedgerIds(new Set());
        setManualComment("");
        setActiveTab("resolve");
        await fetchExceptions();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-50 relative">
      {/* Premium subtle background grid */}
      <div className="absolute inset-0 z-0 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, rgba(148, 163, 184, 0.15) 1px, transparent 0)', backgroundSize: '24px 24px' }}></div>
      
      {/* Upper Control Bar */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-slate-200 px-6 py-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shrink-0 shadow-sm relative z-10">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2 font-serif">
            Exceptions Workspace
            <span className="text-xs bg-red-100 text-red-800 font-bold px-2 py-0.5 rounded-full">
              {exceptions.length} Pending Review
            </span>
          </h1>
          <p className="text-xs text-slate-500 mt-1 font-medium">
            Review suggested anomalies, override matches, or manually reconcile outlier items with
            optimistic queue isolation.
          </p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button
            variant="outline"
            className="h-8 text-xs font-semibold gap-1 text-slate-600 bg-white hover:bg-slate-50"
            onClick={() => fetchExceptions()}
          >
            <Clock className="w-3.5 h-3.5" />
            Refresh Queue
          </Button>
        </div>
      </div>

      {/* Main Workspace Workspace */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0 relative z-10">
        {/* Left Sidebar Pane: Exceptions Queue */}
        <div className="w-full md:w-80 border-r border-slate-200 bg-white/90 backdrop-blur-sm flex flex-col shrink-0">
          <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col gap-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                type="text"
                placeholder="Search queue..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9 text-xs focus-visible:ring-1 focus-visible:ring-slate-900/10 placeholder:text-slate-400 bg-white"
              />
            </div>
            <div className="flex gap-2">
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="h-8 text-xs flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-700 outline-none focus:border-slate-400 font-medium"
              >
                <option value="all">All Exceptions</option>
                <option value="amount">Amount Mismatch</option>
                <option value="missing">Missing Ledger</option>
                <option value="duplicate">Duplicate</option>
              </select>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {isLoading && exceptions.length === 0 ? (
              <div className="p-6 space-y-4 animate-pulse">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="border-b border-slate-100 pb-3">
                    <div className="h-4 w-24 bg-slate-200 rounded mb-2"></div>
                    <div className="h-3 w-32 bg-slate-100 rounded"></div>
                  </div>
                ))}
              </div>
            ) : filteredExceptions.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                {searchQuery ? "No matching items found" : "Queue is fully cleared"}
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {filteredExceptions.map((item) => {
                  const isSelected = selectedItem?.id === item.id;
                  const isOutflow = item.amount < 0;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        setSelectedItem(item);
                        setActiveTab("resolve");
                      }}
                      className={cn(
                        "w-full text-left p-4 flex flex-col transition-all border-l-4",
                        isSelected
                          ? "bg-slate-100/70 border-l-slate-900"
                          : "hover:bg-slate-50/60 border-l-transparent bg-white"
                      )}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className="font-bold text-sm text-slate-900 tabular-nums">
                          {isOutflow ? "-" : ""}
                          {formatAmountINR(item.amount)}
                        </span>
                        <span className="text-xs text-slate-400 font-semibold font-mono tabular-nums">
                          {item.date}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span
                          className={cn(
                            "inline-flex border px-2 py-0.5 rounded text-xs font-bold tracking-tight shrink-0",
                            getReasonBadgeStyles(item.reasonTag)
                          )}
                        >
                          {item.reasonTag}
                        </span>
                      </div>
                      <span className="text-xs text-slate-500 truncate font-medium mt-2 max-w-[240px]">
                        Ref: {item.reference}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Details & Workspace Panel */}
        <div className="flex-1 flex flex-col min-h-0 bg-transparent">
          {selectedItem ? (
            <div className="flex-1 flex flex-col lg:flex-row min-h-0">
              {/* Center Panel: suggested details, AI metrics */}
              <div className="flex-1 flex flex-col overflow-y-auto p-6 space-y-6 border-r border-slate-200">
                {/* Header overview */}
                <div className="bg-white/80 backdrop-blur-sm p-5 rounded-lg border border-slate-200/80 shadow-sm">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        Active Transaction Exception
                      </span>
                      <h2 className="text-xl font-extrabold text-slate-900 mt-1">
                        {selectedItem.amount < 0 ? "-" : ""}
                        {formatAmountINR(selectedItem.amount)}
                      </h2>
                      <p className="text-xs text-slate-500 font-semibold mt-1">
                        Reference ID: {selectedItem.reference} · Source: {selectedItem.source}
                      </p>
                    </div>
                    {selectedItem.flags.length > 0 && (
                      <div className="flex flex-wrap gap-1 items-center">
                        {selectedItem.flags.map((f, i) => (
                          <span
                            key={i}
                            className="bg-amber-50 text-amber-800 border border-amber-200/60 rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                          >
                            {f}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* AI explanation and metrics */}
                <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white rounded-lg p-5 border border-slate-900 shadow-md">
                  <div className="flex items-center gap-2 text-white/90">
                    <Sparkles className="w-4.5 h-4.5 text-blue-400 animate-pulse shrink-0" />
                    <span className="text-xs font-bold uppercase tracking-widest text-slate-300">
                      Matching Engine Intelligence
                    </span>
                  </div>
                  <blockquote className="mt-3 border-l-2 border-slate-500 pl-4">
                    <p className="text-sm font-medium leading-relaxed italic text-slate-100">
                      &ldquo;{selectedItem.reasonText}&rdquo;
                    </p>
                  </blockquote>
                  <div className="mt-4 flex items-center gap-4 text-xs font-semibold text-slate-300 border-t border-white/10 pt-3">
                    <span className="flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                      Status: PENDING_HUMAN_REVIEW
                    </span>
                    <span>•</span>
                    <span>Classified as exception</span>
                  </div>
                </div>

                {/* Audit trail / signal analysis */}
                <div className="bg-white/80 backdrop-blur-sm p-5 rounded-lg border border-slate-200/80 shadow-sm space-y-4">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                    <TrendingUp className="w-4 h-4 text-slate-400" />
                    Transaction Signal Breakdown
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="p-3 border border-slate-100 rounded bg-slate-50/50">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Amount Delta</span>
                      <p className="text-xs font-bold text-slate-700 mt-1">
                        {selectedItem.reasonTag.includes("Amount mismatch") ? "Flagged Outlier" : "Fuzzy Matches"}
                      </p>
                    </div>
                    <div className="p-3 border border-slate-100 rounded bg-slate-50/50">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Timing delay</span>
                      <p className="text-xs font-bold text-slate-700 mt-1">
                        {selectedItem.date}
                      </p>
                    </div>
                    <div className="p-3 border border-slate-100 rounded bg-slate-50/50">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Audit state</span>
                      <p className="text-xs font-bold text-slate-700 mt-1">Unreconciled</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Panel: Tabs layout for actions (Resolve, Manual, Audit) */}
              <div className="w-full lg:w-[420px] bg-white/90 backdrop-blur-sm border-l border-slate-200 flex flex-col shrink-0">
                {/* Tabs bar */}
                <div className="flex border-b border-slate-200 text-xs shrink-0">
                  <button
                    onClick={() => setActiveTab("resolve")}
                    className={cn(
                      "flex-1 text-center py-3 font-bold border-b-2 transition-all",
                      activeTab === "resolve"
                        ? "border-slate-900 text-slate-950 bg-slate-50/30"
                        : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50/50"
                    )}
                  >
                    Resolve Match
                  </button>
                  <button
                    onClick={() => setActiveTab("manual")}
                    className={cn(
                      "flex-1 text-center py-3 font-bold border-b-2 transition-all",
                      activeTab === "manual"
                        ? "border-slate-900 text-slate-950 bg-slate-50/30"
                        : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50/50"
                    )}
                  >
                    Manual Match
                  </button>
                  <button
                    onClick={() => setActiveTab("audit")}
                    className={cn(
                      "flex-1 text-center py-3 font-bold border-b-2 transition-all",
                      activeTab === "audit"
                        ? "border-slate-900 text-slate-950 bg-slate-50/30"
                        : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50/50"
                    )}
                  >
                    Audit Trail
                  </button>
                </div>

                {/* Tab content area */}
                <div className="flex-1 overflow-y-auto p-5">
                  {activeTab === "resolve" && (
                    <div className="space-y-5">
                      <div className="flex flex-col gap-2">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                          Reviewer Justification / Comment (Optional)
                        </label>
                        <textarea
                          placeholder="Provide audit context for final approval or rejection..."
                          value={resolveComment}
                          onChange={(e) => setResolveComment(e.target.value)}
                          disabled={isSubmitting}
                          rows={4}
                          className="w-full text-xs p-3 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-950 resize-none disabled:bg-slate-50"
                        />
                      </div>

                      <div className="flex flex-col gap-2 pt-2">
                        <Button
                          disabled={isSubmitting}
                          onClick={() => handleApproveAction()}
                          className="w-full bg-green-600 hover:bg-green-700 text-white font-bold h-10 shadow-sm"
                        >
                          {isSubmitting ? "Processing..." : "Approve Match Suggestion"}
                        </Button>
                        <Button
                          variant="outline"
                          disabled={isSubmitting}
                          onClick={() => handleRejectAction()}
                          className="w-full border-red-200 text-red-600 hover:bg-red-50 font-bold h-10 hover:text-red-700"
                        >
                          {isSubmitting ? "Processing..." : "Reject Match Suggestion"}
                        </Button>
                      </div>
                      <p className="text-[10px] text-slate-400 font-semibold text-center leading-relaxed">
                        Finalizing suggestions updates the state of all associated canonical ledger
                        items to LOCKED_APPROVED.
                      </p>
                    </div>
                  )}

                  {activeTab === "manual" && (
                    <div className="space-y-4">
                      {/* Search available transactions */}
                      <form onSubmit={handleAvailableLedgersSearch} className="flex gap-2 shrink-0">
                        <Input
                          placeholder="Search available invoices..."
                          value={ledgerSearch}
                          onChange={(e) => setLedgerSearch(e.target.value)}
                          className="h-8 text-xs focus-visible:ring-1 focus-visible:ring-slate-950"
                        />
                        <Button type="submit" size="sm" className="h-8 bg-slate-950 hover:bg-slate-900 font-semibold text-xs px-3">
                          Find
                        </Button>
                      </form>

                      {/* Available Ledgers List */}
                      <div className="border border-slate-200 rounded-md overflow-hidden bg-white">
                        <div className="bg-slate-100 px-3 py-2 border-b border-slate-200 grid grid-cols-[auto_1fr_auto_auto] gap-3 items-center text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                          <div className="w-4"></div>
                          <span>Ref / Details</span>
                          <span className="text-right">Amount</span>
                          <span className="text-right w-10">Match</span>
                        </div>

                        <div className="max-h-[220px] overflow-y-auto divide-y divide-slate-100">
                          {isLoadingLedgers ? (
                            <div className="p-6 text-center text-xs text-slate-400 animate-pulse">
                              Scoring candidates...
                            </div>
                          ) : availableLedgers.length === 0 ? (
                            <div className="p-6 text-center text-xs text-slate-400">
                              No available unmatched items.
                            </div>
                          ) : (
                            availableLedgers.map((l) => {
                              const isChecked = selectedLedgerIds.has(l.id);
                              return (
                                <div
                                  key={l.id}
                                  onClick={() => handleToggleLedgerSelection(l.id)}
                                  className={cn(
                                    "px-3 py-2 grid grid-cols-[auto_1fr_auto_auto] gap-3 items-center hover:bg-slate-50/60 cursor-pointer text-xs transition-colors",
                                    isChecked && "bg-slate-50"
                                  )}
                                >
                                  <Checkbox
                                    checked={isChecked}
                                    onCheckedChange={() => handleToggleLedgerSelection(l.id)}
                                    className="rounded border-slate-300 w-4 h-4"
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                  <div className="flex flex-col min-w-0">
                                    <span className="font-bold text-slate-900 truncate">
                                      {l.referenceNumber || l.description}
                                    </span>
                                    <div className="flex items-center gap-1 mt-0.5 text-[10px] text-slate-400 font-medium font-mono tabular-nums leading-none">
                                      <span>{l.date}</span>
                                      <span>•</span>
                                      <span className="uppercase">{l.sourceSystem}</span>
                                    </div>
                                  </div>
                                  <span className="font-bold text-slate-950 text-right tabular-nums">
                                    {formatAmountINR(l.amount * 100)}
                                  </span>
                                  <div className="flex flex-col items-end shrink-0 w-10">
                                    {l.score !== undefined && l.score > -Infinity ? (
                                      <span className={cn(
                                        "font-bold tabular-nums",
                                        l.confidenceBand === "VERY_HIGH" || l.confidenceBand === "HIGH" ? "text-green-600" :
                                        l.confidenceBand === "MEDIUM" ? "text-amber-600" : "text-red-600"
                                      )}>
                                        {Math.round(l.score)}%
                                      </span>
                                    ) : (
                                      <span className="text-slate-300">-</span>
                                    )}
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>

                      {/* Manual Match Calculator */}
                      <div className="p-3 border border-slate-200/80 rounded bg-slate-50 text-xs space-y-2.5">
                        <div className="flex justify-between items-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                          <span>Match calculation</span>
                          <span>Details</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-500 font-semibold">Bank amount:</span>
                          <span className="font-bold text-slate-800">
                            {formatAmountINR(selectedItem.amount)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-500 font-semibold">Selected ledger total:</span>
                          <span className="font-bold text-slate-800">
                            {formatAmountINR(selectedLedgersSum)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center border-t border-slate-200/60 pt-2 font-semibold">
                          <span className="text-slate-500">Unreconciled delta:</span>
                          <span
                            className={cn(
                              "font-bold",
                              selectedLedgersDelta === 0 ? "text-green-600" : "text-amber-600"
                            )}
                          >
                            {formatAmountINR(selectedLedgersDelta)}
                          </span>
                        </div>
                      </div>

                      {/* Required Comment */}
                      <div className="flex flex-col gap-2">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                          Justification Comment
                          <span className="text-red-500 font-bold">*</span>
                        </label>
                        <textarea
                          placeholder="Provide the compliance reasoning for manual match (e.g. payment timing drift, multi-invoice settlement)..."
                          value={manualComment}
                          onChange={(e) => setManualComment(e.target.value)}
                          disabled={isSubmitting}
                          rows={3}
                          className="w-full text-xs p-3 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-950 resize-none disabled:bg-slate-50"
                        />
                      </div>

                      <Button
                        disabled={isSubmitting || selectedLedgerIds.size === 0 || !manualComment.trim()}
                        onClick={() => handleManualMatchConfirm()}
                        className="w-full bg-slate-950 hover:bg-slate-900 text-white font-bold h-10 shadow-sm"
                      >
                        {isSubmitting ? "Linking..." : "Confirm Manual Link"}
                      </Button>
                    </div>
                  )}

                  {activeTab === "audit" && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                        <span>Compliance History</span>
                        <span>Actor Details</span>
                      </div>

                      {isLoadingAudit ? (
                        <div className="p-8 text-center text-xs text-slate-400 animate-pulse">
                          Fetching trail...
                        </div>
                      ) : auditLogs.length === 0 ? (
                        <div className="p-8 text-center text-xs text-slate-400">
                          No audit trail events found.
                        </div>
                      ) : (
                        <div className="relative border-l border-slate-200 pl-4 space-y-5 py-2 text-xs">
                          {auditLogs.map((log) => (
                            <div key={log.id} className="relative">
                              <span className="absolute -left-[21px] top-1.5 w-2.5 h-2.5 rounded-full border bg-white border-slate-400 flex items-center justify-center shrink-0">
                                <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                              </span>
                              <div className="flex flex-col">
                                <span className="font-bold text-slate-900 uppercase tracking-tight">
                                  {log.action.replace(/_/g, " ")}
                                </span>
                                <span className="text-[10px] text-slate-400 font-semibold mt-0.5 flex items-center gap-1">
                                  <User className="w-3 h-3" /> {log.actorEmail} · <Clock className="w-3.5 h-3.5" />{" "}
                                  <span className="tabular-nums">
                                    {new Date(log.timestamp).toLocaleString("en-IN", {
                                      month: "short",
                                      day: "numeric",
                                      hour: "numeric",
                                      minute: "2-digit",
                                    })}
                                  </span>
                                </span>
                                {log.reason && (
                                  <div className="mt-1.5 bg-slate-50 p-2.5 rounded border border-slate-100 text-slate-600 text-xs leading-relaxed italic">
                                    &ldquo;{log.reason}&rdquo;
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-slate-400">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4 ring-8 ring-slate-100/50">
                <FileSpreadsheet className="w-8 h-8 text-slate-500" />
              </div>
              <h3 className="text-sm font-bold text-slate-800">Select an Exception</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-[280px]">
                Choose an item from the left queue to check AI suggestions, perform manual linking, or approve changes.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
