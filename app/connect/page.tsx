"use client";

import React, { useState } from "react";
import { Lock, Upload, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

export default function ConnectPage() {
  const router = useRouter();

  // State for bank connection
  const [stripeConnected, setStripeConnected] = useState(false);
  const [bankCsvFilename, setBankCsvFilename] = useState<string | null>(null);

  // State for ledger connection
  const [ledgerSource, setLedgerSource] = useState<"quickbooks" | "zoho" | "csv" | null>(null);
  const [qboConnected, setQboConnected] = useState(false);
  const [isQboSyncing, setIsQboSyncing] = useState(false);
  const [qboTxnCount, setQboTxnCount] = useState(0);

  const onSyncQbo = React.useCallback(async () => {
    setIsQboSyncing(true);
    try {
      const res = await fetch("/api/qbo/sync", { method: "POST" });
      if (!res.ok) throw new Error("Failed to sync QBO");
      const data = await res.json();
      setQboTxnCount(data.count || 0);
    } catch (error) {
      console.error(error);
      alert("Error syncing QuickBooks data");
    } finally {
      setIsQboSyncing(false);
    }
  }, []);

  React.useEffect(() => {
    // Check URL for OAuth callback success
    const params = new URLSearchParams(window.location.search);
    if (params.get("qbo_connected") === "true") {
      setQboConnected(true);
      setLedgerSource("quickbooks");
      // Automatically sync data
      onSyncQbo();
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (params.get("qbo_error") === "true") {
      alert("Failed to connect to QuickBooks. Please try again.");
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [onSyncQbo]);

  const onConnectQbo = () => {
    // Redirect to backend auth route to start OAuth flow
    window.location.href = "/api/qbo/auth";
  };

  const isBankConnected = stripeConnected || bankCsvFilename !== null;
  const isLedgerConnected = ledgerSource !== null;
  const isReady = isBankConnected && isLedgerConnected;

  const [isStripeSyncing, setIsStripeSyncing] = useState(false);
  const [stripeTxnCount, setStripeTxnCount] = useState(0);

  // Handlers for Stripe
  const onConnectStripe = async () => {
    setIsStripeSyncing(true);
    try {
      const res = await fetch("/api/stripe/sync", { method: "POST" });
      if (!res.ok) throw new Error("Failed to sync Stripe");
      const data = await res.json();
      setStripeTxnCount(data.count || 0);
      setStripeConnected(true);
    } catch (error) {
      console.error(error);
      alert("Error connecting to Stripe");
    } finally {
      setIsStripeSyncing(false);
    }
  };

  // Drag and Drop handlers for Bank CSV
  const [dragActive, setDragActive] = useState(false);

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
      setBankCsvFilename(e.dataTransfer.files[0].name);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      setBankCsvFilename(e.target.files[0].name);
    }
  };

  return (
    <div className="w-full max-w-[720px] mx-auto py-12 md:py-16 px-4 font-sans flex flex-col gap-10 bg-white min-h-screen">

      {/* Section 1: Header */}
      <div className="text-center md:text-left flex flex-col gap-2">
        <h1 className="text-[24px] font-medium text-slate-900 tracking-tight">Connect your accounts</h1>
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
              <div className="flex items-center justify-center gap-2 text-green-700 bg-green-50 rounded-md py-2 border border-green-200 text-sm font-medium mb-3">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                <span>Connected · {stripeTxnCount} transactions loaded</span>
              </div>
              <button
                onClick={() => setStripeConnected(false)}
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
        <div className={`border rounded-lg p-6 bg-white flex flex-col items-start transition-all ${bankCsvFilename ? 'border-green-500 bg-green-50/30' : 'border-slate-200'}`}>
          <div className="flex items-center justify-between w-full mb-4">
            <div className="w-8 h-8 rounded border border-slate-200 bg-slate-100 flex items-center justify-center text-slate-600">
              <Upload className="w-4 h-4" />
            </div>
          </div>
          <h3 className="text-lg font-semibold text-slate-900 mb-1">Bank statement CSV</h3>
          <p className="text-sm text-slate-500 mb-6 flex-1">
            Upload your bank&apos;s CSV export. Supports HDFC, ICICI, SBI, Axis, and most Indian banks.
          </p>

          {bankCsvFilename ? (
            <div className="w-full mt-auto">
              <div className="flex items-center justify-center gap-2 text-green-700 bg-green-50 rounded-md py-2 border border-green-200 text-sm font-medium mb-3">
                <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                <span className="truncate">{bankCsvFilename} · 84 rows</span>
              </div>
              <button
                onClick={() => setBankCsvFilename(null)}
                className="w-full text-center text-sm font-medium text-slate-500 hover:text-slate-700 underline underline-offset-4 transition-colors"
              >
                Remove
              </button>
            </div>
          ) : (
            <div className="w-full space-y-3 mt-auto">
              <Button
                variant="outline"
                className="w-full font-medium"
                onClick={() => document.getElementById("bank-csv-upload")?.click()}
              >
                Upload file
              </Button>
              <div
                className={`h-[100px] border-2 border-dashed rounded-md flex flex-col items-center justify-center text-center p-2 text-sm text-slate-500 transition-colors cursor-pointer ${dragActive
                  ? 'border-blue-400 bg-blue-50 text-blue-700'
                  : 'border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300'
                  }`}
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                onClick={() => document.getElementById("bank-csv-upload")?.click()}
              >
                <div className="font-medium">Drop CSV here or click to browse</div>
                <div className="text-[11px] text-slate-400 mt-1">Accepted: .csv, .xls, .xlsx · Max 10MB</div>
              </div>
              <input
                type="file"
                id="bank-csv-upload"
                className="hidden"
                accept=".csv, .xls, .xlsx"
                onChange={handleFileChange}
              />
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
              <div className="flex flex-col items-center gap-2">
                <span className="text-sm font-semibold text-green-700 flex items-center gap-1.5 bg-green-50 rounded-full px-3 py-1">
                  <CheckCircle2 className="w-4 h-4" /> Connected
                </span>
                <span className="text-xs text-slate-500">{qboTxnCount} invoices synced</span>
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

          {/* Zoho Books */}
          <div
            onClick={() => setLedgerSource("zoho")}
            className={`border rounded-lg p-5 flex flex-col items-center text-center cursor-pointer transition-all ${ledgerSource === "zoho"
              ? 'border-green-500 bg-green-50/50 shadow-sm ring-1 ring-green-500'
              : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50 bg-white'
              }`}
          >
            <div className="w-10 h-10 rounded-xl bg-[#004ada] flex items-center justify-center text-white font-bold text-lg mb-3 shadow-sm">
              Z
            </div>
            <h4 className="font-medium text-slate-900 mb-3 text-sm">Zoho Books</h4>
            {ledgerSource === "zoho" ? (
              <span className="text-sm font-semibold text-green-700 flex items-center gap-1.5 bg-green-50 rounded-full px-3 py-1">
                <CheckCircle2 className="w-4 h-4" /> Connected
              </span>
            ) : (
              <Button variant="outline" size="sm" className="w-full text-xs font-medium">Connect</Button>
            )}
          </div>

          {/* Manual CSV */}
          <div
            onClick={() => setLedgerSource("csv")}
            className={`border rounded-lg p-5 flex flex-col items-center text-center cursor-pointer transition-all ${ledgerSource === "csv"
              ? 'border-green-500 bg-green-50/50 shadow-sm ring-1 ring-green-500'
              : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50 bg-white'
              }`}
          >
            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 mb-3 border border-slate-200">
              <Upload className="w-4 h-4" />
            </div>
            <h4 className="font-medium text-slate-900 mb-3 text-sm">Manual CSV</h4>
            {ledgerSource === "csv" ? (
              <span className="text-sm font-semibold text-green-700 flex items-center gap-1.5 bg-green-50 rounded-full px-3 py-1">
                <CheckCircle2 className="w-4 h-4" /> Uploaded
              </span>
            ) : (
              <Button variant="outline" size="sm" className="w-full text-xs font-medium">Upload</Button>
            )}
          </div>

        </div>
      </div>

      {/* Section 4: CTA */}
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
              if (isReady) router.push("/dashboard");
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
  );
}
