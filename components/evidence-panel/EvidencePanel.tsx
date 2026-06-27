"use client";

import React, { useEffect, useState } from "react";
import { X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface EvidencePanelProps {
  match: {
    id: string;
    bankRow: { amount: number; date: string; description: string; referenceId: string; source: string };
    ledgerRows: Array<{ amount: number; date: string; memo: string; invoiceRef: string }>;
    confidenceScore: number;
    matchType: string;
    matchOutcome?: string;
    discrepancyType?: string;
    evidenceList?: Array<{ code: string; message: string }> | null;
    reasonText: string;
    scoringBreakdown: { amountScore: number; dateScore: number; textScore: number };
    riskScore: number; // 0 – 100 integer (Phase 8)
    status: 'pending' | 'approved' | 'rejected';
    flags?: string[];
  } | null;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onClose: () => void;
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
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  }
  return dateStr;
};

export function EvidencePanel({ match, onApprove, onReject, onClose }: EvidencePanelProps) {
  // Retain data allowing the slide-out animation to finish smoothly
  const [activeMatch, setActiveMatch] = useState(match);
  
  if (match && match !== activeMatch) {
    setActiveMatch(match);
  }

  const isOpen = !!match;
  const displayMatch = match || activeMatch;

  return (
    <>
      <div 
        className={`fixed inset-0 bg-black/20 z-40 sm:hidden transition-opacity duration-200 ${isOpen ? "opacity-100" : "opacity-0 pointer-events-none"}`} 
        onClick={onClose}
      />
      <div 
        className={`fixed top-0 right-0 h-full w-full sm:w-[420px] bg-white shadow-2xl z-50 flex flex-col transition-transform duration-200 ease-out font-sans ${isOpen ? "translate-x-0" : "translate-x-full"}`}
      >
        {displayMatch && <EvidenceContent match={displayMatch} onApprove={onApprove} onReject={onReject} onClose={onClose} />}
      </div>
    </>
  );
}

