"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Lock,
  Upload,
  CheckCircle2,
  RefreshCw,
  FileText,
  AlertTriangle,
  Loader2,
  Database,
  ArrowRight,
  Sparkles,
  Layers,
  History,
  X,
  FileSpreadsheet,
  Trash2,
  ChevronDown
} from "lucide-react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useData } from "@/lib/data-context";
import { FileIngestionWizard } from "@/components/file-ingestion-wizard";

function timeAgo(dateParam: string | null) {
  if (!dateParam) return "";
  const date = new Date(dateParam);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diffInSeconds < 60) return "just now";
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `${diffInMinutes} minute${diffInMinutes > 1 ? 's' : ''} ago`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours} hour${diffInHours > 1 ? 's' : ''} ago`;
  const diffInDays = Math.floor(diffInHours / 24);
  return `${diffInDays} day${diffInDays > 1 ? 's' : ''} ago`;
}

export default function ConnectPage() {
  const router = useRouter();
  const { setIsNewRunModalOpen, setAutoStartNewRun } = useData();

  // --- Connector States ---
  const [stripeConnected, setStripeConnected] = useState(false);
  const [stripeLastSync, setStripeLastSync] = useState<string | null>(null);
  const [isStripeSyncing, setIsStripeSyncing] = useState(false);
  const [stripeTxnCount, setStripeTxnCount] = useState(0);

  const [qboConnected, setQboConnected] = useState(false);
  const [qboLastSync, setQboLastSync] = useState<string | null>(null);
  const [isQboSyncing, setIsQboSyncing] = useState(false);
  const [qboTxnCount, setQboTxnCount] = useState(0);

  // --- Wizard States ---
  const [showWizard, setShowWizard] = useState(false);
  const [selectedFileType, setSelectedFileType] = useState<string | null>(null);

  // --- Upload History State ---
  const [historyList, setHistoryList] = useState<any[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  // --- Active Session State ---
  const [activeSession, setActiveSession] = useState<{bank: any, ledger: any, periodStart?: string, periodEnd?: string} | null>(null);
  const [replaceImportId, setReplaceImportId] = useState<string | null>(null);

  // Fetch counts, connection states, and upload history on mount
  const fetchStateData = useCallback(async () => {
    try {
      const data = await api.recon.counts();
      if (data.stripeConnected) setStripeConnected(true);
      if (data.stripeTransactions) setStripeTxnCount(data.stripeTransactions);
      if (data.stripeLastSync) setStripeLastSync(data.stripeLastSync);
      
      if (data.qboConnected) setQboConnected(true);
      if (data.ledgerEntries) setQboTxnCount(data.ledgerEntries);
      if (data.qboLastSync) setQboLastSync(data.qboLastSync);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    try {
      const data = await api.upload.history();
      setHistoryList(data || []);
    } catch (e: any) {
      console.warn("History API not yet implemented or returned error:", e.message);
      setHistoryList([]);
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  const fetchActiveSession = useCallback(async () => {
    try {
      const data = await api.upload.active();
      setActiveSession(data);
    } catch (e: any) {
      console.warn("Failed to fetch active session");
    }
  }, []);

  // Handle Stripe OAuth
  const onSyncStripe = useCallback(async () => {
    setIsStripeSyncing(true);
    try {
      const data = await api.stripe.sync();
      setStripeTxnCount(data.count || 0);
      setStripeConnected(true);
      setStripeLastSync(new Date().toISOString());
      toast.success("Stripe data synced successfully");
      fetchHistory();
    } catch (error: any) {
      console.error(error);
      toast.error(error.message || "Error syncing Stripe data");
    } finally {
      setIsStripeSyncing(false);
    }
  }, [fetchHistory]);

  // Handle QuickBooks OAuth
  const onSyncQbo = useCallback(async () => {
    setIsQboSyncing(true);
    try {
      const data = await api.qbo.sync();
      setQboTxnCount(data.count || 0);
      setQboLastSync(new Date().toISOString());
      toast.success("QuickBooks data synced successfully");
      fetchHistory();
    } catch (error: any) {
      console.error(error);
      toast.error(error.message || "Error syncing QuickBooks data");
    } finally {
      setIsQboSyncing(false);
    }
  }, [fetchHistory]);

  useEffect(() => {
    let active = true;
    const init = async () => {
      await Promise.resolve();
      if (active) {
        fetchStateData();
        fetchHistory();
        fetchActiveSession();
      }
    };
    init();

    const params = new URLSearchParams(window.location.search);
    // Handle QBO OAuth callback
    if (params.get("qbo_connected") === "true") {
      setTimeout(() => {
        setQboConnected(true);
        onSyncQbo();
      }, 0);
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (params.get("qbo_error") === "true") {
      toast.error("Failed to connect to QuickBooks. Please try again.");
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    // Handle Stripe OAuth callback
    if (params.get("stripe_connected") === "true") {
      setTimeout(() => {
        setStripeConnected(true);
        onSyncStripe();
      }, 0);
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (params.get("stripe_error") === "true") {
      toast.error("Failed to connect to Stripe. Please try again.");
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    return () => {
      active = false;
    };
  }, [fetchStateData, fetchHistory, onSyncQbo, onSyncStripe]);

  const onConnectStripe = () => {
    window.location.href = "/api/stripe/auth";
  };

  const onDisconnectStripe = async () => {
    try {
      await api.stripe.disconnect();
      setStripeConnected(false);
      setStripeTxnCount(0);
      toast.success("Stripe disconnected");
    } catch (e) {
      toast.error("Failed to disconnect Stripe");
    }
  };

  const onConnectQbo = () => {
    window.location.href = "/api/qbo/auth";
  };

  const onDisconnectQbo = async () => {
    try {
      await api.qbo.disconnect();
      setQboConnected(false);
      setQboTxnCount(0);
      toast.success("QuickBooks disconnected");
    } catch (e) {
      toast.error("Failed to disconnect QuickBooks");
    }
  };



  const handleDeleteUpload = async (id: string, force: boolean = false) => {
    if (!force) {
      if (!confirm("Are you sure you want to delete this file and all its associated data?")) return;
    }
    
    try {
      await api.upload.delete(id, force);
      toast.success("Upload deleted successfully.");
      fetchHistory();
      fetchActiveSession();
    } catch (e: any) {
      if (e.status === 409 || e.message?.includes("actively participating")) {
        if (confirm("This file is actively participating in a reconciliation. Deleting it will remove the associated reconciliation history. Are you sure you want to continue?")) {
          handleDeleteUpload(id, true);
        }
      } else {
        toast.error(e.message || "Failed to delete upload.");
      }
    }
  };

  const getFriendlyFileType = (type: string) => {
    const maps: Record<string, string> = {
      bank_csv: "Bank CSV Statement",
      bank_excel: "Bank Excel Statement",
      qbo_export: "QuickBooks Ledger Export",
      tally_export: "Tally Ledger Export (XML/Excel)",
      stripe_export: "Stripe Statement Export",
    };
    return maps[type] || type;
  };

  // Determine if start reconciliation CTA should be active
  const isReady = !!activeSession?.bank && !!activeSession?.ledger;

  return (
    <div className="w-full font-sans flex flex-col items-center bg-slate-50 min-h-screen relative overflow-hidden">
      {/* Premium subtle background grid */}
      <div className="absolute inset-0 z-0 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, rgba(148, 163, 184, 0.15) 1px, transparent 0)', backgroundSize: '24px 24px' }}></div>
      
      <div className="w-full max-w-[720px] py-12 md:py-16 px-4 flex flex-col gap-10 relative z-10">
      {/* Section 1: Header */}
      <div className="text-center md:text-left flex flex-col gap-2">
        <h1 className="text-[28px] font-bold text-slate-900 tracking-tight font-serif">Connect your accounts</h1>
        <p className="text-[16px] text-slate-500">
          ReconFlow reads your data read-only. Nothing is written without your approval.
        </p>
        <div className="flex items-center gap-1.5 mt-2 justify-center md:justify-start text-xs text-slate-400 font-medium">
          <Lock className="w-3.5 h-3.5" />
          <span>Bank-grade read-only access. We never store credentials.</span>
        </div>
      </div>

      {/* Active Reconciliation Session */}
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Layers className="w-5 h-5 text-indigo-600" /> Active Reconciliation Session
          </h2>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Bank Statement */}
          <div className={`border rounded-xl p-6 shadow-sm flex flex-col transition-all ${activeSession?.bank ? 'border-green-500 bg-green-50/20' : 'border-slate-200 bg-white'}`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${activeSession?.bank ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                  <FileText className="w-4 h-4" />
                </div>
                Bank Statement
              </h3>
              {activeSession?.bank && (
                <span className="text-[10px] font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Active
                </span>
              )}
            </div>
            
            {activeSession?.bank ? (
              <div className="flex flex-col flex-1">
                <div className="mb-4">
                  <p className="text-sm font-medium text-slate-900 truncate" title={activeSession.bank.filename}>{activeSession.bank.filename}</p>
                  <p className="text-xs text-slate-500 mt-1">Uploaded: {new Date(activeSession.bank.uploadedAt).toLocaleString()}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{activeSession.bank.transactionCount} transactions extracted</p>
                </div>
                <div className="mt-auto flex gap-3">
                  <Button
                    variant="outline"
                    className="flex-1 text-xs"
                    onClick={() => { setShowWizard(true); setSelectedFileType(activeSession.bank.fileType.includes("stripe") ? "stripe_export" : "bank_csv"); setReplaceImportId(activeSession.bank.id); }}
                  >
                    <RefreshCw className="w-3 h-3 mr-1" /> Replace
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200"
                    onClick={() => handleDeleteUpload(activeSession.bank.id)}
                  >
                    <Trash2 className="w-3 h-3 mr-1" /> Delete
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col flex-1 items-center justify-center text-center py-4">
                <p className="text-sm font-medium text-slate-500 mb-4">No active Bank Statement selected</p>
                <Button
                  onClick={() => { setShowWizard(true); setSelectedFileType("bank_csv"); setReplaceImportId(null); }}
                  className="bg-slate-900 hover:bg-slate-800 text-white w-full text-xs font-semibold"
                >
                  <Upload className="w-3.5 h-3.5 mr-2" /> Upload Statement
                </Button>
              </div>
            )}
          </div>

          {/* Ledger File */}
          <div className={`border rounded-xl p-6 shadow-sm flex flex-col transition-all ${activeSession?.ledger ? 'border-blue-500 bg-blue-50/20' : 'border-slate-200 bg-white'}`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${activeSession?.ledger ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                  <FileSpreadsheet className="w-4 h-4" />
                </div>
                Ledger File
              </h3>
              {activeSession?.ledger && (
                <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Active
                </span>
              )}
            </div>
            
            {activeSession?.ledger ? (
              <div className="flex flex-col flex-1">
                <div className="mb-4">
                  <p className="text-sm font-medium text-slate-900 truncate" title={activeSession.ledger.filename}>{activeSession.ledger.filename}</p>
                  <p className="text-xs text-slate-500 mt-1">Uploaded: {new Date(activeSession.ledger.uploadedAt).toLocaleString()}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{activeSession.ledger.transactionCount} entries extracted</p>
                </div>
                <div className="mt-auto flex gap-3">
                  <Button
                    variant="outline"
                    className="flex-1 text-xs"
                    onClick={() => { setShowWizard(true); setSelectedFileType(activeSession.ledger.fileType.includes("qbo") ? "qbo_export" : (activeSession.ledger.fileType.includes("tally") ? "tally_export" : "qbo_export")); setReplaceImportId(activeSession.ledger.id); }}
                  >
                    <RefreshCw className="w-3 h-3 mr-1" /> Replace
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200"
                    onClick={() => handleDeleteUpload(activeSession.ledger.id)}
                  >
                    <Trash2 className="w-3 h-3 mr-1" /> Delete
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col flex-1 items-center justify-center text-center py-4">
                <p className="text-sm font-medium text-slate-500 mb-4">No active Ledger selected</p>
                <Button
                  onClick={() => { setShowWizard(true); setSelectedFileType("qbo_export"); setReplaceImportId(null); }}
                  className="bg-slate-900 hover:bg-slate-800 text-white w-full text-xs font-semibold"
                >
                  <Upload className="w-3.5 h-3.5 mr-2" /> Upload Ledger
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-slate-100" />

      {/* Available Integrations */}
      <div className="flex flex-col gap-6">
        <div className="text-center md:text-left flex flex-col gap-1">
          <h2 className="text-[20px] font-bold text-slate-900 tracking-tight">Available Integrations</h2>
          <p className="text-[14px] text-slate-500">Connect automated data sources or upload manually.</p>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          
          {/* Stripe */}
          <div className={`border rounded-lg p-5 bg-white flex flex-col items-start transition-all ${stripeConnected ? 'border-green-500 bg-green-50/30' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}>
            <div className="flex items-center justify-between w-full mb-3">
              <div className="w-8 h-8 rounded border border-indigo-200 bg-indigo-600 flex items-center justify-center text-white font-bold text-lg">
                S
              </div>
            </div>
            <h3 className="text-sm font-semibold text-slate-900 mb-1">Stripe</h3>
            <p className="text-xs text-slate-500 mb-4 flex-1">
              Fetch payouts and charges
            </p>

            {stripeConnected ? (
              <div className="w-full mt-auto">
                <div className="flex flex-col items-center justify-center gap-1 text-green-700 bg-green-50 rounded-md py-1.5 border border-green-200 text-[11px] font-medium w-full mb-2">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                    <span>{stripeTxnCount} loaded</span>
                  </div>
                </div>
                <button
                onClick={onDisconnectStripe}
                  className="w-full text-center text-xs font-medium text-slate-500 hover:text-slate-700 underline underline-offset-4 transition-colors"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="w-full mt-auto text-xs font-medium"
                onClick={onConnectStripe}
                disabled={isStripeSyncing}
              >
                {isStripeSyncing ? "Syncing..." : "Connect"}
              </Button>
            )}
          </div>

          {/* QuickBooks */}
          <div
            className={`border rounded-lg p-5 flex flex-col items-start transition-all ${qboConnected
              ? 'border-green-500 bg-green-50/30 shadow-sm ring-1 ring-green-500'
              : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50 bg-white'
              }`}
          >
            <div className="flex items-center justify-between w-full mb-3">
              <div className="w-8 h-8 rounded-full bg-[#2CA01C] flex items-center justify-center text-white font-bold text-lg shadow-sm">
                <span className="leading-none text-[15px] lowercase opacity-90">qb</span>
              </div>
            </div>
            <h3 className="text-sm font-semibold text-slate-900 mb-1">QuickBooks</h3>
            <p className="text-xs text-slate-500 mb-4 flex-1">
              Sync invoices and bills
            </p>
            {qboConnected ? (
              <div className="w-full mt-auto">
                <div className="flex flex-col items-center justify-center gap-1 text-green-700 bg-green-50 rounded-md py-1.5 border border-green-200 text-[11px] font-medium w-full mb-2">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span>{qboTxnCount} invoices</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={onSyncQbo}
                    disabled={isQboSyncing}
                    className="flex-1 flex items-center justify-center gap-1 text-[11px] font-medium text-blue-600 hover:text-blue-800 underline underline-offset-4 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${isQboSyncing ? 'animate-spin' : ''}`} />
                    Sync
                  </button>
                  <button
                    onClick={onDisconnectQbo}
                    className="flex-1 text-[11px] font-medium text-slate-400 hover:text-slate-600 underline underline-offset-4 transition-colors"
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            ) : (
              <Button 
                variant="outline" 
                size="sm" 
                className="w-full mt-auto text-xs font-medium"
                onClick={onConnectQbo}
              >
                Connect
              </Button>
            )}
          </div>

          {/* Zoho Books */}
          <div className="relative border rounded-lg p-5 flex flex-col items-start bg-white border-slate-200 opacity-60 cursor-not-allowed">
            <span className="absolute top-2 right-2 text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-semibold tracking-wide">Soon</span>
            <div className="flex items-center justify-between w-full mb-3">
              <div className="w-8 h-8 rounded-xl bg-[#004ada] flex items-center justify-center text-white font-bold text-lg shadow-sm">
                Z
              </div>
            </div>
            <h3 className="text-sm font-semibold text-slate-900 mb-1">Zoho Books</h3>
            <p className="text-xs text-slate-500 mb-4 flex-1">
              Sync bills and expenses
            </p>
            <Button disabled variant="outline" size="sm" className="w-full mt-auto text-xs font-medium">Coming soon</Button>
          </div>

          {/* Manual CSV */}
          <div
            className="border rounded-lg p-5 flex flex-col items-start cursor-pointer transition-all border-slate-200 hover:border-slate-300 hover:bg-slate-50 bg-white"
            onClick={() => { setShowWizard(true); setSelectedFileType("bank_csv"); setReplaceImportId(null); }}
          >
            <div className="flex items-center justify-between w-full mb-3">
              <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 border border-slate-200">
                <Upload className="w-4 h-4" />
              </div>
            </div>
            <h3 className="text-sm font-semibold text-slate-900 mb-1">Manual CSV/Excel</h3>
            <p className="text-xs text-slate-500 mb-4 flex-1">
              Upload bank or ledger data
            </p>
            <Button variant="outline" size="sm" className="w-full mt-auto text-xs font-medium pointer-events-none">Launch Wizard</Button>
          </div>

        </div>
      </div>

      <FileIngestionWizard
        isOpen={showWizard}
        onClose={() => {
          setShowWizard(false);
          setSelectedFileType(null);
          setReplaceImportId(null);
        }}
        onSuccess={() => {
          setShowWizard(false);
          setSelectedFileType(null);
          setReplaceImportId(null);
          fetchHistory();
          fetchStateData();
          fetchActiveSession();
        }}
        initialFileType={selectedFileType}
        replaceImportId={replaceImportId}
      />

      {/* Section 4: Past Upload History */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between cursor-pointer" onClick={() => setIsHistoryOpen(!isHistoryOpen)}>
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-slate-50 text-slate-500 rounded-lg">
              <History className="w-5 h-5" />
            </div>
            <h3 className="text-[17px] font-bold text-slate-900">Upload History</h3>
          </div>
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setIsHistoryOpen(!isHistoryOpen); }}>
            <ChevronDown className={`w-5 h-5 transition-transform ${isHistoryOpen ? "rotate-180" : ""}`} />
          </Button>
        </div>

        {isHistoryOpen && (
          <div className="pt-6 mt-4 border-t border-slate-100">
            {isLoadingHistory ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 text-indigo-600 animate-spin" />
              </div>
            ) : historyList.length === 0 ? (
              <div className="text-center py-8 text-sm text-slate-400 font-medium">
                No files or integration runs imported yet. Use Sync or the Import Wizard to load data.
              </div>
            ) : (
              <div className="border border-slate-150 rounded-lg overflow-hidden">
                <table className="w-full text-xs text-left border-collapse bg-white">
                  <thead className="bg-slate-50 text-slate-500 uppercase font-semibold border-b border-slate-150">
                    <tr>
                      <th className="px-4 py-3">Source Name / File</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-center">Row metrics</th>
                      <th className="px-4 py-3 text-right">Processed At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                    {historyList.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3 truncate max-w-[200px]" title={item.filename}>
                          <span className="flex items-center gap-2">
                            <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                            <span className="text-slate-900 font-bold">{item.filename}</span>
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-slate-500 font-semibold">{getFriendlyFileType(item.sourceType)}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            item.status === "COMPLETED"
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : item.status === "FAILED"
                              ? "bg-rose-50 text-rose-700 border border-rose-200"
                              : "bg-blue-50 text-blue-700 border border-blue-200 animate-pulse"
                          }`}>
                            {item.status}
                          </span>
                          {item.errorMessage && (
                            <div className="text-[10px] text-rose-500 mt-1 font-mono max-w-[180px] truncate" title={item.errorMessage}>
                              {item.errorMessage}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {item.status === "COMPLETED" ? (
                            <div className="flex items-center justify-center gap-1 text-[10px] font-semibold">
                              <span className="text-emerald-700" title="Success">{item.successCount || 0}✓</span>
                              <span className="text-slate-300">|</span>
                              <span className="text-amber-600" title="Skipped Duplicate">{item.skippedCount || 0}⇄</span>
                              <span className="text-slate-300">|</span>
                              <span className="text-rose-500" title="Failed">{item.failureCount || 0}✗</span>
                            </div>
                          ) : (
                            <span className="text-slate-400 font-mono text-[11px]">{item.rowCount || "-"} rows</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-400 font-semibold">
                          {timeAgo(item.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Section 5: CTA Start Reconciliation */}
      <div className="flex flex-col items-center mt-4 sticky bottom-6 sm:static sm:bottom-auto z-10 w-full">
        <div className="bg-white/90 sm:bg-transparent backdrop-blur-md pb-4 pt-6 sm:p-0 w-full flex flex-col items-center">
          <Button
            size="lg"
            disabled={!isReady}
            className={`w-full sm:w-auto px-12 h-12 text-[15px] font-semibold transition-all shadow-sm ${isReady
              ? 'bg-green-600 hover:bg-green-700 text-white shadow-md shadow-green-600/20'
              : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
              }`}
            onClick={() => {
              if (isReady) {
                setAutoStartNewRun(true);
                setIsNewRunModalOpen(true);
              }
            }}
          >
            Start reconciliation &rarr;
          </Button>
          {!isReady && (
            <p className="text-sm text-slate-500 mt-4 font-medium mb-1">
              {!activeSession?.bank ? "Connect a bank source to continue" : "Connect a ledger to continue"}
            </p>
          )}
          <p className="text-xs text-slate-400 mt-2 font-medium">
            You can add more sources later from Settings
          </p>
        </div>
      </div>
    </div>
  </div>
  );
}
