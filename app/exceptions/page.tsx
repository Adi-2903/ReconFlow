"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Search, Filter, ArrowUpDown, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useData } from "@/lib/data-context";
import { toast } from "sonner";

type ReasonTag = "No ledger match found" | "Amount mismatch > ₹1,000" | "Duplicate detected" | "Unknown counterparty" | "Stripe fee deduction" | "Bank processing charge" | "Currency conversion" | "Partial payment" | "Bulk payment mismatch" | "Manually rejected" | string;

interface ExceptionItem {
  id: string;
  amount: number;
  date: string;
  source: string;
  reference: string;
  reasonTag: ReasonTag;
  reasonText: string;
  flags: string[];
}

export default function ExceptionsPage() {
  const [items, setItems] = useState<ExceptionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvingIds, setResolvingIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const { exceptionCount, refreshExceptions, isDemoMode } = useData();

  const displayedItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(item =>
      item.reference.toLowerCase().includes(q) ||
      item.reasonTag.toLowerCase().includes(q) ||
      item.reasonText.toLowerCase().includes(q) ||
      item.amount.toString().includes(q)
    );
  }, [items, searchQuery]);

  useEffect(() => {
    const fetchExceptions = async () => {
      setIsLoading(true);
      setError(null);
      try {
        if (isDemoMode) {
          // In demo mode, simulate loading and load from sharedMatches
          await new Promise(resolve => setTimeout(resolve, 600));
          const { sharedMatches } = await import("@/lib/data");
          setItems(sharedMatches.filter(m => m.status === 'pending' && m.confidenceScore < 0.9).map(m => ({
            id: m.id,
            amount: m.bankRow.amount,
            date: m.bankRow.date,
            source: "Bank",
            reference: m.bankRow.reference,
            reasonTag: m.reasonText,
            reasonText: m.reasonText,
            flags: []
          })));
        } else {
          const res = await fetch("/api/exceptions");
          if (res.ok) {
            const data = await res.json();
            setItems(data.exceptions || []);
          } else {
            setError("Failed to fetch exceptions");
          }
        }
      } catch (err) {
        console.error("Failed to fetch exceptions", err);
        setError("Failed to connect to server");
      } finally {
        setIsLoading(false);
      }
    };
    fetchExceptions();
  }, [refreshExceptions, isDemoMode]);

  const handleResolve = async (id: string) => {
    setResolvingIds(prev => new Set(prev).add(id));
    try {
      // Typically resolving an exception means approving a new ledger entry or discarding it.
      // For now, we'll hit the reject endpoint just to clear it, or a resolve endpoint if it existed.
      // To clear it, we update status to 'approved' (meaning resolved).
      await fetch(`/api/matches/${id}/approve`, { method: "POST" });
      
      setItems(prev => prev.filter(item => item.id !== id));
      refreshExceptions();
      toast.success("Exception marked as resolved");
    } catch (err) {
      console.error("Failed to resolve exception", err);
      toast.error("Failed to resolve exception");
    } finally {
      setResolvingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const getReasonTagClass = (tag: ReasonTag) => {
    if (tag === "No ledger match found" || tag === "Manually rejected") return "bg-red-100 text-red-700 border-red-200";
    if (tag === "Amount mismatch > ₹1,000") return "bg-amber-100 text-amber-800 border-amber-200";
    if (tag === "Duplicate detected") return "bg-orange-100 text-orange-800 border-orange-200";
    return "bg-slate-100 text-slate-700 border-slate-200";
  };

  const totalValue = items.reduce((sum, item) => sum + Math.abs(item.amount), 0);
  const formattedTotalValue = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(totalValue / 100);

  return (
    <div className="p-4 sm:p-6 sm:px-8 flex flex-col gap-6 sm:gap-8 h-full font-sans text-slate-900 mx-auto w-full max-w-7xl">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 shrink-0 pt-2 sm:pt-4">
        <div className="flex flex-col">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">Exceptions</h1>
          <p className="text-sm text-slate-500 mt-1 font-medium">
            Transactions that require manual review or could not be automatically matched.
          </p>
          <div className="flex items-center gap-3 mt-4 text-sm font-medium">
            <span className="flex items-center gap-1.5 text-slate-700">
              <span className="w-2 h-2 rounded-full bg-red-500 shrink-0"></span>
              {exceptionCount} unresolved
            </span>
            <span className="text-slate-300">|</span>
            <span className="text-slate-700">{formattedTotalValue} total value at risk</span>
            <span className="text-slate-300">|</span>
            <span className="text-slate-700">Oldest: {items.length > 0 ? items[items.length - 1].date : "N/A"}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="h-9 gap-2 text-slate-600 bg-white border-slate-200 hover:bg-slate-50">
            <Filter className="h-4 w-4" />
            Filter
          </Button>
          <Button variant="outline" className="h-9 gap-2 text-slate-600 bg-white border-slate-200 hover:bg-slate-50">
            <ArrowUpDown className="h-4 w-4" />
            Sort
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 pb-1 sticky top-0 z-10 -mx-1 px-1">
        <button className="px-3 py-1 text-sm font-medium rounded-full border transition-colors bg-slate-900 text-white border-slate-900">
          All ({exceptionCount})
        </button>
      </div>

      <div className="flex-1 flex flex-col min-h-0 bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-slate-400" />
            <input 
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by ID, reason, or amount..." 
              className="w-full h-8 pl-9 pr-3 text-sm bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 transition-all placeholder:text-slate-400"
            />
          </div>
        </div>
        
        <div className="flex-1 overflow-auto bg-slate-50/30">
          <div className="flex flex-col">
            {displayedItems.map((item) => {
              const isResolving = resolvingIds.has(item.id);
              const formattedAmount = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Math.abs(item.amount));
              const amountColor = item.amount < 0 ? "text-red-600" : "text-slate-900";
              
              return (
                <div 
                  key={item.id} 
                  className={cn(
                    "p-4 border-b border-slate-200 flex flex-col lg:flex-row gap-4 lg:gap-6 lg:items-start transition-all duration-300 bg-white hover:bg-slate-50",
                    isResolving ? "opacity-0 h-0 overflow-hidden py-0 border-transparent" : "opacity-100"
                  )}
                >
                  {/* Left Section - Amount & Info */}
                  <div className="w-full lg:w-48 shrink-0 flex flex-col">
                    <span className={cn("text-xl font-bold tracking-tight", amountColor)}>
                      {item.amount < 0 ? "-" : ""}{formattedAmount}
                    </span>
                    <span className="text-sm font-medium text-slate-500 mt-1">
                      {item.date} · {item.source}
                    </span>
                    <span className="text-xs font-mono text-slate-400 mt-1 uppercase tracking-wider">
                      {item.reference}
                    </span>
                  </div>

                  {/* Middle Section - Reason & Explanation */}
                  <div className="flex-1 flex flex-col">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                      Reason
                    </span>
                    <div className="mb-2">
                      <span className={cn("inline-flex border px-2 py-0.5 rounded text-xs font-semibold", getReasonTagClass(item.reasonTag))}>
                        {item.reasonTag}
                      </span>
                    </div>
                    <p className="text-sm text-slate-500 font-medium leading-relaxed max-w-2xl">
                      {item.reasonText}
                    </p>
                  </div>

                  {/* Right Section - Actions */}
                  <div className="w-full lg:w-auto flex flex-row lg:flex-col gap-2 shrink-0 pt-1 lg:pt-0">
                    <Button variant="outline" size="sm" className="h-8 text-xs font-medium border-slate-300 w-full lg:w-36" onClick={() => console.log("Create ledger entry clicked")}>
                      Create ledger entry
                    </Button>
                    <Button variant="outline" size="sm" className="h-8 text-xs font-medium border-green-600 text-green-700 bg-green-50 hover:bg-green-100 hover:text-green-800 w-full lg:w-36" onClick={() => handleResolve(item.id)}>
                      Mark as resolved
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 text-xs font-medium text-slate-500 w-full lg:w-36">
                      Investigate
                    </Button>
                  </div>
                </div>
              );
            })}
            
            {searchQuery && displayedItems.length === 0 && !isLoading && (
              <div className="p-8 text-center text-sm text-slate-400">
                No exceptions match &ldquo;{searchQuery}&rdquo;
              </div>
            )}

            {isLoading && items.length === 0 && !error && (
              <div className="p-8 flex flex-col gap-6">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex flex-col lg:flex-row gap-6 animate-pulse border-b border-slate-100 pb-6 last:border-0">
                    <div className="w-full lg:w-48 flex flex-col gap-2">
                      <div className="h-6 w-24 bg-slate-200 rounded"></div>
                      <div className="h-4 w-32 bg-slate-100 rounded"></div>
                    </div>
                    <div className="flex-1 flex flex-col gap-2">
                      <div className="h-4 w-16 bg-slate-200 rounded"></div>
                      <div className="h-4 w-full max-w-2xl bg-slate-100 rounded"></div>
                      <div className="h-4 w-3/4 max-w-xl bg-slate-100 rounded"></div>
                    </div>
                    <div className="w-full lg:w-auto flex flex-col gap-2 shrink-0">
                      <div className="h-8 w-36 bg-slate-200 rounded"></div>
                      <div className="h-8 w-36 bg-slate-200 rounded"></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            {error && (
              <div className="p-12 text-center flex flex-col items-center">
                <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-4 ring-8 ring-red-50/50">
                  <AlertCircle className="w-8 h-8 text-red-600" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-1 tracking-tight">Something went wrong</h3>
                <p className="text-sm text-slate-500 max-w-[250px] text-center mb-6">
                  {error}
                </p>
                <Button variant="outline" onClick={() => refreshExceptions()}>Retry</Button>
              </div>
            )}

            {!isLoading && !error && items.length === 0 && (
              <div className="p-12 text-center flex flex-col items-center">
                 <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mb-4 ring-8 ring-green-50/50">
                  <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-1 tracking-tight">All caught up!</h3>
                <p className="text-sm text-slate-500 max-w-[250px] text-center mb-6">
                  There are no unresolved exceptions left.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
