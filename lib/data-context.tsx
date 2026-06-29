"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { MatchData } from "@/types/match";
import { sharedMatches as initialMatches } from "@/lib/data";
import { toast } from "sonner";
import { api } from "@/lib/api-client";

interface DataContextType {
  matches: MatchData[];
  setMatches: React.Dispatch<React.SetStateAction<MatchData[]>>;
  handleApprove: (id: string, reason?: string) => Promise<boolean>;
  handleReject: (id: string, reason?: string) => Promise<boolean>;
  handleManualMatch: (bankTransactionId: string, ledgerEntryIds: string[], reason?: string) => Promise<boolean>;
  refreshMatches: () => Promise<void>;
  refreshExceptions: () => Promise<void>;
  isLoading: boolean;
  exceptionCount: number;
  isDemoMode: boolean;
  isNewRunModalOpen: boolean;
  setIsNewRunModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  autoStartNewRun: boolean;
  setAutoStartNewRun: React.Dispatch<React.SetStateAction<boolean>>;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [isDemoMode, setIsDemoMode] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(false);
  const [exceptionCount, setExceptionCount] = useState(0);
  const [matches, setMatches] = useState<MatchData[]>([]);
  const [isNewRunModalOpen, setIsNewRunModalOpen] = useState(false);
  const [autoStartNewRun, setAutoStartNewRun] = useState(false);

  useEffect(() => {
    let active = true;
    const init = async () => {
      await Promise.resolve();
      if (!active) return;
      if (typeof window !== "undefined") {
        const demoParam = new URLSearchParams(window.location.search).get("demo") === "true";
        setIsDemoMode(demoParam);
        if (demoParam) {
          setMatches(initialMatches);
        }
      }
    };
    init();
    return () => {
      active = false;
    };
  }, []);

  const refreshMatches = useCallback(async () => {
    if (isDemoMode) {
      setMatches(initialMatches);
      return;
    }
    setIsLoading(true);
    try {
      const data = await api.matches.list();
      if (Array.isArray(data)) {
        setMatches(data as unknown as MatchData[]);
      }
    } catch (e) {
      console.error("Failed to fetch matches", e);
    } finally {
      setIsLoading(false);
    }
  }, [isDemoMode]);

  const refreshExceptions = useCallback(async () => {
    if (isDemoMode) {
      setExceptionCount(initialMatches.filter(m => m.status === 'pending' && m.confidenceScore < 0.9).length);
      return;
    }
    try {
      const data = await api.exceptions.list();
      setExceptionCount(data.count || 0);
    } catch (e) {
      console.error("Failed to fetch exception count", e);
    }
  }, [isDemoMode]);

  useEffect(() => {
    let active = true;
    const initData = async () => {
      // Defer to next microtask to prevent synchronous state setting in effect body
      await Promise.resolve();
      if (active) {
        refreshMatches();
        refreshExceptions();
      }
    };
    initData();
    return () => {
      active = false;
    };
  }, [refreshMatches, refreshExceptions]);

  const handleApprove = async (id: string, reason?: string): Promise<boolean> => {
    if (isDemoMode) {
      setMatches((prev) =>
        prev.map((m) => (m.id === id ? { ...m, status: "approved" as const } : m))
      );
      toast.success("Match approved");
      return true;
    }
    try {
      await api.matches.approve(id, reason);
      setMatches((prev) =>
        prev.map((m) => (m.id === id ? { ...m, status: "approved" as const } : m))
      );
      toast.success("Match approved");
      refreshExceptions();
      return true;
    } catch (e: any) {
      if (e.status === 409) {
        if (e.code === "ALREADY_FINALIZED") {
          toast.error("Match already finalized by another user.");
        } else if (e.code === "CONCURRENT_CLAIM") {
          toast.error("One or more selected entries were claimed. Suggestions refreshed.");
        } else {
          toast.error(e.message || "Match already reviewed by another user. Please refresh.");
        }
        refreshMatches();
        refreshExceptions();
      } else {
        toast.error(e.message || "Failed to approve match");
      }
      return false;
    }
  };

  const handleReject = async (id: string, reason?: string): Promise<boolean> => {
    if (isDemoMode) {
      setMatches((prev) =>
        prev.map((m) => (m.id === id ? { ...m, status: "rejected" as const } : m))
      );
      toast.success("Match rejected");
      return true;
    }
    try {
      await api.matches.reject(id, reason);
      setMatches((prev) =>
        prev.map((m) => (m.id === id ? { ...m, status: "rejected" as const } : m))
      );
      toast.success("Match rejected");
      refreshExceptions();
      return true;
    } catch (e: any) {
      if (e.status === 409) {
        if (e.code === "ALREADY_FINALIZED") {
          toast.error("Match already finalized by another user.");
        } else if (e.code === "CONCURRENT_CLAIM") {
          toast.error("One or more selected entries were claimed. Suggestions refreshed.");
        } else {
          toast.error(e.message || "Match already reviewed by another user. Please refresh.");
        }
        refreshMatches();
        refreshExceptions();
      } else {
        toast.error(e.message || "Failed to reject match");
      }
      return false;
    }
  };

  const handleManualMatch = async (
    bankTransactionId: string,
    ledgerEntryIds: string[],
    reason?: string
  ): Promise<boolean> => {
    if (isDemoMode) {
      toast.success("Manual match created (demo mode)");
      return true;
    }
    try {
      await api.matches.manualMatch(bankTransactionId, ledgerEntryIds, reason);
      toast.success("Manual match created");
      await refreshMatches();
      await refreshExceptions();
      return true;
    } catch (e: any) {
      if (e.status === 409) {
        if (e.code === "ALREADY_FINALIZED") {
          toast.error("Match already finalized by another user.");
        } else if (e.code === "CONCURRENT_CLAIM") {
          toast.error("One or more selected entries were claimed. Suggestions refreshed.");
        } else {
          toast.error(e.message || "Match already reviewed by another user. Please refresh.");
        }
        refreshMatches();
        refreshExceptions();
      } else {
        toast.error(e.message || "Failed to create manual match");
      }
      return false;
    }
  };

  return (
    <DataContext.Provider value={{
      matches,
      setMatches,
      handleApprove,
      handleReject,
      handleManualMatch,
      refreshMatches,
      refreshExceptions,
      isLoading,
      exceptionCount,
      isDemoMode,
      isNewRunModalOpen,
      setIsNewRunModalOpen,
      autoStartNewRun,
      setAutoStartNewRun,
    }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const context = useContext(DataContext);
  if (!context) {
    throw new Error("useData must be used within a DataProvider");
  }
  return context;
}
