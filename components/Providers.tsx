"use client";

import { useEffect } from "react";
import { toast } from "@/lib/toast";
import { Toaster } from "sonner";
import { AppErrorBoundary } from "@/components/error-boundary/AppErrorBoundary";

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    window.addEventListener("online", toast.networkRestored);
    window.addEventListener("offline", toast.networkError);

    return () => {
      window.removeEventListener("online", toast.networkRestored);
      window.removeEventListener("offline", toast.networkError);
    };
  }, []);

  return (
    <AppErrorBoundary>
      {children}
      <Toaster position="bottom-right" richColors closeButton />
    </AppErrorBoundary>
  );
}
