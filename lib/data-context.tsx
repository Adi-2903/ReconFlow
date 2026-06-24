"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { MatchData } from "@/types/match";
import { sharedMatches as initialMatches } from "@/lib/data";
import { toast } from "sonner";

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
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [isDemoMode, setIsDemoMode] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(false);
  const [exceptionCount, setExceptionCount] = useState(0);
  const [matches, setMatches] = useState<MatchData[]>([]);

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
      const res = await fetch("/api/matches");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setMatches(data);
        }
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
      const res = await fetch("/api/exceptions");
      if (res.ok) {
        const data = await res.json();
        setExceptionCount(data.count || 0);
      }
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
      const res = await fetch(`/api/matches/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (res.ok) {
        setMatches((prev) =>
          prev.map((m) => (m.id === id ? { ...m, status: "approved" as const } : m))
        );
        toast.success("Match approved");
        refreshExceptions();
        return true;
      } else {
        const errData = await res.json().catch(() => ({}));
        if (res.status === 409) {
          if (errData.code === "ALREADY_FINALIZED") {
            toast.error("Match already finalized by another user.");
          } else if (errData.code === "CONCURRENT_CLAIM") {
            toast.error("One or more selected entries were claimed. Suggestions refreshed.");
          } else {
            toast.error(errData.error || "Match already reviewed by another user. Please refresh.");
          }
          refreshMatches();
          refreshExceptions();
        } else {
          toast.error(errData.error || "Failed to approve match");
        }
        return false;
      }
    } catch (e) {
      console.error("Failed to approve match on server", e);
      toast.error("Failed to approve match");
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
      const res = await fetch(`/api/matches/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (res.ok) {
        setMatches((prev) =>
          prev.map((m) => (m.id === id ? { ...m, status: "rejected" as const } : m))
        );
        toast.success("Match rejected");
        refreshExceptions();
        return true;
      } else {
        const errData = await res.json().catch(() => ({}));
        if (res.status === 409) {
          if (errData.code === "ALREADY_FINALIZED") {
            toast.error("Match already finalized by another user.");
          } else if (errData.code === "CONCURRENT_CLAIM") {
            toast.error("One or more selected entries were claimed. Suggestions refreshed.");
          } else {
            toast.error(errData.error || "Match already reviewed by another user. Please refresh.");
          }
          refreshMatches();
          refreshExceptions();
        } else {
          toast.error(errData.error || "Failed to reject match");
        }
        return false;
      }
    } catch (e) {
      console.error("Failed to reject match on server", e);
      toast.error("Failed to reject match");
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
      const res = await fetch(`/api/matches/${bankTransactionId}/manual-match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ledgerEntryIds, reason }),
      });
      if (res.ok) {
        toast.success("Manual match created");
        await refreshMatches();
        await refreshExceptions();
        return true;
      } else {
        const errData = await res.json().catch(() => ({}));
        if (res.status === 409) {
          if (errData.code === "ALREADY_FINALIZED") {
            toast.error("Match already finalized by another user.");
          } else if (errData.code === "CONCURRENT_CLAIM") {
            toast.error("One or more selected entries were claimed. Suggestions refreshed.");
          } else {
            toast.error(errData.error || "Match already reviewed by another user. Please refresh.");
          }
          refreshMatches();
          refreshExceptions();
        } else {
          toast.error(errData.error || "Failed to create manual match");
        }
        return false;
      }
    } catch (e) {
      console.error("Failed to create manual match on server", e);
      toast.error("Failed to create manual match");
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
