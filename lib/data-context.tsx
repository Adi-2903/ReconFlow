"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { MatchData } from "@/types/match";
import { sharedMatches as initialMatches } from "@/lib/data";
import { toast } from "sonner";

interface DataContextType {
  matches: MatchData[];
  setMatches: React.Dispatch<React.SetStateAction<MatchData[]>>;
  handleApprove: (id: string) => void;
  handleReject: (id: string) => void;
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

  const handleApprove = async (id: string) => {
    setMatches((prev) =>
      prev.map((m) => (m.id === id ? { ...m, status: "approved" } : m))
    );
    try {
      await fetch(`/api/matches/${id}/approve`, { method: "POST" });
      toast.success("Match approved");
    } catch (e) {
      console.error("Failed to approve match on server", e);
      toast.error("Failed to approve match");
    }
  };

  const handleReject = async (id: string) => {
    setMatches((prev) =>
      prev.map((m) => (m.id === id ? { ...m, status: "rejected" } : m))
    );
    try {
      await fetch(`/api/matches/${id}/reject`, { method: "POST" });
      toast.success("Match rejected");
    } catch (e) {
      console.error("Failed to reject match on server", e);
      toast.error("Failed to reject match");
    }
  };

  return (
    <DataContext.Provider value={{
      matches,
      setMatches,
      handleApprove,
      handleReject,
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