function EvidenceContent({ match, onApprove, onReject, onClose }: { match: NonNullable<EvidencePanelProps['match']>, onApprove: (id: string) => void, onReject: (id: string) => void, onClose: () => void }) {
  const scorePct = Math.round(match.confidenceScore * 100);
  
  const getPillColor = (band?: string | null, val?: number) => {
    const b = band?.toUpperCase();
    if (b === "VERY_HIGH" || b === "HIGH" || (val !== undefined && val >= 0.95)) return "bg-green-100 text-green-700 border-green-200";
    if (b === "MEDIUM" || (val !== undefined && val >= 0.6)) return "bg-amber-100 text-amber-700 border-amber-200";
    return "bg-red-100 text-red-700 border-red-200";
  };

  const getConfidenceLabel = (band?: string | null, score?: number) => {
    if (band) {
      switch (band.toUpperCase()) {
        case "VERY_HIGH":
        case "HIGH":
          return "High Confidence";
        case "MEDIUM":
          return "Medium Confidence";
        case "LOW":
        case "NONE":
        default:
          return "Needs Review";
      }
    }
    const s = score ?? 0;
    if (s >= 0.95) return "High Confidence";
    if (s >= 0.6) return "Medium Confidence";
    return "Needs Review";
  };
  
  const getOverallColor = (val: number) => {
    if (val >= 0.95) return { bg: "bg-green-50", border: "border-green-500", text: "text-green-800" };
    if (val >= 0.6) return { bg: "bg-amber-50", border: "border-amber-500", text: "text-amber-800" };
    return { bg: "bg-red-50", border: "border-red-500", text: "text-red-800" };
  };

  const overallClass = getOverallColor(match.confidenceScore);

  const bankAmount = match.bankRow.amount;
  const ledgerAmount = match.ledgerRows.reduce((a, b) => a + b.amount, 0);
  const amountDelta = Math.abs(bankAmount - ledgerAmount);

  const bDate = new Date(match.bankRow.date);
  const lDate = match.ledgerRows.length > 0 ? new Date(match.ledgerRows[0].date) : bDate;
  const dayDelta = Math.abs(Math.round((bDate.getTime() - lDate.getTime()) / (1000 * 60 * 60 * 24)));

  const flags = match.flags || [];

  return (
    <>
      <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-6 py-4 flex flex-col shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="font-semibold uppercase tracking-wider">Evidence</span>
            <span>•</span>
            <span className="font-mono">{match.id}</span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-md text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border ${getPillColor((match as any).confidenceBand, match.confidenceScore)}`}>
            <span className="font-bold text-sm tracking-tight">{getConfidenceLabel((match as any).confidenceBand, match.confidenceScore)}</span>
          </div>
          {match.matchOutcome && (
            <div className="px-2.5 py-0.5 rounded-full border bg-slate-100 border-slate-200 text-slate-700 text-[10px] font-bold uppercase tracking-wider">
              {match.matchOutcome.replace(/_/g, " ")}
            </div>
          )}
          {match.discrepancyType && match.discrepancyType !== "NONE" && (
            <div className="px-2.5 py-0.5 rounded-full border bg-amber-50 border-amber-200 text-amber-700 text-[10px] font-bold uppercase tracking-wider">
              {match.discrepancyType.replace(/_/g, " ")}
            </div>
          )}
          {/* Phase 8 — Risk Score composite badge (factor breakdown deferred to Phase 9) */}
          <div
            className={`px-2.5 py-0.5 rounded-full border text-[10px] font-bold tracking-wider ${
              match.riskScore >= 70
                ? "bg-red-50 border-red-300 text-red-700"
                : match.riskScore >= 35
                ? "bg-amber-50 border-amber-300 text-amber-700"
                : "bg-green-50 border-green-300 text-green-700"
            }`}
            title="Risk score (Phase 8)"
          >
            {match.riskScore >= 70 ? "⚠️ High Risk" : match.riskScore >= 35 ? "Med Risk" : "✓ Low Risk"}
            {" "}{match.riskScore}/100
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        
        {/* Reason Section */}
        <section>
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-3">Why this match?</h3>
          <blockquote className={`p-4 border-l-4 rounded-r-md ${overallClass.bg} ${overallClass.border} ${overallClass.text}`}>
            <p className="text-sm font-medium leading-relaxed">{match.reasonText}</p>
          </blockquote>
          
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <div 
              className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-tight border ${getPillColor(undefined, match.scoringBreakdown.amountScore)}`}
              title={`Amount score: based on ₹${amountDelta} difference vs threshold`}
            >
              Amount {match.scoringBreakdown.amountScore >= 0.95 ? "Matched" : match.scoringBreakdown.amountScore >= 0.6 ? "Near Match" : "Mismatch"}
            </div>
            <div 
              className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-tight border ${getPillColor(undefined, match.scoringBreakdown.dateScore)}`}
              title={`Date score: based on date proximity`}
            >
              Date {match.scoringBreakdown.dateScore >= 0.95 ? "Same Day" : match.scoringBreakdown.dateScore >= 0.6 ? "Close Date" : "Timing Discrepancy"}
            </div>
            <div 
              className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-tight border ${getPillColor(undefined, match.scoringBreakdown.textScore)}`}
              title={`Text score: based on reference and description similarity`}
            >
              Text {match.scoringBreakdown.textScore >= 0.85 ? "Ref Match" : match.scoringBreakdown.textScore >= 0.4 ? "Partial Similarity" : "No Match"}
            </div>
          </div>
        </section>

        {/* Comparison Section */}
        <section>
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-3">Transaction detail</h3>
          
          <div className="border border-slate-200 rounded-md overflow-hidden bg-slate-50 text-xs">
            <div className="grid grid-cols-2 border-b border-slate-200 bg-slate-100/50">
              <div className="p-2 font-semibold text-slate-500 uppercase tracking-wider text-[10px]">Bank Statement</div>
              <div className="p-2 font-semibold text-slate-500 uppercase tracking-wider text-[10px] border-l border-slate-200">Ledger</div>
            </div>
            
            {/* Amount */}
            <div className="grid grid-cols-2 border-b border-slate-200">
              <div className="p-3 bg-white font-bold">{formatINR(bankAmount)}</div>
              <div className={`p-3 border-l border-slate-200 ${amountDelta !== 0 ? 'bg-amber-50 text-amber-900 font-medium' : 'bg-white font-bold'}`}>
                {match.ledgerRows.length > 1 ? (
                  <div className="flex flex-col gap-1">
                    {match.ledgerRows.map((r, i) => <div key={i}>{formatINR(r.amount)}</div>)}
                    <div className="border-t border-slate-300 pt-1 font-bold">{formatINR(ledgerAmount)} total</div>
                  </div>
                ) : (
                  match.ledgerRows.length ? formatINR(ledgerAmount) : '—'
                )}
              </div>
            </div>
            
            {/* Date */}
            <div className="grid grid-cols-2 border-b border-slate-200">
              <div className="p-3 bg-white truncate" title={formatDate(match.bankRow.date)}>{formatDate(match.bankRow.date)}</div>
              <div className={`p-3 border-l border-slate-200 ${dayDelta !== 0 ? 'bg-amber-50 text-amber-900 font-medium' : 'bg-white'}`}>
                {match.ledgerRows.length ? match.ledgerRows.map(r => formatDate(r.date)).join(", ") : '—'}
              </div>
            </div>
            
            {/* Reference */}
            <div className="grid grid-cols-2 border-b border-slate-200">
              <div className="p-3 bg-white break-words">{match.bankRow.referenceId || "—"}</div>
              <div className={`p-3 border-l border-slate-200 bg-white`}>
                {match.ledgerRows.length ? match.ledgerRows.map(r => r.invoiceRef).join(", ") : '—'}
              </div>
            </div>

            {/* Desc / Memo */}
            <div className="grid grid-cols-2">
              <div className="p-3 bg-white break-words">{match.bankRow.description}</div>
              <div className={`p-3 border-l border-slate-200 bg-white`}>
                {match.ledgerRows.length ? match.ledgerRows.map(r => r.memo).join(" | ") : '—'}
              </div>
            </div>
          </div>
        </section>

        {/* Delta Analysis */}
        {match.matchType !== 'exact' && match.ledgerRows.length > 0 && (
          <section>
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-3">Difference breakdown</h3>
            
            <div className="space-y-4">
              <div className="flex items-start gap-4 text-sm">
                <div className="w-1/3 text-slate-500 font-medium">Amount</div>
                <div className={`w-2/3 font-semibold ${amountDelta === 0 ? 'text-green-600' : amountDelta > 1000 ? 'text-red-600' : 'text-amber-600'}`}>
                  {amountDelta === 0 ? "Exact match" : `₹${amountDelta} ${bankAmount > ledgerAmount ? 'over' : 'short'}`}
                </div>
              </div>

              <div className="flex items-start gap-4 text-sm">
                <div className="w-1/3 text-slate-500 font-medium">Date</div>
                <div className={`w-2/3 font-semibold ${dayDelta === 0 ? 'text-green-600' : dayDelta <= 3 ? 'text-amber-600' : 'text-red-600'}`}>
                  {dayDelta === 0 ? "Same day" : `${dayDelta} days apart`}
                </div>
              </div>

              {match.evidenceList && match.evidenceList.length > 0 ? (
                <div className="pt-3 border-t border-slate-100">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Audit Evidence Trails</h4>
                  <ul className="space-y-2 text-xs text-slate-600">
                    {match.evidenceList.map((e, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-amber-600 font-mono text-[9px] bg-amber-50 px-1.5 py-0.5 border border-amber-200 rounded shrink-0 mt-0.5">{e.code}</span>
                        <span>{e.message}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : flags.length > 0 ? (
                <div className="pt-2">
                  <ul className="space-y-2 text-sm text-slate-600">
                    {flags.includes('wire_fee') && (
                      <li className="flex items-start gap-2">
                        <span className="text-slate-400 mt-0.5">•</span>
                        <span>₹{amountDelta} difference matches typical HDFC/ICICI NEFT wire fee range (₹150–500)</span>
                      </li>
                    )}
                    {flags.includes('date_delay') && (
                      <li className="flex items-start gap-2">
                        <span className="text-slate-400 mt-0.5">•</span>
                        <span>1-3 day delay is normal bank clearing time in India</span>
                      </li>
                    )}
                    {flags.includes('bulk_payment') && (
                      <li className="flex items-start gap-2">
                        <span className="text-slate-400 mt-0.5">•</span>
                        <span>{match.ledgerRows.length} invoices combine to match the bank total exactly</span>
                      </li>
                    )}
                  </ul>
                </div>
              ) : null}
            </div>
          </section>
        )}
      </div>

      {/* Footer */}
      <div className="sticky bottom-0 bg-white border-t border-slate-100 p-6 shrink-0 mt-auto">
        {match.status === 'pending' ? (
          <div className="flex flex-col gap-3 text-center">
            <Button className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold shadow-sm h-11" onClick={() => onApprove(match.id)}>
              Approve this match
            </Button>
            <button className="text-xs font-bold text-red-600 hover:text-red-700 uppercase tracking-widest transition-colors py-1" onClick={() => onReject(match.id)}>
              Reject
            </button>
          </div>
        ) : match.status === 'approved' ? (
          <div className="flex flex-col items-center justify-center gap-1 text-green-600 font-sans">
            <div className="flex items-center gap-2 font-semibold">
              <Check className="w-5 h-5" />
              <span>Approved by you</span>
            </div>
            <span className="text-xs text-slate-400">Today at {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-1 text-red-600 font-sans">
            <div className="flex items-center gap-2 font-semibold">
              <X className="w-5 h-5" />
              <span>Rejected</span>
            </div>
            <span className="text-xs text-slate-400">Today at {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        )}
      </div>
    </>
  );
}
