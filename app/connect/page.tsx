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
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

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
  const [selectedSheet, setSelectedSheet] = useState<string>("");

  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({
    date: "",
    description: "",
    amount: "",
    debit: "",
    credit: "",
    reference: "",
  });
  
  const [saveTemplate, setSaveTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [importMetrics, setImportMetrics] = useState<{
    successCount: number;
    skippedCount: number;
    failureCount: number;
  } | null>(null);
  const [wizardError, setWizardError] = useState<string | null>(null);

  // --- Upload History State ---
  const [historyList, setHistoryList] = useState<any[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch counts, connection states, and upload history on mount
  const fetchStateData = useCallback(async () => {
    try {
      const countsRes = await fetch("/api/recon/counts");
      if (countsRes.ok) {
        const data = await countsRes.json();
        if (data.stripeConnected) setStripeConnected(true);
        if (data.stripeTransactions) setStripeTxnCount(data.stripeTransactions);
        if (data.stripeLastSync) setStripeLastSync(data.stripeLastSync);
        
        if (data.qboConnected) setQboConnected(true);
        if (data.ledgerEntries) setQboTxnCount(data.ledgerEntries);
        if (data.qboLastSync) setQboLastSync(data.qboLastSync);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    try {
      const historyRes = await fetch("/api/upload/history");
      if (historyRes.ok) {
        const data = await historyRes.json();
        setHistoryList(data || []);
      }
    } catch (e) {
      console.error("Failed to load upload history", e);
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

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
    return () => {
      active = false;
    };
  }, [fetchStateData, fetchHistory]);

  // Handle Stripe OAuth
  const onSyncStripe = useCallback(async () => {
    setIsStripeSyncing(true);
    try {
      const res = await fetch("/api/stripe/sync", { method: "POST" });
      if (!res.ok) throw new Error("Failed to sync Stripe");
      const data = await res.json();
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

  const onConnectStripe = () => {
    window.location.href = "/api/stripe/auth";
  };

  const onDisconnectStripe = async () => {
    try {
      await fetch("/api/stripe/disconnect", { method: "POST" });
      setStripeConnected(false);
      setStripeTxnCount(0);
      toast.success("Stripe disconnected");
    } catch (e) {
      toast.error("Failed to disconnect Stripe");
    }
  };

  // Handle QuickBooks OAuth
  const onSyncQbo = useCallback(async () => {
    setIsQboSyncing(true);
    try {
      const res = await fetch("/api/qbo/sync", { method: "POST" });
      if (!res.ok) throw new Error("Failed to sync QBO");
      const data = await res.json();
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

  const onConnectQbo = () => {
    window.location.href = "/api/qbo/auth";
  };

  const onDisconnectQbo = async () => {
    try {
      await fetch("/api/qbo/disconnect", { method: "POST" });
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
  const processSelectedFile = async (file: File, sheetName?: string) => {
    if (!selectedFileType) {
      toast.error("Please choose a file type first.");
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
      if (sheetName) {
        formData.append("sheetName", sheetName);
      }

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to parse preview.");
      }

      const data = await res.json();
      setPreviewData(data);

      if (data.sheetNames && data.sheetNames.length > 0) {
        setSelectedSheet(sheetName || data.sheetNames[0]);
      }

      // Auto-apply matched template OR fallback to column heuristics
      const heuristics = data.columnHeuristics || {};
      const matched = data.matchedTemplate;

      if (matched && matched.config && matched.config.columnMap) {
        setColumnMapping(matched.config.columnMap);
        setSaveTemplate(false);
        toast.success(`Matched layout template: ${matched.templateName}`);
      } else {
        setColumnMapping({
          date: heuristics.date || "",
          description: heuristics.description || "",
          amount: heuristics.amount || "",
          debit: heuristics.debit || "",
          credit: heuristics.credit || "",
          reference: heuristics.reference || "",
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
    try {
      const formData = new FormData();
      formData.append("file", fileToUpload);
      formData.append("action", "import");
      formData.append("fileType", selectedFileType);
      formData.append("columnMapping", JSON.stringify(columnMapping));
      if (selectedSheet) {
        formData.append("sheetName", selectedSheet);
      }
      
      if (saveTemplate && templateName.trim()) {
        formData.append("saveTemplateName", templateName.trim());
      }

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Import processing failed.");
      }

      const data = await res.json();
      setImportMetrics(data.metrics);
      setWizardStep("success");
      toast.success("File imported successfully!");
      fetchHistory();
      fetchStateData();
    } catch (err: any) {
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
    setSelectedSheet("");
    setWizardStep("select");
  };

  const getFriendlyFileType = (type: string) => {
    const maps: Record<string, string> = {
      bank_csv: "Bank CSV Statement",
      bank_excel: "Bank Excel Statement",
      qbo_export: "QuickBooks Ledger Export",
      tally_export: "Tally Ledger Export",
      stripe_export: "Stripe Statement Export",
    };
    return maps[type] || type;
  };

  // Determine if start reconciliation CTA should be active
  const isBankConnected = stripeConnected || historyList.some(h => ["bank_csv", "bank_excel", "stripe_export"].includes(h.sourceType) && h.status === "COMPLETED");
  const isLedgerConnected = qboConnected || historyList.some(h => ["qbo_export", "tally_export"].includes(h.sourceType) && h.status === "COMPLETED");
  const isReady = isBankConnected && isLedgerConnected;

  return (
    <div className="w-full max-w-[840px] mx-auto py-12 px-4 font-sans flex flex-col gap-10 bg-slate-50 min-h-screen">
      
      {/* Section 1: Header */}
      <div className="flex flex-col gap-2 relative bg-white border border-slate-200/80 rounded-xl p-8 shadow-sm">
        <div className="absolute top-8 right-8 flex items-center gap-1 bg-emerald-50 border border-emerald-100 text-emerald-700 px-3 py-1 rounded-full text-xs font-semibold">
          <Lock className="w-3.5 h-3.5" />
          <span>Bank-grade security</span>
        </div>
        
        <h1 className="text-[26px] font-bold text-slate-900 tracking-tight">Connect Ingestion Sources</h1>
        <p className="text-[15px] text-slate-500 max-w-[500px] leading-relaxed">
          Ingest data via active bank/ledger integrations, or upload manual file exports to match and reconcile transactions.
        </p>
      </div>

      {/* Section 2: Active Connectors */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Stripe Card */}
        <div className={`border rounded-xl p-6 bg-white flex flex-col items-start transition-all relative shadow-sm ${stripeConnected ? 'border-emerald-500 ring-1 ring-emerald-500 bg-emerald-50/10' : 'border-slate-200 hover:shadow-md'}`}>
          <div className="flex items-center justify-between w-full mb-4">
            <div className="w-10 h-10 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-extrabold text-xl shadow-sm">
              S
            </div>
            {stripeConnected ? (
              <span className="text-[11px] font-semibold bg-emerald-100 border border-emerald-200 text-emerald-800 px-2 py-0.5 rounded-full">
                Active
              </span>
            ) : (
              <span className="text-[10px] font-bold bg-indigo-50 border border-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full uppercase tracking-wider">
                Direct Sync
              </span>
            )}
          </div>
          <h3 className="text-[17px] font-bold text-slate-900 mb-1">Stripe</h3>
          <p className="text-sm text-slate-500 mb-6 flex-1 leading-relaxed">
            Sync Charges, Payouts, Refunds, and Processing Fees directly from your connected Stripe accounts.
          </p>

          {stripeConnected ? (
            <div className="w-full mt-auto">
              <div className="flex flex-col gap-1 text-emerald-800 bg-emerald-50/60 rounded-lg p-3 border border-emerald-100 text-xs font-medium w-full mb-4">
                <div className="flex items-center gap-2 font-bold text-sm">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Stripe Connected</span>
                </div>
                {stripeLastSync && (
                  <span className="text-slate-500 font-normal">Last synchronized {timeAgo(stripeLastSync)}</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <Button variant="outline" size="sm" onClick={onSyncStripe} disabled={isStripeSyncing} className="flex-1 text-xs border-indigo-200 text-indigo-700 hover:bg-indigo-50">
                  <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isStripeSyncing ? 'animate-spin' : ''}`} />
                  Sync
                </Button>
                <button onClick={onDisconnectStripe} className="text-xs font-medium text-slate-400 hover:text-slate-600 underline">
                  Disconnect
                </button>
              </div>
            </div>
          ) : (
            <Button onClick={onConnectStripe} disabled={isStripeSyncing} className="w-full mt-auto bg-slate-900 hover:bg-slate-800 text-white font-semibold shadow-sm">
              {isStripeSyncing ? "Connecting..." : "Connect Stripe"}
            </Button>
          )}
        </div>

        {/* QuickBooks Card */}
        <div className={`border rounded-xl p-6 bg-white flex flex-col items-start transition-all relative shadow-sm ${qboConnected ? 'border-emerald-500 ring-1 ring-emerald-500 bg-emerald-50/10' : 'border-slate-200 hover:shadow-md'}`}>
          <div className="flex items-center justify-between w-full mb-4">
            <div className="w-10 h-10 rounded-lg bg-[#2CA01C] flex items-center justify-center text-white font-extrabold text-lg shadow-sm">
              qb
            </div>
            {qboConnected ? (
              <span className="text-[11px] font-semibold bg-emerald-100 border border-emerald-200 text-emerald-800 px-2 py-0.5 rounded-full">
                Active
              </span>
            ) : (
              <span className="text-[10px] font-bold bg-[#2ca01c]/10 border border-[#2ca01c]/20 text-[#2ca01c] px-2 py-0.5 rounded-full uppercase tracking-wider">
                Direct Sync
              </span>
            )}
          </div>
          <h3 className="text-[17px] font-bold text-slate-900 mb-1">QuickBooks</h3>
          <p className="text-sm text-slate-500 mb-6 flex-1 leading-relaxed">
            Sync Invoices, Payments, Deposits, and Customer ledger info automatically via the QBO Connect API.
          </p>

          {qboConnected ? (
            <div className="w-full mt-auto">
              <div className="flex flex-col gap-1 text-emerald-800 bg-emerald-50/60 rounded-lg p-3 border border-emerald-100 text-xs font-medium w-full mb-4">
                <div className="flex items-center gap-2 font-bold text-sm">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>QuickBooks Connected</span>
                </div>
                {qboLastSync && (
                  <span className="text-slate-500 font-normal">Last synchronized {timeAgo(qboLastSync)}</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <Button variant="outline" size="sm" onClick={onSyncQbo} disabled={isQboSyncing} className="flex-1 text-xs border-green-200 text-green-700 hover:bg-green-50">
                  <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isQboSyncing ? 'animate-spin' : ''}`} />
                  Sync
                </Button>
                <button onClick={onDisconnectQbo} className="text-xs font-medium text-slate-400 hover:text-slate-600 underline">
                  Disconnect
                </button>
              </div>
            </div>
          ) : (
            <Button onClick={onConnectQbo} disabled={isQboSyncing} className="w-full mt-auto bg-slate-900 hover:bg-slate-800 text-white font-semibold shadow-sm">
              {isQboSyncing ? "Connecting..." : "Connect QuickBooks"}
            </Button>
          )}
        </div>
      </div>

      {/* Section 3: File Upload Engine Cards */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-6 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg">
              <Database className="w-5 h-5" />
            </div>
            <h3 className="text-[17px] font-bold text-slate-900">Upload Manual Statement Files</h3>
          </div>
          <Button onClick={() => { setShowWizard(true); resetWizard(); }} className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold py-1.5 h-auto px-4 shadow-sm">
            Launch Import Wizard
          </Button>
        </div>

        <p className="text-sm text-slate-500 leading-relaxed mb-4">
          Select or drop file statements (Bank CSV, Excel, QuickBooks, Tally Exports) to parse and ingest them. The upload engine validates formatting and checks for duplicates.
        </p>

        <div className="flex flex-wrap gap-2">
          {["bank_csv", "bank_excel", "qbo_export", "tally_export", "stripe_export"].map((type) => (
            <span key={type} className="text-xs font-semibold bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg border border-slate-200/50">
              {getFriendlyFileType(type)}
            </span>
          ))}
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
                        { key: "tally_export", name: "Tally Export (Excel)" }
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
                        {!selectedFileType ? "Select a format above to activate upload zone" : "Drop CSV/Excel here or click to browse"}
                      </div>
                      <div className="text-xs text-slate-400 mt-1">Supports file types up to 10MB</div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        className="hidden"
                        accept=".csv, .xls, .xlsx"
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
                  
                  {/* Template Matched Banner */}
                  {previewData.matchedTemplate ? (
                    <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg p-4 flex items-start gap-3">
                      <Sparkles className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-bold text-sm">Auto-Layout Template Matched!</div>
                        <div className="text-xs text-emerald-700 mt-0.5">
                          Recognized signature headers from template <span className="font-bold underline">{previewData.matchedTemplate.templateName}</span>. Mapping parameters pre-applied.
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-indigo-50/50 border border-indigo-100 text-indigo-900 rounded-lg p-4 flex items-start gap-3">
                      <Layers className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-bold text-sm text-indigo-950">Review Columns Auto-Detected</div>
                        <div className="text-xs text-indigo-800 mt-0.5">
                          Confirm the fields detected below match the data rows parsed from <span className="font-mono">{previewData.fileName}</span>.
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Worksheet Picker for multi-sheet Excel files */}
                  {previewData.sheetNames && previewData.sheetNames.length > 1 && (
                    <div className="flex flex-col gap-1.5 bg-slate-50 border border-slate-200/80 rounded-xl p-4 shadow-sm">
                      <label className="text-xs font-bold text-slate-700 block">Select Excel Worksheet</label>
                      <select
                        value={selectedSheet || previewData.sheetNames[0]}
                        onChange={(e) => {
                          const newSheet = e.target.value;
                          setSelectedSheet(newSheet);
                          processSelectedFile(fileToUpload!, newSheet);
                        }}
                        className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white max-w-[280px] text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      >
                        {previewData.sheetNames.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  )}

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
                          {previewData.headers.map((h, idx) => (
                            <option key={`${h}-${idx}`} value={h}>{h || `Column ${idx + 1}`}</option>
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
                          {previewData.headers.map((h, idx) => (
                            <option key={`${h}-${idx}`} value={h}>{h || `Column ${idx + 1}`}</option>
                          ))}
                        </select>
                      </div>

                      {columnMapping.debit || columnMapping.credit ? (
                        <>
                          <div>
                            <label className="text-xs font-bold text-slate-600 mb-1.5 block">Debit (Outflow) Column</label>
                            <select
                              value={columnMapping.debit}
                              onChange={(e) => setColumnMapping({ ...columnMapping, debit: e.target.value, amount: "" })}
                              className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white"
                            >
                              <option value="">-- Select Debit --</option>
                              {previewData.headers.map((h, idx) => (
                                <option key={`${h}-${idx}`} value={h}>{h || `Column ${idx + 1}`}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="text-xs font-bold text-slate-600 mb-1.5 block">Credit (Inflow) Column</label>
                            <select
                              value={columnMapping.credit}
                              onChange={(e) => setColumnMapping({ ...columnMapping, credit: e.target.value, amount: "" })}
                              className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white"
                            >
                              <option value="">-- Select Credit --</option>
                              {previewData.headers.map((h, idx) => (
                                <option key={`${h}-${idx}`} value={h}>{h || `Column ${idx + 1}`}</option>
                              ))}
                            </select>
                          </div>
                        </>
                      ) : (
                        <div>
                          <label className="text-xs font-bold text-slate-600 mb-1.5 block">Amount Column <span className="text-rose-500">*</span></label>
                          <div className="flex gap-2">
                            <select
                              value={columnMapping.amount}
                              onChange={(e) => setColumnMapping({ ...columnMapping, amount: e.target.value })}
                              className="flex-1 text-xs border border-slate-300 rounded-lg p-2 bg-white"
                            >
                              <option value="">-- Select Amount --</option>
                              {previewData.headers.map((h, idx) => (
                                <option key={`${h}-${idx}`} value={h}>{h || `Column ${idx + 1}`}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => setColumnMapping({ ...columnMapping, amount: "", debit: previewData.headers[0] || "", credit: previewData.headers[0] || "" })}
                              className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 shrink-0"
                            >
                              Use Debit/Credit cols
                            </button>
                          </div>
                        </div>
                      )}

                      <div>
                        <label className="text-xs font-bold text-slate-600 mb-1.5 block">Reference ID (Optional)</label>
                        <select
                          value={columnMapping.reference}
                          onChange={(e) => setColumnMapping({ ...columnMapping, reference: e.target.value })}
                          className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white"
                        >
                          <option value="">-- Select Reference --</option>
                          {previewData.headers.map((h, idx) => (
                            <option key={`${h}-${idx}`} value={h}>{h || `Column ${idx + 1}`}</option>
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
                            {previewData.headers.map((h, idx) => (
                              <th key={`${h}-${idx}`} className="px-4 py-2.5 font-bold border-r border-slate-200 last:border-0">{h || `Column ${idx + 1}`}</th>
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
                  <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
                  <div className="text-sm font-semibold text-slate-700">Processing Ingestion pipeline...</div>
                  <div className="text-xs text-slate-400 text-center max-w-[320px]">
                    Validating constraints, calculating line metrics, resolving raw payloads, and mapping canonical transactions.
                  </div>
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
                  <div className="w-14 h-14 rounded-full bg-rose-100 flex items-center justify-center text-rose-600">
                    <AlertTriangle className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">Ingestion Run Failed</h3>
                    <p className="text-xs text-slate-400 mt-1">The ingestion pipeline hit an exception during file reading.</p>
                  </div>
                  <div className="bg-rose-50 border border-rose-100 text-rose-800 text-xs font-mono p-4 rounded-xl max-w-[480px] text-left break-all">
                    {wizardError}
                  </div>
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
      <div className="flex flex-col items-center mt-4 w-full">
        <Button
          size="lg"
          disabled={!isReady}
          className={`w-full sm:w-auto px-16 h-14 text-[16px] font-bold tracking-tight rounded-xl transition-all shadow-md ${
            isReady
              ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/25 hover:shadow-lg"
              : "bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-300"
          }`}
          onClick={() => {
            if (isReady) router.push("/dashboard");
          }}
        >
          Start Reconciliation Run
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
        
        {!isReady && (
          <p className="text-xs font-semibold text-slate-400 mt-4 text-center">
            {!isBankConnected && !isLedgerConnected
              ? "Connect Stripe or import statement files (Bank + Ledger) to unlock."
              : !isBankConnected
              ? "Connect Stripe or upload a bank statement to unlock."
              : "Sync QuickBooks or upload a ledger CSV/Excel file to unlock."}
          </p>
        )}
      </div>

    </div>
  );
}
