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
  FileSpreadsheet
} from "lucide-react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useData } from "@/lib/data-context";

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
  const [wizardStep, setWizardStep] = useState<"select" | "preview" | "importing" | "success" | "failed">("select");
  const [selectedFileType, setSelectedFileType] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [fileToUpload, setFileToUpload] = useState<File | null>(null);
  const [isParsingPreview, setIsParsingPreview] = useState(false);
  const [previewData, setPreviewData] = useState<{
    fileName: string;
    fileSize: number;
    headers: string[];
    previewRows: string[][];
    columnHeuristics: Record<string, string>;
    matchedTemplate?: { templateName: string; config: { columnMap: Record<string, string> } };
    sheetNames?: string[];
  } | null>(null);

  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({
    date: "",
    description: "",
    amount: "",
    debit: "",
    credit: "",
    direction: "",
    reference: "",
    counterparty: "",
  });
  
  const [saveTemplate, setSaveTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [importMetrics, setImportMetrics] = useState<{
    successCount: number;
    skippedCount: number;
    failureCount: number;
  } | null>(null);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState(0);

  // --- Upload History State ---
  const [historyList, setHistoryList] = useState<any[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Drag & Drop File Handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      processSelectedFile(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processSelectedFile(e.target.files[0]);
    }
  };

  // Post selected file to preview endpoint
  const processSelectedFile = async (file: File) => {
    if (!selectedFileType) {
      toast.error("Please choose a file type first.");
      return;
    }

    // 5MB Limit for XML files
    if (file.name.toLowerCase().endsWith(".xml") && file.size > 5 * 1024 * 1024) {
      toast.error("Tally XML files must be smaller than 5MB to prevent memory issues.");
      return;
    }

    setFileToUpload(file);
    setIsParsingPreview(true);
    setWizardStep("preview");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("action", "preview");
      formData.append("fileType", selectedFileType);

      const data = await api.upload.process(formData);

      setPreviewData(data);

      // Auto-apply matched layout/template OR fallback to column heuristics
      const heuristics = data.columnHeuristics || {};
      const layoutMatch = data.layoutMatch;

      if (layoutMatch && layoutMatch.mapping) {
        setColumnMapping({
          date: layoutMatch.mapping.date || "",
          description: layoutMatch.mapping.description || "",
          amount: layoutMatch.mapping.amount || "",
          debit: layoutMatch.mapping.debit || "",
          credit: layoutMatch.mapping.credit || "",
          direction: layoutMatch.mapping.direction || "",
          reference: layoutMatch.mapping.reference || "",
          counterparty: layoutMatch.mapping.counterparty || "",
        });
        setSaveTemplate(false);
        if (layoutMatch.type === "known_layout") {
          toast.success(`Known layout recognized: ${layoutMatch.name}`);
        } else if (layoutMatch.type === "learned_template") {
          toast.success(`Matched layout template: ${layoutMatch.name}`);
        }
      } else {
        setColumnMapping({
          date: heuristics.date || "",
          description: heuristics.description || "",
          amount: heuristics.amount || "",
          debit: heuristics.debit || "",
          credit: heuristics.credit || "",
          direction: heuristics.direction || "",
          reference: heuristics.reference || "",
          counterparty: heuristics.counterparty || "",
        });
      }
    } catch (err: any) {
      console.error(err);
      setWizardError(err.message || "Failed to load file preview.");
      setWizardStep("failed");
    } finally {
      setIsParsingPreview(false);
    }
  };

  // Post full mapping configuration to import endpoint
  const handleConfirmImport = async () => {
    if (!fileToUpload || !selectedFileType) return;

    setWizardStep("importing");
    setImportProgress(0);

    // Simulate progress bar going up to 90%
    const progressInterval = setInterval(() => {
      setImportProgress(prev => {
        if (prev >= 90) return prev;
        return Math.min(prev + Math.floor(Math.random() * 15) + 5, 90);
      });
    }, 400);

    try {
      const formData = new FormData();
      formData.append("file", fileToUpload);
      formData.append("action", "import");
      formData.append("fileType", selectedFileType);
      formData.append("columnMapping", JSON.stringify(columnMapping));
      
      if (saveTemplate && templateName.trim()) {
        formData.append("saveTemplateName", templateName.trim());
      }

      const data = await api.upload.process(formData);

      setImportMetrics(data.metrics);
      
      clearInterval(progressInterval);
      setImportProgress(100);
      
      setTimeout(() => {
        setWizardStep("success");
        toast.success("File imported successfully!");
        fetchHistory();
        fetchStateData();
      }, 500);

    } catch (err: any) {
      clearInterval(progressInterval);
      console.error(err);
      setWizardError(err.message || "Failed to process transaction import.");
      setWizardStep("failed");
    }
  };

  const resetWizard = () => {
    setFileToUpload(null);
    setPreviewData(null);
    setImportMetrics(null);
    setWizardError(null);
    setSaveTemplate(false);
    setTemplateName("");
    setWizardStep("select");
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
  const latestBankCsv = historyList.find(h => ["bank_csv", "bank_excel"].includes(h.sourceType) && h.status === "COMPLETED");
  const isBankConnected = stripeConnected || !!latestBankCsv;
  const isLedgerConnected = qboConnected || historyList.some(h => ["qbo_export", "tally_export"].includes(h.sourceType) && h.status === "COMPLETED");
  const isReady = isBankConnected && isLedgerConnected;

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

      {/* Section 2: Connection Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Card A: Stripe */}
        <div className={`border rounded-lg p-6 bg-white flex flex-col items-start transition-all ${stripeConnected ? 'border-green-500 bg-green-50/30' : 'border-blue-200 shadow-sm'}`}>
          <div className="flex items-center justify-between w-full mb-4">
            <div className="w-8 h-8 rounded border border-indigo-200 bg-indigo-600 flex items-center justify-center text-white font-bold text-lg">
              S
            </div>
            {!stripeConnected && (
              <span className="text-[10px] font-bold bg-blue-50 border border-blue-100 text-blue-700 px-2 py-0.5 rounded-full uppercase tracking-wider">
                Most popular
              </span>
            )}
          </div>
          <h3 className="text-lg font-semibold text-slate-900 mb-1">Stripe</h3>
          <p className="text-sm text-slate-500 mb-6 flex-1">
            Fetch payouts, charges, and transfers from the last 90 days
          </p>

          {stripeConnected ? (
            <div className="w-full mt-auto">
              <div className="flex flex-col items-center justify-center gap-1 text-green-700 bg-green-50 rounded-md py-2 border border-green-200 text-sm font-medium w-full mb-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  <span>Connected · {stripeTxnCount} transactions loaded</span>
                </div>
                {stripeLastSync && (
                  <span className="text-xs text-green-600 font-normal">Last synced {timeAgo(stripeLastSync)}</span>
                )}
              </div>
              <button
              onClick={onDisconnectStripe}
                className="w-full text-center text-sm font-medium text-slate-500 hover:text-slate-700 underline underline-offset-4 transition-colors"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <Button
              onClick={onConnectStripe}
              disabled={isStripeSyncing}
              className="w-full mt-auto bg-slate-900 hover:bg-slate-800 text-white font-medium"
            >
              {isStripeSyncing ? "Syncing..." : "Connect Stripe"}
            </Button>
          )}
        </div>

        {/* Card B: CSV Upload */}
        <div className={`border rounded-lg p-6 flex flex-col items-start transition-all ${latestBankCsv ? 'border-green-500 bg-green-50/30' : 'border-slate-200 bg-white'}`}>
          <div className="flex items-center justify-between w-full mb-4">
            <div className={`w-8 h-8 rounded border flex items-center justify-center ${latestBankCsv ? 'border-green-200 bg-green-100 text-green-700' : 'border-slate-200 bg-slate-100 text-slate-600'}`}>
              <Upload className="w-4 h-4" />
            </div>
          </div>
          <h3 className="text-lg font-semibold text-slate-900 mb-1">Bank statement CSV</h3>
          <p className="text-sm text-slate-500 mb-6 flex-1">
            Upload your bank&apos;s CSV export. Supports HDFC, ICICI, SBI, Axis, and most Indian banks.
          </p>

          {latestBankCsv ? (
            <div className="w-full mt-auto">
              <div className="flex flex-col items-center justify-center gap-1 text-green-700 bg-green-50 rounded-md py-2 border border-green-200 text-sm font-medium w-full mb-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  <span>Connected · {latestBankCsv.successCount || 0} transactions loaded</span>
                </div>
                <span className="text-xs text-green-600 font-normal">Last uploaded {timeAgo(latestBankCsv.createdAt)}</span>
              </div>
              <div className="w-full space-y-3 mt-1">
                <Button
                  variant="outline"
                  className="w-full text-center text-xs font-medium text-slate-500 hover:text-slate-700 border-none shadow-none bg-transparent underline underline-offset-4"
                  onClick={() => { setShowWizard(true); resetWizard(); setSelectedFileType("bank_csv"); }}
                >
                  Upload New Statement
                </Button>
              </div>
            </div>
          ) : (
            <div className="w-full space-y-3 mt-auto">
              <Button
                variant="outline"
                className="w-full font-medium"
                onClick={() => { setShowWizard(true); resetWizard(); setSelectedFileType("bank_csv"); }}
              >
                Launch Import Wizard
              </Button>
              <div
                className="h-[100px] border-2 border-dashed rounded-md flex flex-col items-center justify-center text-center p-2 text-sm text-slate-500 transition-colors cursor-pointer border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300"
                onClick={() => { setShowWizard(true); resetWizard(); setSelectedFileType("bank_csv"); }}
              >
                <div className="font-medium">Drop CSV here or click to browse</div>
                <div className="text-[11px] text-slate-400 mt-1">Advanced import & mapping</div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-slate-100" />

      {/* Section 3: Ledger Source */}
      <div className="flex flex-col gap-4 -mt-2">
        <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400">
          Connect your ledger (where your invoices live)
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

          {/* QuickBooks */}
          <div
            className={`border rounded-lg p-5 flex flex-col items-center text-center transition-all ${qboConnected
              ? 'border-green-500 bg-green-50/50 shadow-sm ring-1 ring-green-500'
              : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50 bg-white'
              }`}
          >
            <div className="w-10 h-10 rounded-full bg-[#2CA01C] flex items-center justify-center text-white font-bold text-lg mb-3 shadow-sm">
              <span className="leading-none text-xl lowercase opacity-90">qb</span>
            </div>
            <h4 className="font-medium text-slate-900 mb-3 text-sm">QuickBooks</h4>
            {qboConnected ? (
              <div className="w-full flex flex-col items-center gap-2">
                <div className="flex flex-col items-center justify-center gap-1 text-green-700 bg-green-50 rounded-md py-2 border border-green-200 text-sm font-medium w-full">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{qboTxnCount} invoices synced</span>
                  </div>
                  {qboLastSync && (
                    <span className="text-xs text-green-600 font-normal">Last synced {timeAgo(qboLastSync)}</span>
                  )}
                </div>
                <button
                  onClick={onSyncQbo}
                  disabled={isQboSyncing}
                  className="w-full flex items-center justify-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 underline underline-offset-4 transition-colors disabled:opacity-50 mt-1"
                >
                  <RefreshCw className={`w-3 h-3 ${isQboSyncing ? 'animate-spin' : ''}`} />
                  {isQboSyncing ? "Syncing..." : "Re-sync"}
                </button>
                <button
                  onClick={onDisconnectQbo}
                  className="w-full text-xs font-medium text-slate-400 hover:text-slate-600 underline underline-offset-4 transition-colors"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <Button 
                variant="outline" 
                size="sm" 
                className="w-full text-xs font-medium"
                onClick={onConnectQbo}
              >
                Connect
              </Button>
            )}
          </div>

          {/* Zoho Books — Coming Soon */}
          <div className="relative border rounded-lg p-5 flex flex-col items-center text-center bg-white border-slate-200 opacity-60 cursor-not-allowed">
            <span className="absolute top-2 right-2 text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-semibold tracking-wide">Soon</span>
            <div className="w-10 h-10 rounded-xl bg-[#004ada] flex items-center justify-center text-white font-bold text-lg mb-3 shadow-sm">
              Z
            </div>
            <h4 className="font-medium text-slate-900 mb-3 text-sm">Zoho Books</h4>
            <Button disabled variant="outline" size="sm" className="w-full text-xs font-medium">Coming soon</Button>
          </div>

          {/* Manual CSV */}
          <div
            className="border rounded-lg p-5 flex flex-col items-center text-center cursor-pointer transition-all border-slate-200 hover:border-slate-300 hover:bg-slate-50 bg-white"
            onClick={() => { setShowWizard(true); resetWizard(); setSelectedFileType("qbo_export"); }}
          >
            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 mb-3 border border-slate-200">
              <Upload className="w-4 h-4" />
            </div>
            <h4 className="font-medium text-slate-900 mb-3 text-sm">Manual Ledger</h4>
            <Button variant="outline" size="sm" className="w-full text-xs font-medium pointer-events-none">Launch Wizard</Button>
          </div>

        </div>
      </div>

      {/* Wizard Modal View */}
      {showWizard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-xl border border-slate-200 max-w-[760px] w-full max-h-[85vh] flex flex-col shadow-2xl animate-in fade-in-50 zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-600" />
                <h2 className="text-[18px] font-bold text-slate-900">File Ingestion Wizard</h2>
              </div>
              <button onClick={() => setShowWizard(false)} className="p-1 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6">
              
              {/* Step 1: Select Type & Upload */}
              {wizardStep === "select" && (
                <div className="flex flex-col gap-6">
                  <div>
                    <label className="text-xs font-bold uppercase text-slate-400 tracking-wider mb-2 block">1. Select Statement / Export Format</label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {[
                        { key: "bank_csv", name: "Bank CSV Statement" },
                        { key: "bank_excel", name: "Bank Excel Statement" },
                        { key: "stripe_export", name: "Stripe Statement Export" },
                        { key: "qbo_export", name: "QuickBooks Export (CSV/XLS)" },
                        { key: "tally_export", name: "Tally Export (Excel/XML)" }
                      ].map((item) => (
                        <button
                          key={item.key}
                          onClick={() => setSelectedFileType(item.key)}
                          className={`p-4 border rounded-xl flex flex-col items-center justify-center text-center gap-2 transition-all font-medium text-xs ${
                            selectedFileType === item.key
                              ? "border-indigo-600 bg-indigo-50/40 text-indigo-700 ring-2 ring-indigo-500/10 font-semibold"
                              : "border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-600"
                          }`}
                        >
                          <FileSpreadsheet className={`w-5 h-5 ${selectedFileType === item.key ? "text-indigo-600" : "text-slate-400"}`} />
                          <span>{item.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-bold uppercase text-slate-400 tracking-wider mb-2 block">2. Select or Drag & Drop File</label>
                    <div
                      onDragEnter={handleDrag}
                      onDragOver={handleDrag}
                      onDragLeave={handleDrag}
                      onDrop={handleDrop}
                      onClick={() => selectedFileType && fileInputRef.current?.click()}
                      className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center text-center transition-all ${
                        !selectedFileType
                          ? "border-slate-200 bg-slate-50 cursor-not-allowed opacity-60"
                          : dragActive
                          ? "border-indigo-500 bg-indigo-50 text-indigo-700 scale-[0.99]"
                          : "border-slate-300 hover:border-slate-400 hover:bg-slate-50/50 cursor-pointer"
                      }`}
                    >
                      <Upload className={`w-8 h-8 mb-3 ${dragActive ? "text-indigo-600 animate-bounce" : "text-slate-400"}`} />
                      <div className="font-semibold text-sm text-slate-700">
                        {!selectedFileType ? "Select a format above to activate upload zone" : selectedFileType === "tally_export" ? "Drop CSV/Excel/XML here or click to browse" : "Drop CSV/Excel here or click to browse"}
                      </div>
                      <div className="text-xs text-slate-400 mt-1">{selectedFileType === "tally_export" ? "XML files are restricted to 5MB, others up to 10MB" : "Supports file types up to 10MB"}</div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        className="hidden"
                        accept={selectedFileType === "tally_export" ? ".csv, .xls, .xlsx, .xml" : ".csv, .xls, .xlsx"}
                        disabled={!selectedFileType}
                        onChange={handleFileChange}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Parsing Preview Loader */}
              {isParsingPreview && (
                <div className="flex flex-col items-center justify-center py-12 gap-4">
                  <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
                  <div className="text-sm font-semibold text-slate-700">Analyzing file headers and parsing structure...</div>
                  <div className="text-xs text-slate-400">Verifying file checksum, validating size, and running heuristics.</div>
                </div>
              )}

              {/* Step 3: Column Mapping & Grid Preview */}
              {wizardStep === "preview" && previewData && (
                <div className="flex flex-col gap-6">
                  
                  {/* Confidence-Aware Layout Match Alert */}
                  {(() => {
                    const match = (previewData as any).layoutMatch;
                    if (!match) return null;

                    const percent = Math.round(match.confidence * 100);
                    if (match.type === "known_layout") {
                      return (
                        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg p-4 flex items-start gap-3">
                          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-sm">Known Source Layout Recognized: {match.name}</span>
                              <span className="text-[10px] font-bold bg-emerald-150 text-emerald-800 px-2 py-0.5 rounded-full">
                                {percent}% Match
                              </span>
                            </div>
                            <div className="text-xs text-emerald-700 mt-1">
                              This file matches the signature of a supported configuration for <span className="font-bold">{match.name}</span>. Mapping columns have been automatically applied.
                            </div>
                          </div>
                        </div>
                      );
                    }

                    if (match.type === "learned_template") {
                      return (
                        <div className="bg-teal-50 border border-teal-200 text-teal-800 rounded-lg p-4 flex items-start gap-3">
                          <Sparkles className="w-5 h-5 text-teal-600 shrink-0 mt-0.5" />
                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-sm">Learned Template Matched: {match.name}</span>
                              <span className="text-[10px] font-bold bg-teal-150 text-teal-800 px-2 py-0.5 rounded-full">
                                {percent}% Match
                              </span>
                            </div>
                            <div className="text-xs text-teal-700 mt-1">
                              Recognized column headers from the saved template <span className="font-bold underline">{match.name}</span>. Mappings pre-applied.
                            </div>
                          </div>
                        </div>
                      );
                    }

                    if (percent >= 70) {
                      return (
                        <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-lg p-4 flex items-start gap-3">
                          <Layers className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-sm">Heuristic Auto-Match</span>
                              <span className="text-[10px] font-bold bg-blue-150 text-blue-805 px-2 py-0.5 rounded-full">
                                {percent}% Confidence
                              </span>
                            </div>
                            <div className="text-xs text-blue-700 mt-1">
                              Required columns (Date, Description, and Amount) were automatically detected. Please review the selections below before importing.
                            </div>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div className="bg-amber-50 border border-amber-200 text-amber-850 rounded-lg p-4 flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-sm">Low Confidence Match</span>
                            <span className="text-[10px] font-bold bg-amber-150 text-amber-850 px-2 py-0.5 rounded-full">
                              {percent}% Confidence
                            </span>
                          </div>
                          <div className="text-xs text-amber-700 mt-1">
                            We could not identify standard header fields automatically. Please map the columns manually using the selectors below.
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Header Mapping Form */}
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
                    <h4 className="text-xs font-bold uppercase text-slate-400 tracking-wider mb-4">Map Column Header Identifiers</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-bold text-slate-600 mb-1.5 block">Date Column <span className="text-rose-500">*</span></label>
                        <select
                          value={columnMapping.date}
                          onChange={(e) => setColumnMapping({ ...columnMapping, date: e.target.value })}
                          className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white"
                        >
                          <option value="">-- Select Date --</option>
                          {previewData.headers.map((h) => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-xs font-bold text-slate-600 mb-1.5 block">Description/Memo Column <span className="text-rose-500">*</span></label>
                        <select
                          value={columnMapping.description}
                          onChange={(e) => setColumnMapping({ ...columnMapping, description: e.target.value })}
                          className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white"
                        >
                          <option value="">-- Select Description --</option>
                          {previewData.headers.map((h) => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>

                      {!columnMapping.direction && (columnMapping.debit || columnMapping.credit) ? (
                        <>
                          <div>
                            <label className="text-xs font-bold text-slate-600 mb-1.5 block">Debit (Outflow) Column</label>
                            <select
                              value={columnMapping.debit}
                              onChange={(e) => setColumnMapping({ ...columnMapping, debit: e.target.value, amount: "", direction: "" })}
                              className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white"
                            >
                              <option value="">-- Select Debit --</option>
                              {previewData.headers.map((h) => (
                                <option key={h} value={h}>{h}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="text-xs font-bold text-slate-600 mb-1.5 block">Credit (Inflow) Column</label>
                            <select
                              value={columnMapping.credit}
                              onChange={(e) => setColumnMapping({ ...columnMapping, credit: e.target.value, amount: "", direction: "" })}
                              className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white"
                            >
                              <option value="">-- Select Credit --</option>
                              {previewData.headers.map((h) => (
                                <option key={h} value={h}>{h}</option>
                              ))}
                            </select>
                          </div>
                        </>
                      ) : (
                        <>
                          <div>
                            <label className="text-xs font-bold text-slate-600 mb-1.5 block">Amount Column <span className="text-rose-500">*</span></label>
                            <div className="flex gap-2">
                              <select
                                value={columnMapping.amount}
                                onChange={(e) => setColumnMapping({ ...columnMapping, amount: e.target.value })}
                                className="flex-1 text-xs border border-slate-300 rounded-lg p-2 bg-white"
                              >
                                <option value="">-- Select Amount --</option>
                                {previewData.headers.map((h) => (
                                  <option key={h} value={h}>{h}</option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() => setColumnMapping({ ...columnMapping, amount: "", direction: "", debit: previewData.headers[0], credit: previewData.headers[0] })}
                                className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 shrink-0"
                              >
                                Use Debit/Credit cols
                              </button>
                            </div>
                          </div>
                          <div>
                            <label className="text-xs font-bold text-slate-600 mb-1.5 block">Direction Column (Optional)</label>
                            <select
                              value={columnMapping.direction || ""}
                              onChange={(e) => setColumnMapping({ ...columnMapping, direction: e.target.value })}
                              className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white"
                            >
                              <option value="">-- Select Direction --</option>
                              {previewData.headers.map((h) => (
                                <option key={h} value={h}>{h}</option>
                              ))}
                            </select>
                          </div>
                        </>
                      )}

                      <div>
                        <label className="text-xs font-bold text-slate-600 mb-1.5 block">Reference ID (Optional)</label>
                        <select
                          value={columnMapping.reference}
                          onChange={(e) => setColumnMapping({ ...columnMapping, reference: e.target.value })}
                          className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white"
                        >
                          <option value="">-- Select Reference --</option>
                          {previewData.headers.map((h) => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-xs font-bold text-slate-600 mb-1.5 block">Counterparty / Name (Optional)</label>
                        <select
                          value={columnMapping.counterparty || ""}
                          onChange={(e) => setColumnMapping({ ...columnMapping, counterparty: e.target.value })}
                          className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white"
                        >
                          <option value="">-- Select Counterparty --</option>
                          {previewData.headers.map((h) => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Save Template Config */}
                    {!previewData.matchedTemplate && (
                      <div className="mt-5 pt-4 border-t border-slate-200">
                        <label className="flex items-center gap-2 cursor-pointer mb-2">
                          <input
                            type="checkbox"
                            checked={saveTemplate}
                            onChange={(e) => setSaveTemplate(e.target.checked)}
                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <span className="text-xs font-semibold text-slate-700">Save layout configuration as mapping template</span>
                        </label>
                        {saveTemplate && (
                          <input
                            type="text"
                            placeholder="Template name (e.g. SBI Bank Statement)"
                            value={templateName}
                            onChange={(e) => setTemplateName(e.target.value)}
                            className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white max-w-[340px]"
                          />
                        )}
                      </div>
                    )}
                  </div>

                  {/* Spreadsheet Grid Preview */}
                  <div>
                    <h4 className="text-xs font-bold uppercase text-slate-400 tracking-wider mb-2">Row Entries Preview (First 5 Rows)</h4>
                    <div className="border border-slate-200 rounded-lg overflow-x-auto">
                      <table className="w-full text-[11px] text-left border-collapse bg-white">
                        <thead className="bg-slate-50 text-slate-600 uppercase border-b border-slate-200">
                          <tr>
                            {previewData.headers.map((h) => (
                              <th key={h} className="px-4 py-2.5 font-bold border-r border-slate-200 last:border-0">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-slate-700">
                          {previewData.previewRows.map((row, index) => (
                            <tr key={index} className="hover:bg-slate-50/50">
                              {row.map((val, cellIdx) => (
                                <td key={cellIdx} className="px-4 py-2 border-r border-slate-150 last:border-0 truncate max-w-[150px]">{val}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 4: Loading Processing Ingestion */}
              {wizardStep === "importing" && (
                <div className="flex flex-col items-center justify-center py-12 gap-4">
                  <div className="w-16 h-16 rounded-full bg-indigo-50 flex items-center justify-center mb-2">
                    <Database className="w-8 h-8 text-indigo-600 animate-pulse" />
                  </div>
                  <div className="text-sm font-bold text-slate-900">Processing Your Data</div>
                  <div className="text-xs text-slate-500 text-center max-w-[320px] mb-4">
                    Validating constraints, mapping columns, and generating vector embeddings for AI matching.
                  </div>
                  <div className="w-full max-w-md bg-slate-100 rounded-full h-2.5 mb-2 overflow-hidden relative">
                    <div className="bg-indigo-600 h-2.5 rounded-full transition-all duration-300 ease-out" style={{ width: `${importProgress}%` }}></div>
                  </div>
                  <div className="text-xs font-bold text-slate-400">{importProgress}% Complete</div>
                </div>
              )}

              {/* Step 5: Success State */}
              {wizardStep === "success" && importMetrics && (
                <div className="flex flex-col items-center justify-center py-8 gap-5 text-center">
                  <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 animate-bounce">
                    <CheckCircle2 className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">Ingestion Succeeded!</h3>
                    <p className="text-xs text-slate-400 mt-1">Your statement file was parsed and loaded into the canonical ledger.</p>
                  </div>

                  <div className="grid grid-cols-3 gap-6 bg-slate-50 border border-slate-200 rounded-xl p-5 w-full max-w-[400px] mt-2">
                    <div className="flex flex-col items-center">
                      <span className="text-[20px] font-bold text-emerald-600">{importMetrics.successCount}</span>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-1">Imported</span>
                    </div>
                    <div className="flex flex-col items-center border-x border-slate-200">
                      <span className="text-[20px] font-bold text-amber-600">{importMetrics.skippedCount}</span>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-1">Duplicates</span>
                    </div>
                    <div className="flex flex-col items-center">
                      <span className="text-[20px] font-bold text-rose-600">{importMetrics.failureCount}</span>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-1">Failed</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 6: Failed State */}
              {wizardStep === "failed" && (
                <div className="flex flex-col items-center justify-center py-8 gap-5 text-center">
                  <div className={`w-14 h-14 rounded-full flex items-center justify-center ${wizardError?.includes("already been uploaded") ? "bg-amber-100 text-amber-600" : "bg-rose-100 text-rose-600"}`}>
                    <AlertTriangle className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">
                      {wizardError?.includes("already been uploaded") ? "Duplicate File Detected" : "Ingestion Run Failed"}
                    </h3>
                    <p className="text-xs text-slate-500 mt-1 max-w-[350px] mx-auto">
                      {wizardError?.includes("already been uploaded") 
                        ? "You have already uploaded this statement file previously. To prevent duplicate transactions in your ledger, we skipped this import."
                        : "The ingestion pipeline hit an exception during file reading."}
                    </p>
                  </div>
                  {!wizardError?.includes("already been uploaded") && (
                    <div className="bg-rose-50 border border-rose-100 text-rose-800 text-xs font-mono p-4 rounded-xl max-w-[480px] text-left break-all">
                      {wizardError}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50 rounded-b-xl">
              {wizardStep === "select" && (
                <>
                  <Button variant="outline" size="sm" onClick={() => setShowWizard(false)} className="text-xs font-semibold">
                    Cancel
                  </Button>
                  <Button
                    disabled={!selectedFileType || !fileToUpload}
                    onClick={handleConfirmImport}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold"
                  >
                    Next
                  </Button>
                </>
              )}

              {wizardStep === "preview" && (
                <>
                  <Button variant="outline" size="sm" onClick={resetWizard} className="text-xs font-semibold">
                    Back
                  </Button>
                  <Button
                    onClick={handleConfirmImport}
                    disabled={!columnMapping.date || !columnMapping.description || (!columnMapping.amount && (!columnMapping.debit || !columnMapping.credit))}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold"
                  >
                    Confirm & Import
                  </Button>
                </>
              )}

              {(wizardStep === "success" || wizardStep === "failed") && (
                <Button onClick={() => { setShowWizard(false); resetWizard(); }} className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold">
                  Close
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Section 4: Past Upload History */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <div className="flex items-center gap-2.5 mb-6 pb-3 border-b border-slate-100">
          <div className="p-1.5 bg-slate-50 text-slate-500 rounded-lg">
            <History className="w-5 h-5" />
          </div>
          <h3 className="text-[17px] font-bold text-slate-900">Past Uploads & Sync History</h3>
        </div>

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
              {!isBankConnected ? "Connect a bank source to continue" : "Connect a ledger to continue"}
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
