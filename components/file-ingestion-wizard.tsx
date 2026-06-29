"use client";

import React, { useState, useRef, useEffect } from "react";
import { Upload, CheckCircle2, FileSpreadsheet, AlertTriangle, Loader2, Database, Sparkles, Layers, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { toast } from "sonner";

interface FileIngestionWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialFileType?: string | null;
  replaceImportId?: string | null;
}

export function FileIngestionWizard({ isOpen, onClose, onSuccess, initialFileType, replaceImportId }: FileIngestionWizardProps) {
  const [wizardStep, setWizardStep] = useState<"select" | "preview" | "importing" | "success" | "failed">("select");
  const [selectedFileType, setSelectedFileType] = useState<string | null>(initialFileType || null);
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

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setSelectedFileType(initialFileType || null);
      setWizardStep("select");
      setFileToUpload(null);
      setPreviewData(null);
      setImportMetrics(null);
      setWizardError(null);
      setSaveTemplate(false);
      setTemplateName("");
    }
  }, [isOpen, initialFileType]);

  if (!isOpen) return null;

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

  const processSelectedFile = async (file: File) => {
    if (!selectedFileType) {
      toast.error("Please choose a file type first.");
      return;
    }

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

  const handleConfirmImport = async () => {
    if (!fileToUpload || !selectedFileType) return;

    setWizardStep("importing");
    setImportProgress(0);

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

      if (replaceImportId) {
        formData.append("replaceImportId", replaceImportId);
      }

      const data = await api.upload.process(formData);

      setImportMetrics(data.metrics);
      
      clearInterval(progressInterval);
      setImportProgress(100);
      
      setTimeout(() => {
        setWizardStep("success");
        toast.success("File imported successfully!");
        onSuccess();
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

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/35 backdrop-blur-md p-4 overflow-y-auto">
      <div className="bg-white rounded-xl border border-slate-200 max-w-[760px] w-full max-h-[85vh] flex flex-col shadow-2xl animate-in fade-in-50 zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-600" />
            <h2 className="text-[18px] font-bold text-slate-900">File Ingestion Wizard</h2>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
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

          {isParsingPreview && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
              <div className="text-sm font-semibold text-slate-700">Analyzing file headers and parsing structure...</div>
              <div className="text-xs text-slate-400">Verifying file checksum, validating size, and running heuristics.</div>
            </div>
          )}

          {wizardStep === "preview" && previewData && (
            <div className="flex flex-col gap-6">
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
                        <option key={`${h}-${idx}`} value={h}>
                          {(h || "").trim() === "" ? `(Blank Column ${idx + 1})` : h}
                        </option>
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
                        <option key={`${h}-${idx}`} value={h}>
                          {(h || "").trim() === "" ? `(Blank Column ${idx + 1})` : h}
                        </option>
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
                          {previewData.headers.map((h, idx) => (
                            <option key={`${h}-${idx}`} value={h}>
                              {(h || "").trim() === "" ? `(Blank Column ${idx + 1})` : h}
                            </option>
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
                          {previewData.headers.map((h, idx) => (
                            <option key={`${h}-${idx}`} value={h}>
                              {(h || "").trim() === "" ? `(Blank Column ${idx + 1})` : h}
                            </option>
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
                            {previewData.headers.map((h, idx) => (
                              <option key={`${h}-${idx}`} value={h}>
                                {(h || "").trim() === "" ? `(Blank Column ${idx + 1})` : h}
                              </option>
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
                          {previewData.headers.map((h, idx) => (
                            <option key={`${h}-${idx}`} value={h}>
                              {(h || "").trim() === "" ? `(Blank Column ${idx + 1})` : h}
                            </option>
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
                      {previewData.headers.map((h, idx) => (
                        <option key={`${h}-${idx}`} value={h}>
                          {(h || "").trim() === "" ? `(Blank Column ${idx + 1})` : h}
                        </option>
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
                      {previewData.headers.map((h, idx) => (
                        <option key={`${h}-${idx}`} value={h}>
                          {(h || "").trim() === "" ? `(Blank Column ${idx + 1})` : h}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

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

              <div>
                <h4 className="text-xs font-bold uppercase text-slate-400 tracking-wider mb-2">Row Entries Preview (First 5 Rows)</h4>
                <div className="border border-slate-200 rounded-lg overflow-x-auto">
                  <table className="w-full text-[11px] text-left border-collapse bg-white">
                    <thead className="bg-slate-50 text-slate-600 uppercase border-b border-slate-200">
                      <tr>
                        {previewData.headers.map((h, idx) => (
                          <th key={`${h}-${idx}`} className="px-4 py-2.5 font-bold border-r border-slate-200 last:border-0">
                            {(h || "").trim() === "" ? `(Blank Column ${idx + 1})` : h}
                          </th>
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

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50 rounded-b-xl">
          {wizardStep === "select" && (
            <>
              <Button variant="outline" size="sm" onClick={onClose} className="text-xs font-semibold">
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
            <Button onClick={onClose} className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold">
              Close
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
