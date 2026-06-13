"use client";

import { useData } from "@/lib/data-context";
import { AlertCircle } from "lucide-react";
import { signOut } from "next-auth/react";

export function DemoBanner() {
  const { isDemoMode } = useData();

  if (!isDemoMode) return null;

  return (
    <div className="w-full bg-amber-400 text-amber-950 px-4 py-2 text-sm font-medium flex items-center justify-center gap-2 z-50 relative shadow-sm">
      <AlertCircle className="w-4 h-4" />
      <span>You&apos;re viewing demo data — </span>
      <button 
        onClick={() => signOut({ callbackUrl: "/sign-in" })} 
        className="underline hover:text-amber-800 transition-colors font-medium"
      >
        Sign in with Google to connect real accounts
      </button>
    </div>
  );
}
