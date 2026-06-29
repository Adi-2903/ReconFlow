"use client";

import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import { signIn } from "next-auth/react";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const [googleLoading, setGoogleLoading] = React.useState(false);

  // Handle ESC key close
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    try {
      await signIn("google", { redirectTo: "/dashboard" });
    } catch (err) {
      console.error("Sign in failed:", err);
      setGoogleLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-brand-black/40 backdrop-blur-md"
          />

          {/* Modal Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{ type: "spring", duration: 0.4 }}
            className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-brand-border bg-white p-8 shadow-[0_30px_80px_-20px_oklch(0.145_0_0/0.15)] md:p-10"
          >
            {/* Close Button */}
            <button
              onClick={onClose}
              className="absolute top-6 left-6 text-brand-muted hover:text-brand-black transition-colors cursor-pointer"
              aria-label="Close modal"
            >
              <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>

            {/* Content */}
            <div className="mt-4 text-center">
              <h3 className="font-serif text-3xl font-normal text-brand-black">
                Sign in to <span className="font-brand">Recon<span className="italic text-accent-ink">F</span>low</span>
              </h3>
              <p className="mt-2 text-sm text-brand-muted">
                Access your dashboard to match records and review statements.
              </p>
            </div>

            <div className="mt-8 flex flex-col items-center justify-center space-y-6">
              <button
                onClick={handleGoogleSignIn}
                disabled={googleLoading}
                className="w-full flex items-center justify-center gap-3 rounded-full border border-brand-border bg-white px-6 py-3.5 text-sm font-medium text-brand-black shadow-sm transition-all hover:bg-accent-soft/40 active:scale-[0.99] disabled:opacity-70 cursor-pointer"
              >
                {googleLoading ? (
                  <div className="size-4 animate-spin rounded-full border-2 border-brand-black border-t-transparent" />
                ) : (
                  <svg className="size-5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                )}
                <span>{googleLoading ? "Connecting to Google..." : "Continue with Google"}</span>
              </button>

              <div className="rounded-xl border border-dashed border-brand-border bg-accent-soft/30 p-4 text-center text-xs text-brand-muted">
                Securely syncs live transaction data from your bank, Stripe, and QuickBooks accounts.
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
