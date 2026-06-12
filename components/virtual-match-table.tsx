// npm install @tanstack/react-virtual
"use client";

import React, { useState, useMemo, useCallback, useRef, useEffect, KeyboardEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { MatchData as MatchRowType } from "@/types/match";
import { CheckCircle2 } from "lucide-react";

type FilterType = "all" | "pending" | "approved" | "rejected" | "exceptions";

interface VirtualMatchTableProps {
  matches: MatchRowType[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onRowClick: (id: string) => void;
  filter: FilterType;
}

const formatINR = (amount: number) => {
  return amount.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const formatDate = (dateStr: string) => {
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  }
  return dateStr;
};

const truncate = (str: string, len: number) => {
  if (str.length <= len) return str;
  return str.slice(0, len) + "\u2026";
};

const MatchRowView = React.memo(({ 
  match, 
  index, 
  style, 
  isFocused, 
  onClick 
}: { 
  match: MatchRowType; 
  index: number; 
  style: React.CSSProperties; 
  isFocused: boolean;
  onClick: (id: string) => void 
}) => {
  const handleItemClick = useCallback(() => {
    onClick(match.id);
  }, [match.id, onClick]);

  const scorePct = Math.round(match.confidenceScore * 100);
  let colorClass = "bg-red-500";
  let badgeColor = "bg-red-100 text-red-700";
  if (match.confidenceScore >= 0.95) {
    colorClass = "bg-green-500";
    badgeColor = "bg-green-100 text-green-700";
  } else if (match.confidenceScore >= 0.6) {
    colorClass = "bg-amber-500";
    badgeColor = "bg-amber-100 text-amber-700";
  }

  let leftBorderClass = "border-l-transparent";
  if (match.status === "approved") {
    leftBorderClass = "border-l-green-500";
  } else if (match.status === "rejected") {
    leftBorderClass = "border-l-red-500";
  }

  return (
    <div
      style={style}
      className={`absolute top-0 left-0 w-full flex items-center border-b border-slate-100 cursor-pointer overflow-hidden border-l-4 pr-4 transition-colors ${leftBorderClass} ${isFocused ? "bg-slate-100 outline-none" : "hover:bg-slate-50 bg-white"}`}
      onClick={handleItemClick}
    >
      {/* Bank Side */}
      <div className="flex-1 flex flex-col justify-center px-4 overflow-hidden h-full py-1">
        <div className="flex items-center gap-2 truncate whitespace-nowrap">
          <span className="font-bold text-slate-900">{formatINR(match.bankRow.amount)}</span>
          <span className="text-slate-700 font-medium">{truncate(match.bankRow.description, 28)}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400 truncate whitespace-nowrap leading-tight mt-0.5">
          <span>{formatDate(match.bankRow.date)}</span>
          <span>•</span>
          <span>{match.bankRow.reference}</span>
        </div>
      </div>

      {/* Match Column */}
      <div className="w-[120px] flex flex-col items-center justify-center px-2 shrink-0">
        {match.matchType !== "none" ? (
          <>
            <div className="w-full bg-slate-200 h-[6px] rounded-full overflow-hidden flex">
              <div
                className={`h-full ${colorClass}`}
                style={{ width: `${scorePct}%` }}
              />
            </div>
            <div className="flex items-center justify-center gap-1.5 mt-1 relative w-full">
               <span className="font-bold text-[11px] text-slate-700 min-w-[30px]">
                {scorePct}%
              </span>
              <span className={`px-1.5 py-[1px] rounded text-[9px] font-bold uppercase tracking-wider ${badgeColor}`}>
                {match.matchType}
              </span>
            </div>
          </>
        ) : (
          <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
            No Match
          </span>
        )}
      </div>

      {/* Ledger Side */}
      <div className="flex-1 flex flex-col justify-center items-end px-4 overflow-hidden h-full py-1 text-right">
        {match.matchType === "none" ? (
          <span className="text-slate-400 italic text-sm">— No match</span>
        ) : match.matchType === "bulk" && match.ledgerRows ? (
          <>
            <div className="flex items-center gap-2 truncate whitespace-nowrap justify-end">
              <span className="text-slate-700 font-medium">Bulk ({match.ledgerRows.length} items)</span>
              <span className="font-bold text-slate-900">
                {formatINR(match.ledgerRows.reduce((s, r) => s + r.amount, 0))}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400 truncate whitespace-nowrap leading-tight mt-0.5 justify-end">
              <span>{match.ledgerRows.map(r => formatINR(r.amount)).join(" + ")}</span>
            </div>
          </>
        ) : match.ledgerRow ? (
            <>
            <div className="flex items-center gap-2 truncate whitespace-nowrap justify-end">
              <span className="text-slate-700 font-medium">{truncate(match.ledgerRow.memo, 28)}</span>
              <span className="font-bold text-slate-900">{formatINR(match.ledgerRow.amount)}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400 truncate whitespace-nowrap leading-tight mt-0.5 justify-end">
              <span>Ref: {match.ledgerRow.invoiceRef}</span>
            </div>
          </>
        ) : (
          <span className="text-slate-400 italic text-sm">— No match</span>
        )}
      </div>
    </div>
  );
});

MatchRowView.displayName = "MatchRowView";

export function VirtualMatchTable({
  matches,
  onApprove,
  onReject,
  onRowClick,
  filter: initialFilter,
}: VirtualMatchTableProps) {
  const [activeFilter, setActiveFilter] = useState<FilterType>(initialFilter);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const scrollElementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setFocusedIndex(-1);
  }, [activeFilter]);

  const filteredMatches = useMemo(() => {
    return matches.filter((m) => {
      if (activeFilter === "all") return true;
      if (activeFilter === "exceptions") return m.matchType === "none";
      return m.status === activeFilter; // covers pending, approved, rejected
    });
  }, [matches, activeFilter]);

  const counts = useMemo(() => {
    return {
      all: matches.length,
      pending: matches.filter((m) => m.status === "pending").length,
      approved: matches.filter((m) => m.status === "approved").length,
      rejected: matches.filter((m) => m.status === "rejected").length,
      exceptions: matches.filter((m) => m.matchType === "none").length,
    };
  }, [matches]);

  const virtualizer = useVirtualizer({
    count: filteredMatches.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () => 56,
    overscan: 5,
  });

  const handleRowClickCall = useCallback(
    (id: string) => {
      onRowClick(id);
    },
    [onRowClick]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (filteredMatches.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = Math.min(prev + 1, filteredMatches.length - 1);
          virtualizer.scrollToIndex(next);
          return next;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = Math.max(prev - 1, 0);
          virtualizer.scrollToIndex(next);
          return next;
        });
      } else if (e.key === "Enter" && focusedIndex >= 0) {
        e.preventDefault();
        onRowClick(filteredMatches[focusedIndex].id);
      } else if (e.key === "a" && focusedIndex >= 0) {
        e.preventDefault();
        onApprove(filteredMatches[focusedIndex].id);
      } else if (e.key === "r" && focusedIndex >= 0) {
        e.preventDefault();
        onReject(filteredMatches[focusedIndex].id);
      }
    },
    [filteredMatches, focusedIndex, onApprove, onReject, onRowClick, virtualizer]
  );

  const filters: { key: FilterType; label: string }[] = [
    { key: "all", label: "All" },
    { key: "pending", label: "Pending" },
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Rejected" },
    { key: "exceptions", label: "Exceptions" },
  ];

  return (
    <div 
      className="flex flex-col w-full bg-white border border-slate-200 rounded-sm shadow-sm font-sans"
      onKeyDown={handleKeyDown}
      tabIndex={0}
      style={{ outline: "none" }}
    >
      <div className="flex items-center gap-2 p-3 border-b border-slate-200 bg-slate-50 sticky top-0 z-10 overflow-x-auto">
        {filters.map((f) => {
          const isActive = activeFilter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setActiveFilter(f.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider transition-colors ${
                isActive
                  ? "text-white"
                  : "text-slate-600 hover:bg-slate-100 bg-white border border-slate-200 shadow-sm"
              }`}
              style={isActive ? { backgroundColor: "var(--color-background-info, #0f172a)" } : {}}
            >
              {f.label}
              <span
                className={`flex items-center justify-center min-w-[20px] h-5 rounded-full px-1 text-[10px] ${
                  isActive ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"
                }`}
              >
                {counts[f.key]}
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-[1fr_120px_1fr] border-b border-slate-200 bg-slate-50 font-mono text-[10px] uppercase tracking-widest text-slate-400 py-2">
         <div className="px-4">Bank Statement</div>
         <div className="text-center">Match</div>
         <div className="px-4 text-right">Ledger Entry</div>
      </div>

      <div
        ref={scrollElementRef}
        className="w-full overflow-y-auto"
        style={{ height: "calc(100vh - 220px)" }}
      >
        {filteredMatches.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 py-20 px-4 text-center">
            {activeFilter === "pending" ? (
              <>
                <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-4">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <p className="font-semibold text-lg text-slate-900">All caught up</p>
                <p className="text-sm mt-1">No items pending review.</p>
              </>
            ) : activeFilter === "exceptions" ? (
              <>
                <p className="font-semibold text-lg text-slate-900">No exceptions this month.</p>
                <p className="text-sm mt-1 text-slate-500">Everything is neatly matched.</p>
              </>
            ) : (
               <p className="text-sm">No items found.</p>
            )}
          </div>
        ) : (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const match = filteredMatches[virtualRow.index];
              return (
                <MatchRowView
                  key={virtualRow.key}
                  index={virtualRow.index}
                  match={match}
                  style={{
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  isFocused={focusedIndex === virtualRow.index}
                  onClick={handleRowClickCall}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
