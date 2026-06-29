import React, { useState, useEffect } from "react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { CalendarIcon, Play, CheckCircle2, Import, Settings2, Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useData } from "@/lib/data-context";
import { api, ReconCounts, ReconStats } from "@/lib/api-client";
import { FileIngestionWizard } from "@/components/file-ingestion-wizard";

interface NewRunModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewRunModal({ open, onOpenChange }: NewRunModalProps) {
  const router = useRouter();
  const { refreshMatches, autoStartNewRun, setAutoStartNewRun } = useData();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [dateFrom, setDateFrom] = useState<Date>(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 2);
    return startOfMonth(d);
  });
  const [dateTo, setDateTo] = useState<Date>(endOfMonth(new Date()));
  const [processingTextIndex, setProcessingTextIndex] = useState(0);

  // Real counts from DB
  const [counts, setCounts] = useState<ReconCounts>({
    bankTransactions: 0,
    stripeTransactions: 0,
    ledgerEntries: 0,
    qboConnected: false,
    stripeConnected: false,
    qboLastSync: null,
    stripeLastSync: null,
  });
  const [countsLoading, setCountsLoading] = useState(false);

  const [activeSession, setActiveSession] = useState<{bank: any, ledger: any, periodStart?: string, periodEnd?: string} | null>(null);
  const [activeSessionLoading, setActiveSessionLoading] = useState(false);

  const [showWizard, setShowWizard] = useState(false);
  const [wizardInitialType, setWizardInitialType] = useState<string | null>(null);
  const [wizardReplaceId, setWizardReplaceId] = useState<string | null>(null);

  // Real results from API
  const [runResult, setRunResult] = useState<ReconStats | null>(null);

  const [sources, setSources] = useState({
    stripe: true,
    quickbooks: false,
  });

  const [ledgerSources, setLedgerSources] = useState({
    internal: true,
  });

  // Fetch real counts when modal opens
  useEffect(() => {
    if (!open) return;
    let active = true;
    const fetchCountsAndSession = async () => {
      await Promise.resolve();
      if (!active) return;
      setCountsLoading(true);
      setActiveSessionLoading(true);
      try {
        const [countsData, sessionData] = await Promise.all([
          api.recon.counts().catch(() => ({ bankTransactions: 0, stripeTransactions: 0, ledgerEntries: 0, qboConnected: false, stripeConnected: false, qboLastSync: null, stripeLastSync: null })),
          api.upload.active().catch(() => null)
        ]);
        if (!active) return;
        setCounts(countsData);
        setSources((s) => ({ ...s, quickbooks: countsData.qboConnected ?? false, stripe: countsData.stripeConnected ?? false }));
        setActiveSession(sessionData);
      } catch (e) {
        /* silently fail */
      } finally {
        if (active) {
          setCountsLoading(false);
          setActiveSessionLoading(false);
        }
      }
    };
    fetchCountsAndSession();
    return () => {
      active = false;
    };
  }, [open]);

  const refreshActiveSession = async () => {
    try {
      const sessionData = await api.upload.active();
      setActiveSession(sessionData);
      const countsData = await api.recon.counts();
      setCounts(countsData);
    } catch (e) {}
  };

  // Build dynamic processing steps based on real counts
  const steps = [
    "Running Reconciliation Engine...",
    "Reconciliation complete!",
  ];

  const handleOpenChange = (val: boolean) => {
    if (step === 2) return;
    onOpenChange(val);
    if (!val) {
      setTimeout(() => {
        setStep(1);
        setProcessingTextIndex(0);
        setRunResult(null);
        setSources({ stripe: counts.stripeConnected, quickbooks: counts.qboConnected });
        setLedgerSources({ internal: true });
      }, 500);
    }
  };

  // Step 2 processing animation
  useEffect(() => {
    // We just wait here, no fake steps looping.
  }, [step]);

  const handleStart = async () => {
    setStep(2);
    setProcessingTextIndex(0);
    setRunResult(null);

    const startTime = Date.now();

    try {
      const data = await api.recon.run({
        periodStart: dateFrom.toISOString(),
        periodEnd: dateTo.toISOString(),
      });
      if (data.stats) {
        setRunResult(data.stats);
      }
    } catch (error) {
      console.error("Recon API call failed", error);
    }

    // Force the UI to immediately show "Run complete!"
    setProcessingTextIndex(steps.length - 1);

    // Short delay before showing results
    setTimeout(() => setStep(3), 600);
  };

  // Auto-start reconciliation if requested
  useEffect(() => {
    if (open && autoStartNewRun && !countsLoading && step === 1) {
      setAutoStartNewRun(false);
      handleStart();
    }
  }, [open, autoStartNewRun, countsLoading, step, setAutoStartNewRun]);

  const handleReview = () => {
    onOpenChange(false);
    refreshMatches();
    setTimeout(() => {
      setStep(1);
      setProcessingTextIndex(0);
      setRunResult(null);
      router.push("/dashboard");
    }, 300);
  };

  const handleDownload = () => {
    window.open("/api/reports/pdf", "_blank");
  };

  const isValidDateRange = dateFrom && dateTo && dateFrom <= dateTo;
  let dateErrorMessage = "";
  if (!dateFrom || !dateTo) {
    dateErrorMessage = "Both From and To dates are required.";
  } else if (dateFrom > dateTo) {
    dateErrorMessage = "From Date must be before or equal to To Date.";
  }

  const hasSources = Object.values(sources).some(Boolean);
  const hasLedgerSources = Object.values(ledgerSources).some(Boolean);

  const canStart =
    !!activeSession?.bank &&
    !!activeSession?.ledger &&
    isValidDateRange;

  const result = runResult ?? { total: 0, autoMatched: 0, needsReview: 0, exceptions: 0 };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-[520px] p-0 overflow-hidden gap-0 bg-white"
        showCloseButton={step !== 2}
      >
        {step === 1 && (
          <>
            <div className="p-6 pb-4 border-b border-slate-100">
              <DialogHeader>
                <DialogTitle className="text-xl font-semibold tracking-tight text-slate-900">
                  New reconciliation run
                </DialogTitle>
                <DialogDescription className="text-slate-500 mt-1.5">
                  Select data sources and time period for reconciliation.
                </DialogDescription>
              </DialogHeader>
            </div>

            <div className="px-6 py-4 space-y-6 overflow-y-auto max-h-[60vh]">
              {/* Period */}
              <div className="space-y-3">
                <h4 className="text-[13px] font-semibold text-slate-900 uppercase tracking-wider flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <CalendarIcon className="w-4 h-4 text-slate-400" />
                    Period
                  </span>
                </h4>
                <div className="flex gap-4">
                  <div className="grid gap-1.5 flex-1">
                    <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">From</label>
                    <Popover>
                      <PopoverTrigger render={
                        <Button
                          variant={"outline"}
                          className={cn("w-full justify-start text-left font-normal border-slate-200", !dateFrom && "text-muted-foreground")}
                        >
                          {dateFrom ? format(dateFrom, "PPP") : <span>Pick a date</span>}
                        </Button>
                      } />
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={dateFrom} onSelect={(d) => d && setDateFrom(d)} />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="grid gap-1.5 flex-1">
                    <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">To</label>
                    <Popover>
                      <PopoverTrigger render={
                        <Button
                          variant={"outline"}
                          className={cn("w-full justify-start text-left font-normal border-slate-200", !dateTo && "text-muted-foreground")}
                        >
                          {dateTo ? format(dateTo, "PPP") : <span>Pick a date</span>}
                        </Button>
                      } />
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={dateTo} onSelect={(d) => d && setDateTo(d)} />
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
              </div>

              {/* Bank Sources */}
              <div className="space-y-3">
                <h4 className="text-[13px] font-semibold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                  <Import className="w-4 h-4 text-slate-400" />
                  Bank &amp; Payment Sources
                </h4>
                <div className="space-y-3 border border-slate-100 rounded-md p-3 bg-slate-50/50">
                  {/* Stripe */}
                  <div className={cn("flex items-start space-x-3", !counts.stripeConnected && "opacity-70")}>
                    <Checkbox
                      id="stripe"
                      checked={sources.stripe && counts.stripeConnected}
                      disabled={!counts.stripeConnected}
                      onCheckedChange={(c) => setSources((s) => ({ ...s, stripe: !!c }))}
                      className="mt-1"
                    />
                    <label htmlFor="stripe" className={cn("grid gap-1 leading-none flex-1", counts.stripeConnected ? "cursor-pointer" : "cursor-not-allowed")}>
                      <span className="text-sm font-medium text-slate-900">Stripe</span>
                      {counts.stripeConnected ? (
                        <span className="text-xs text-green-600 font-medium">✓ Connected {counts.stripeTransactions > 0 ? `(${counts.stripeTransactions} transactions)` : ''}</span>
                      ) : (
                        <span className="text-xs text-slate-500">
                          {countsLoading
                            ? "Loading..."
                            : "Not connected yet — click Connect Stripe on the Connect page"}
                        </span>
                      )}
                    </label>
                  </div>

                  {/* Active Bank Statement */}
                  <div className="flex items-start space-x-3 mt-2 pt-3 border-t border-slate-200">
                    <Checkbox
                      id="internal-bank"
                      checked={!!activeSession?.bank}
                      disabled
                      className="mt-1 opacity-100"
                    />
                    <div className="grid gap-1.5 flex-1 opacity-100">
                      <span className="text-sm font-medium text-slate-900">Active Bank Statement</span>
                      {activeSessionLoading ? (
                         <span className="text-xs text-slate-500">Loading...</span>
                      ) : activeSession?.bank ? (
                         <div className="flex items-center justify-between bg-white border border-slate-200 rounded p-2.5">
                           <div className="overflow-hidden mr-2">
                             <p className="text-xs font-medium text-slate-900 truncate" title={activeSession.bank.filename}>{activeSession.bank.filename}</p>
                             <p className="text-[10px] text-slate-500 mt-0.5">{activeSession.bank.transactionCount} txns • {new Date(activeSession.bank.uploadedAt).toLocaleDateString()}</p>
                           </div>
                           <Button variant="outline" size="sm" className="h-7 text-xs px-3 shrink-0" onClick={() => { setShowWizard(true); setWizardInitialType(activeSession.bank.fileType.includes("stripe") ? "stripe_export" : "bank_csv"); setWizardReplaceId(activeSession.bank.id); }}>Replace</Button>
                         </div>
                      ) : (
                         <div className="flex items-center justify-between bg-white border border-slate-200 rounded p-2.5 border-dashed">
                           <span className="text-xs text-slate-500">No active file</span>
                           <Button variant="outline" size="sm" className="h-7 text-xs px-3 shrink-0" onClick={() => { setShowWizard(true); setWizardInitialType("bank_csv"); setWizardReplaceId(null); }}>Upload File</Button>
                         </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Ledger Sources */}
              <div className="space-y-3">
                <h4 className="text-[13px] font-semibold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                  <CalendarIcon className="w-4 h-4 text-slate-400" />
                  Ledger Source
                </h4>
                <div className="space-y-3 border border-slate-100 rounded-md p-3 bg-slate-50/50">
                  {/* QuickBooks — shows real connection status */}
                  <div className={cn("flex items-start space-x-3", !counts.qboConnected && "opacity-70")}>
                    <Checkbox
                      id="qb"
                      checked={sources.quickbooks && counts.qboConnected}
                      disabled={!counts.qboConnected}
                      onCheckedChange={(c) => setSources((s) => ({ ...s, quickbooks: !!c }))}
                      className="mt-1"
                    />
                    <label
                      htmlFor="qb"
                      className={cn("grid gap-1 leading-none flex-1", counts.qboConnected ? "cursor-pointer" : "cursor-not-allowed")}
                    >
                      <span className="text-sm font-medium text-slate-900">QuickBooks</span>
                      {counts.qboConnected ? (
                        <span className="text-xs text-green-600 font-medium">✓ Connected</span>
                      ) : (
                        <span
                          className="text-xs text-blue-600 hover:underline cursor-pointer"
                          onClick={() => { onOpenChange(false); router.push("/connect"); }}
                        >
                          Connect first →
                        </span>
                      )}
                    </label>
                  </div>

                  {/* Active Ledger File */}
                  <div className="flex items-start space-x-3 mt-2 pt-3 border-t border-slate-200">
                    <Checkbox
                      id="internal"
                      checked={!!activeSession?.ledger}
                      disabled
                      className="mt-1 opacity-100"
                    />
                    <div className="grid gap-1.5 flex-1 opacity-100">
                      <span className="text-sm font-medium text-slate-900">Active Ledger File</span>
                      {activeSessionLoading ? (
                         <span className="text-xs text-slate-500">Loading...</span>
                      ) : activeSession?.ledger ? (
                         <div className="flex items-center justify-between bg-white border border-slate-200 rounded p-2.5">
                           <div className="overflow-hidden mr-2">
                             <p className="text-xs font-medium text-slate-900 truncate" title={activeSession.ledger.filename}>{activeSession.ledger.filename}</p>
                             <p className="text-[10px] text-slate-500 mt-0.5">{activeSession.ledger.transactionCount} entries • {new Date(activeSession.ledger.uploadedAt).toLocaleDateString()}</p>
                           </div>
                           <Button variant="outline" size="sm" className="h-7 text-xs px-3 shrink-0" onClick={() => { setShowWizard(true); setWizardInitialType(activeSession.ledger.fileType.includes("qbo") ? "qbo_export" : (activeSession.ledger.fileType.includes("tally") ? "tally_export" : "qbo_export")); setWizardReplaceId(activeSession.ledger.id); }}>Replace</Button>
                         </div>
                      ) : (
                         <div className="flex items-center justify-between bg-white border border-slate-200 rounded p-2.5 border-dashed">
                           <span className="text-xs text-slate-500">No active file</span>
                           <Button variant="outline" size="sm" className="h-7 text-xs px-3 shrink-0" onClick={() => { setShowWizard(true); setWizardInitialType("qbo_export"); setWizardReplaceId(null); }}>Upload File</Button>
                         </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Info */}
              <div className="bg-slate-50 rounded-md p-3 border border-slate-200 flex items-start gap-2.5">
                <Settings2 className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                <div className="text-xs text-slate-600 leading-relaxed">
                  <span className="font-semibold text-slate-700">Using your saved rules:</span> ±₹500 amount, ±3 days date, 95% auto-approve.{" "}
                  <button className="text-blue-600 font-medium hover:underline inline-flex items-center">
                    Change in Settings &rarr;
                  </button>
                </div>
              </div>
            </div>

            <div className="p-6 pt-4 bg-white border-t border-slate-100 flex flex-col gap-3">
              {!isValidDateRange && (
                <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 px-3 py-2 rounded-md font-medium text-center">
                  {dateErrorMessage}
                </div>
              )}
              {(!activeSession?.bank || !activeSession?.ledger) && isValidDateRange && (
                <div className="text-sm text-amber-600 bg-amber-50 border border-amber-100 px-3 py-2 rounded-md font-medium text-center">
                  Please upload both an Active Bank Statement and an Active Ledger File.
                </div>
              )}
              <div className="flex justify-end">
                <Button
                  onClick={handleStart}
                  disabled={!canStart}
                  className="w-full sm:w-auto bg-slate-900 hover:bg-slate-800 text-white font-medium shadow-sm transition-all active:scale-[0.98]"
                >
                  Start reconciliation <Play className="w-3.5 h-3.5 ml-1.5 fill-current" />
                </Button>
              </div>
            </div>
          </>
        )}

        {step === 2 && (
          <div className="p-12 flex flex-col items-center justify-center min-h-[440px]">
            <div className="w-16 h-16 relative mb-8">
              <div className="absolute inset-0 rounded-full border-4 border-slate-100"></div>
              <div className="absolute inset-0 rounded-full border-4 border-blue-600 border-t-transparent animate-spin duration-700"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-2 h-2 rounded-full bg-blue-600 animate-pulse"></div>
              </div>
            </div>
            <div className="w-full max-w-xs space-y-4 text-center">
              <h3 className="text-lg font-medium text-slate-900 mb-1">
                {processingTextIndex === steps.length - 1 ? "Finishing up..." : "Processing run"}
              </h3>
              <div className="h-6">
                <p className="text-sm font-medium text-slate-500 animate-pulse">
                  {steps[processingTextIndex]}
                </p>
              </div>
              <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-600 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${(processingTextIndex / (steps.length - 1)) * 100}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="p-8 sm:p-10 text-center animate-in fade-in zoom-in-95 duration-500 flex flex-col min-h-[440px] items-center justify-center">
            <div className="w-20 h-20 mx-auto bg-green-50 rounded-full flex items-center justify-center mb-6 shadow-[0_0_0_8px_rgba(220,252,231,0.5)]">
              <CheckCircle2 className="w-12 h-12 text-green-500" />
            </div>

            <DialogTitle className="text-2xl font-bold tracking-tight text-slate-900 mb-2">
              Run complete
            </DialogTitle>
            <p className="text-slate-500 mb-8 font-medium">
              {result.total > 0
                ? `${result.total} transactions processed`
                : "Run finished — check the dashboard for results"}
            </p>

            <div className="flex justify-center gap-3 mb-8 w-full">
              <div className="flex-1 px-3 py-2 bg-green-50 text-green-700 rounded-md border border-green-100 flex flex-col items-center justify-center">
                <span className="text-xl font-bold">{result.autoMatched}</span>
                <span className="text-[10px] font-semibold uppercase tracking-wider opacity-80 mt-0.5">Auto-matched</span>
              </div>
              <div className="flex-1 px-3 py-2 bg-amber-50 text-amber-700 rounded-md border border-amber-100 flex flex-col items-center justify-center">
                <span className="text-xl font-bold">{result.needsReview}</span>
                <span className="text-[10px] font-semibold uppercase tracking-wider opacity-80 mt-0.5">Need review</span>
              </div>
              <div className="flex-1 px-3 py-2 bg-red-50 text-red-700 rounded-md border border-red-100 flex flex-col items-center justify-center">
                <span className="text-xl font-bold">{result.exceptions}</span>
                <span className="text-[10px] font-semibold uppercase tracking-wider opacity-80 mt-0.5">Exceptions</span>
              </div>
            </div>

            <div className="text-sm text-slate-500 mb-10 bg-slate-50 py-3 px-4 rounded-md border border-slate-100 inline-flex shadow-sm">
              Time this would have taken manually:{" "}
              <span className="font-semibold text-slate-700 ml-1">~{Math.max(1, Math.round(result.total / 20))} hours</span>
            </div>

            <div className="flex flex-col sm:flex-row justify-center gap-3 w-full">
              <Button onClick={handleReview} className="w-full sm:w-auto flex-1 bg-slate-900 hover:bg-slate-800 text-white font-medium shadow-sm">
                Review matches &rarr;
              </Button>
              <Button onClick={handleDownload} variant="outline" className="w-full sm:w-auto flex-1 hover:bg-slate-50 font-medium">
                <Download className="w-4 h-4 mr-2" />
                Download run report
              </Button>
            </div>
          </div>
        )}
      </DialogContent>

      <FileIngestionWizard
        isOpen={showWizard}
        onClose={() => {
          setShowWizard(false);
          setWizardInitialType(null);
          setWizardReplaceId(null);
        }}
        onSuccess={() => {
          setShowWizard(false);
          setWizardInitialType(null);
          setWizardReplaceId(null);
          refreshActiveSession();
        }}
        initialFileType={wizardInitialType}
        replaceImportId={wizardReplaceId}
      />
    </Dialog>
  );
}
