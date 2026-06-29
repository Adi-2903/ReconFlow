"use client";

import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import { signIn } from "next-auth/react";
import { toast } from "sonner";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type AuthMode = "signin" | "signup";

export function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const [mode, setMode] = React.useState<AuthMode>("signin");
  const [googleLoading, setGoogleLoading] = React.useState(false);
  const [formLoading, setFormLoading] = React.useState(false);
  
  // Form states
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [name, setName] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

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
    setErrorMsg(null);
    try {
      await signIn("google", { redirectTo: "/dashboard" });
    } catch (err) {
      console.error("Sign in failed:", err);
      setErrorMsg("Google authentication failed. Please try again.");
      setGoogleLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    
    if (!email || !password) {
      setErrorMsg("Email and password are required.");
      return;
    }

    if (mode === "signup") {
      if (password.length < 12) {
        setErrorMsg("Password must be at least 12 characters long.");
        return;
      }
      if (password !== confirmPassword) {
        setErrorMsg("Passwords do not match.");
        return;
      }
    }

    setFormLoading(true);

    try {
      if (mode === "signup") {
        // 1. Trigger Sign Up API
        const res = await fetch("/api/auth/sign-up", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, name: name || undefined }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Registration failed");
        }

        if (data.linked) {
          toast.success("Account linked! Your Google profile has been set up with a password.");
        } else {
          toast.success("Account created successfully!");
        }
      }

      // 2. Trigger Sign In (works for both normal login and automatic post-signup login)
      const signInRes = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (signInRes?.error) {
        setErrorMsg("Invalid email or password.");
        setFormLoading(false);
        return;
      }

      toast.success("Signed in successfully!");
      onClose();
      // Force page refresh and redirect to trigger NextAuth middleware updates
      window.location.href = "/dashboard";
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "An error occurred. Please try again.");
      setFormLoading(false);
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
            className="relative w-full max-w-md overflow-hidden rounded-2xl border border-brand-border bg-white p-8 shadow-[0_30px_80px_-20px_oklch(0.145_0_0/0.15)] md:p-10"
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

            {/* Header Content */}
            <div className="mt-4 text-center">
              <h3 className="font-serif text-3xl font-normal text-brand-black">
                {mode === "signin" ? "Sign in to" : "Create account on"}{" "}
                <span className="font-brand">Recon<span className="italic text-accent-ink">F</span>low</span>
              </h3>
              <p className="mt-2 text-sm text-brand-muted">
                {mode === "signin" 
                  ? "Access your dashboard to match records and review statements."
                  : "Start syncing live transaction data and automate reconciliations."}
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              {mode === "signup" && (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-brand-muted mb-1.5" htmlFor="name">
                    Company Name / Name
                  </label>
                  <input
                    type="text"
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Acme Corp"
                    className="w-full rounded-lg border border-brand-border bg-accent-soft/20 px-4 py-2.5 text-sm text-brand-black placeholder-brand-muted/60 transition-all focus:border-brand-black focus:outline-none"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-brand-muted mb-1.5" htmlFor="email">
                  Email Address
                </label>
                <input
                  type="email"
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  required
                  className="w-full rounded-lg border border-brand-border bg-accent-soft/20 px-4 py-2.5 text-sm text-brand-black placeholder-brand-muted/60 transition-all focus:border-brand-black focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-brand-muted mb-1.5" htmlFor="password">
                  Password
                </label>
                <input
                  type="password"
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  className="w-full rounded-lg border border-brand-border bg-accent-soft/20 px-4 py-2.5 text-sm text-brand-black placeholder-brand-muted/60 transition-all focus:border-brand-black focus:outline-none"
                />
              </div>

              {mode === "signup" && (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-brand-muted mb-1.5" htmlFor="confirmPassword">
                    Confirm Password
                  </label>
                  <input
                    type="password"
                    id="confirmPassword"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••••••"
                    required
                    className="w-full rounded-lg border border-brand-border bg-accent-soft/20 px-4 py-2.5 text-sm text-brand-black placeholder-brand-muted/60 transition-all focus:border-brand-black focus:outline-none"
                  />
                </div>
              )}

              {errorMsg && (
                <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs text-rose-600 font-medium">
                  {errorMsg}
                </div>
              )}

              <button
                type="submit"
                disabled={formLoading || googleLoading}
                className="w-full flex items-center justify-center rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-slate-800 active:scale-[0.99] disabled:opacity-70 cursor-pointer"
              >
                {formLoading ? (
                  <div className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <span>{mode === "signin" ? "Sign In" : "Register & Sign In"}</span>
                )}
              </button>
            </form>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center" aria-hidden="true">
                <div className="w-full border-t border-brand-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white px-3 text-brand-muted font-semibold tracking-wider">Or</span>
              </div>
            </div>

            {/* Google Login */}
            <button
              onClick={handleGoogleSignIn}
              disabled={googleLoading || formLoading}
              className="w-full flex items-center justify-center gap-3 rounded-full border border-brand-border bg-white px-6 py-3 text-sm font-medium text-brand-black shadow-sm transition-all hover:bg-accent-soft/40 active:scale-[0.99] disabled:opacity-70 cursor-pointer"
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
              <span>Continue with Google</span>
            </button>

            {/* Toggle Mode */}
            <div className="mt-6 text-center text-xs">
              <span className="text-brand-muted">
                {mode === "signin" ? "Don't have an account?" : "Already have an account?"}{" "}
              </span>
              <button
                onClick={() => {
                  setMode(mode === "signin" ? "signup" : "signin");
                  setPassword("");
                  setConfirmPassword("");
                  setErrorMsg(null);
                }}
                className="font-semibold text-brand-black hover:underline cursor-pointer"
              >
                {mode === "signin" ? "Sign up here" : "Sign in here"}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
