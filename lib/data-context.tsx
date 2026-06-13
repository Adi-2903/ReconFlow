"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { MatchData } from "@/types/match";
import { sharedMatches as initialMatches } from "@/lib/data";

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
  const [matches, setMatches] = useState<MatchData[]>(initialMatches);
  const [isLoading, setIsLoading] = useState(false);
  const [exceptionCount, setExceptionCount] = useState(0);
  const [isDemoMode, setIsDemoMode] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const isDemo = new URLSearchParams(window.location.search).get("demo") === "true";
      if (isDemo) setIsDemoMode(true);
    }
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
        if (Array.isArray(data) && data.length > 0) {
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
    refreshMatches();
    refreshExceptions();
  }, [refreshMatches, refreshExceptions]);

  const handleApprove = async (id: string) => {
    setMatches((prev) =>
      prev.map((m) => (m.id === id ? { ...m, status: "approved" } : m))
    );
    try {
      await fetch(`/api/matches/${id}/approve`, { method: "POST" });
    } catch (e) {
      console.error("Failed to approve match on server", e);
    }
  };

  const handleReject = async (id: string) => {
    setMatches((prev) =>
      prev.map((m) => (m.id === id ? { ...m, status: "rejected" } : m))
    );
    try {
      await fetch(`/api/matches/${id}/reject`, { method: "POST" });
    } catch (e) {
      console.error("Failed to reject match on server", e);
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
