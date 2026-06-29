"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SignInPage() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to home page with auth modal open query param
    router.replace("/?auth=true");
  }, [router]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-accent-soft p-6 font-sans select-none">
      <div className="w-full max-w-[380px] border border-brand-border bg-white p-8 rounded-2xl shadow-sm relative overflow-hidden">
        {/* Subtle grid lines matching ledger style */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--brand-border)_1px,_transparent_1px)] bg-[size:16px_16px] opacity-30 pointer-events-none" />
        
        <div className="relative flex flex-col items-center text-center">
          {/* Custom ledger-themed animated spinner */}
          <div className="relative size-12 mb-6">
            {/* Outer dotted track */}
            <div className="absolute inset-0 rounded-full border border-dashed border-brand-muted/40 animate-[spin_10s_linear_infinite]" />
            {/* Inner ink circle */}
            <div className="absolute inset-2 rounded-full border-2 border-accent-ink border-t-transparent animate-[spin_1.2s_cubic-bezier(0.5,0,0.5,1)_infinite]" />
            {/* Center dot */}
            <div className="absolute inset-[18px] rounded-full bg-accent-warm" />
          </div>

          <div className="font-serif text-sm tracking-[0.16em] uppercase text-brand-muted mb-2">
            <span className="font-brand normal-case tracking-normal text-slate-800 mr-1">Recon<span className="italic text-accent-ink">F</span>low</span> Ledger Portal
          </div>
          
          <h2 className="font-serif text-xl text-brand-black mb-1">
            Redirecting to secure login...
          </h2>
          
          <p className="font-mono text-[10px] tracking-wider text-brand-muted/70 uppercase">
            rf_auth_routing // sys_v2.0
          </p>
        </div>
      </div>
    </div>
  );
}
