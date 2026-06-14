"use client";

import { useData } from "@/lib/data-context";
import { AlertCircle } from "lucide-react";
import { signOut, useSession } from "next-auth/react";

export function DemoBanner() {
  const { isDemoMode } = useData();
  const { data: session } = useSession();

  if (!isDemoMode) return null;

  const handleExit = () => {
    if (session?.user) {
      // Already authenticated — just strip the demo param and reload
      const url = new URL(window.location.href);
      url.searchParams.delete("demo");
      window.location.href = url.toString();
    } else {
      // Not authenticated — send them to sign in
      signOut({ callbackUrl: "/sign-in" });
    }
  };

  return (
    <div className="w-full bg-amber-400 text-amber-950 px-4 py-2 text-sm font-medium flex items-center justify-center gap-2 z-50 relative shadow-sm">
      <AlertCircle className="w-4 h-4" />
      <span>You&apos;re viewing demo data &mdash;&nbsp;</span>
      <button 
        onClick={handleExit}
        className="underline hover:text-amber-800 transition-colors font-medium"
      >
        {session?.user ? "Exit demo mode" : "Sign in with Google to connect real accounts"}
      </button>
    </div>
  );
}
