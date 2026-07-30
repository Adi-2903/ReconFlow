"use client";

import * as React from "react";
import { motion } from "motion/react";
import Link from "next/link";
import { AuthModal } from "./auth-modal";

/* ---------- Decorative SVGs ---------- */

function LedgerGrid() {
  return (
    <svg
      aria-hidden="true"
      className="absolute inset-0 h-full w-full text-brand-border"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <pattern id="ledger-dots" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="1" fill="currentColor" />
        </pattern>
        <radialGradient id="fade" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="white" stopOpacity="0" />
          <stop offset="100%" stopColor="white" stopOpacity="1" />
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#ledger-dots)" opacity="0.5" />
      <rect width="100%" height="100%" fill="url(#fade)" />
    </svg>
  );
}

function Squiggle({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 220 14"
      className={className}
      preserveAspectRatio="none"
    >
      <path
        d="M2 8 Q 30 2, 55 8 T 110 8 T 165 8 T 218 8"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function WaxStamp() {
  return (
    <div className="absolute -right-4 -top-4 select-none" aria-hidden="true">
      <div className="relative grid size-24 rotate-[-14deg] place-items-center rounded-full border-2 border-accent-ink/70 text-accent-ink shadow-[0_8px_24px_-12px_oklch(0.42_0.08_165/0.35)]">
        <div className="absolute inset-1 rounded-full border border-dashed border-accent-ink/50" />
        <div className="text-center font-serif leading-none">
          <div className="text-[9px] font-sans font-semibold uppercase tracking-[0.18em]">
            Reconciled
          </div>
          <div className="mt-1 text-[10px] font-sans tracking-widest text-accent-ink/70">
            18 · JUN
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Brand mark + integration icons ---------- */

function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-brand text-2xl leading-none tracking-tight ${className}`}>
      Recon<span className="italic text-accent-ink">F</span>low
    </span>
  );
}

function StripeIcon() {
  return (
    <div className="grid size-10 place-items-center rounded-xl bg-[#635BFF] text-white shadow-sm">
      <span className="font-sans text-lg font-bold leading-none">S</span>
    </div>
  );
}
function QuickBooksIcon() {
  return (
    <div className="grid size-10 place-items-center rounded-xl bg-[#2CA01C] text-white shadow-sm">
      <span className="font-sans text-[11px] font-bold leading-none">qb</span>
    </div>
  );
}
function TallyIcon() {
  return (
    <div className="grid size-10 place-items-center rounded-xl bg-[#1F4E96] text-white shadow-sm">
      <span className="font-sans text-[11px] font-bold leading-none">T</span>
    </div>
  );
}
function RazorpayIcon() {
  return (
    <div className="grid size-10 place-items-center rounded-xl bg-[#0C2451] text-white shadow-sm">
      <span className="font-sans text-[11px] font-bold leading-none">R</span>
    </div>
  );
}

/* ---------- Page ---------- */

interface LandingPageProps {
  isLoggedIn: boolean;
}

export default function LandingPage({ isLoggedIn }: LandingPageProps) {
  const [isAuthOpen, setIsAuthOpen] = React.useState(false);

  React.useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("auth") === "true") {
        setIsAuthOpen(true);
      } else if (params.get("demo") === "true") {
        window.location.href = "mailto:adityajain2903@gmail.com?subject=ReconFlow%20Demo%20Booking%20Request";
        const url = new URL(window.location.href);
        url.searchParams.delete("demo");
        window.history.replaceState({}, "", url.pathname + url.search);
      }
    }
  }, []);

  const openAuth = () => {
    setIsAuthOpen(true);
  };

  const handleCloseAuth = () => {
    setIsAuthOpen(false);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("auth");
      url.searchParams.delete("demo");
      window.history.replaceState({}, "", url.pathname + url.search);
    }
  };

  return (
    <div className="min-h-screen bg-white font-sans text-brand-black selection:bg-accent-ink selection:text-white">
      <Nav isLoggedIn={isLoggedIn} onOpenAuth={openAuth} />
      <Hero isLoggedIn={isLoggedIn} />
      <WhyReconciliationBreaks />
      <WhyReconFlowIsDifferent />
      <Stats />
      <ProductPeek />
      <HowItWorks />
      <Compare />
      <Integrations />
      <Pricing />
      <Trust />
      <FinalCTA isLoggedIn={isLoggedIn} />
      <SiteFooter />
      <AuthModal isOpen={isAuthOpen} onClose={handleCloseAuth} />
    </div>
  );
}


/* ---------- Sections ---------- */

function Nav({
  isLoggedIn,
  onOpenAuth,
}: {
  isLoggedIn: boolean;
  onOpenAuth: () => void;
}) {
  return (
    <nav className="fixed top-0 z-50 w-full border-b border-brand-border/60 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2">
          <Wordmark />
        </Link>
        <div className="hidden gap-8 text-sm font-medium text-brand-muted md:flex">
          <Link href="#product" className="transition-colors hover:text-brand-black">
            Product
          </Link>
          <Link href="#integrations" className="transition-colors hover:text-brand-black">
            Integrations
          </Link>
          <Link href="#pricing" className="transition-colors hover:text-brand-black">
            Pricing
          </Link>
          <Link href="#security" className="transition-colors hover:text-brand-black">
            Security
          </Link>
        </div>
        <div className="flex items-center gap-3">
          {!isLoggedIn && (
            <button
              onClick={onOpenAuth}
              className="hidden text-sm font-medium text-brand-muted hover:text-brand-black sm:block cursor-pointer bg-transparent border-0 outline-none"
            >
              Log in
            </button>
          )}
          {isLoggedIn ? (
            <Link
              href="/dashboard"
              className="rounded-full bg-brand-black px-5 py-2 text-sm font-medium text-white ring-2 ring-transparent transition-all hover:ring-accent-warm/60"
            >
              Go to Dashboard
            </Link>
          ) : (
            <Link
              href="/dashboard?demo=true"
              className="rounded-full bg-brand-black px-5 py-2 text-sm font-medium text-white ring-2 ring-transparent transition-all hover:ring-accent-warm/60"
            >
              Try Live Demo
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}

function Eyebrow({ index, label, fileId = "RF-001", status = "Reviewed" }: { index: string; label: string; fileId?: string; status?: string }) {
  return (
    <div className="font-mono text-[10px] tracking-wider text-brand-muted border-l-2 border-accent-warm pl-4 py-1.5 mb-6">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-bold text-brand-black tracking-widest">CHAPTER {index}</span>
        <span className="text-brand-border">|</span>
        <span className="uppercase text-[9px] tracking-[0.16em]">{label}</span>
      </div>
      <div className="mt-1 text-[9px] text-brand-muted/50 font-medium">
        File: <span className="font-bold text-brand-black/60">{fileId}</span> &nbsp;·&nbsp; Status: <span className="font-bold text-green-700">{status}</span>
      </div>
    </div>
  );
}

function AuditStamp({ text, date = "18 JUN 2026", className = "", rotate = "-8deg" }: { text: string; date?: string; className?: string; rotate?: string }) {
  return (
    <div
      className={`select-none pointer-events-none font-mono border-2 border-accent-ink/50 text-accent-ink rounded px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider bg-white/70 backdrop-blur-[1px] shadow-sm inline-block ${className}`}
      style={{ transform: `rotate(${rotate})` }}
    >
      <div className="text-center leading-none">
        <div>{text}</div>
        <div className="text-[6px] text-accent-ink/50 tracking-widest mt-0.5">{date}</div>
      </div>
    </div>
  );
}

function Hero({
  isLoggedIn,
}: {
  isLoggedIn: boolean;
}) {
  return (
    <section className="relative overflow-hidden pt-36 md:pt-44">
      <LedgerGrid />
      <motion.div
        initial="hidden"
        animate="show"
        viewport={{ once: true }}
        variants={{
          hidden: {},
          show: {
            transition: { staggerChildren: 0.15 },
          },
        }}
        className="relative mx-auto max-w-5xl px-6 text-center"
      >
        <motion.div variants={{ hidden: { opacity: 0, y: 15 }, show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 50, damping: 20 } } }} className="mx-auto mb-10 inline-flex items-center gap-2 rounded-full border border-brand-border/60 bg-white/60 px-3 py-1.5 text-xs font-medium text-brand-muted backdrop-blur-sm">
          <span className="size-1.5 rounded-full bg-accent-ink" />
          Now in private beta · Built for ₹5Cr–₹50Cr startups
        </motion.div>

        <motion.h1 variants={{ hidden: { opacity: 0, y: 15 }, show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 50, damping: 20 } } }} className="mx-auto max-w-4xl font-serif text-5xl leading-[1.1] tracking-[auto] md:text-7xl lg:text-[5.5rem] lg:leading-[1.05] lg:tracking-[-0.02em]">
          Reconciliation <br className="hidden sm:block" />
          You Can <span className="italic">Explain</span>.
        </motion.h1>

        <motion.p variants={{ hidden: { opacity: 0, y: 15 }, show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 50, damping: 20 } } }} className="mx-auto mt-10 max-w-[42rem] text-lg leading-relaxed text-brand-muted/90 md:text-xl font-medium">
          Close books faster by automatically matching transactions, surfacing exceptions, and providing audit-ready evidence for every decision.
        </motion.p>

        <motion.div variants={{ hidden: { opacity: 0, y: 15 }, show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 50, damping: 20 } } }} className="mt-12 flex flex-col items-center justify-center gap-4 sm:flex-row">
          {isLoggedIn ? (
            <Link
              href="/dashboard"
              className="w-full flex items-center justify-center gap-2 rounded-full bg-brand-black px-8 py-4 text-base font-medium text-white shadow-md shadow-brand-black/5 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-brand-black/10 sm:w-auto"
            >
              <svg
                className="size-4 fill-current"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
              Go to Dashboard
            </Link>
          ) : (
            <a
              href="mailto:adityajain2903@gmail.com?subject=ReconFlow%20Demo%20Booking"
              className="w-full flex items-center justify-center gap-2 rounded-full bg-brand-black px-8 py-4 text-base font-medium text-white shadow-md shadow-brand-black/5 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-brand-black/10 sm:w-auto"
            >
              <svg
                className="size-4 fill-current"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
              Book a 15-min demo
            </a>
          )}
          <Link
            href="/dashboard?demo=true"
            className="w-full rounded-full border border-brand-border bg-white px-8 py-4 text-base font-medium text-brand-black shadow-sm transition-all duration-300 hover:bg-accent-soft/40 sm:w-auto text-center"
          >
            Try the live demo →
          </Link>
        </motion.div>

        {/* Trust Row */}
        <motion.div variants={{ hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 1, delay: 0.5 } } }} className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-[11px] font-medium tracking-wide text-brand-muted/60 uppercase">
          <span>• No implementation fee</span>
          <span>• Read-only integrations</span>
          <span>• Enterprise-ready security</span>
        </motion.div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.6 }}
        className="relative mx-auto mt-20 max-w-5xl px-6 md:mt-28"
      >
        <div className="relative mx-auto overflow-hidden rounded-t-3xl border-x border-t border-brand-border/80 bg-white shadow-2xl shadow-brand-black/[0.03] p-6 md:p-8">
          <div className="flex items-center justify-between border-b border-brand-border/50 bg-accent-soft/30 px-6 py-4 -mx-6 -mt-6 md:-mx-8 md:-mt-8 mb-6">
            <div className="flex items-center gap-3">
              <div className="size-2 rounded-full bg-accent-ink animate-pulse"></div>
              <div className="text-xs font-semibold uppercase tracking-widest text-brand-muted">Match Evidence Preview</div>
            </div>
            <div className="text-xs font-semibold uppercase tracking-wider text-accent-warm">Awaiting Review</div>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3 items-stretch text-left text-sm">
            {/* Left Column: Bank statement source */}
            <div className="border border-brand-border/60 rounded-xl p-5 bg-accent-soft/10 flex flex-col justify-between relative overflow-hidden">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-brand-muted">Bank Statement Payout</span>
                  <span className="font-mono text-[8px] text-green-700 bg-green-50 px-1.5 py-0.5 rounded border border-green-200">Settled (Auto-Feed)</span>
                </div>
                <h4 className="font-serif text-xl text-brand-black mt-2 font-medium">Razorpay Settlement</h4>
                <p className="text-[10px] text-brand-muted mt-1 font-mono leading-relaxed">
                  Ref: rzp_pay_9912a_sett<br />
                  Timestamp: 18-Jun-2026 11:24:02 IST<br />
                  Routing: HDFC Current A/C · Owner: RJ
                </p>
              </div>
              <div className="mt-6">
                <span className="text-[9px] uppercase font-bold text-brand-muted tracking-wider block">Settlement Amount</span>
                <div className="font-serif text-3xl text-brand-black font-semibold mt-1">
                  ₹11,600.00
                </div>
              </div>
            </div>

            {/* Middle Column: Ledger Matches */}
            <div className="border border-brand-border/60 rounded-xl p-5 bg-accent-soft/10 flex flex-col justify-between">
              <div>
                <span className="text-[9px] font-bold uppercase tracking-wider text-brand-muted">Matched Records</span>
                <div className="mt-3 space-y-2">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-medium text-brand-black">INV-8821 <span className="text-[9px] text-brand-muted font-normal">(Razorpay-Web)</span></span>
                    <span className="font-mono text-brand-black">₹5,600.00</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-medium text-brand-black">INV-8822 <span className="text-[9px] text-brand-muted font-normal">(Razorpay-Web)</span></span>
                    <span className="font-mono text-brand-black">₹6,400.00</span>
                  </div>
                  <div className="flex justify-between items-center text-xs text-rose-600">
                    <span className="font-medium">Gateway Fee (Difference)</span>
                    <span className="font-mono">-₹400.00</span>
                  </div>
                  <div className="mt-1 text-[9px] text-rose-600/80 bg-rose-50 border border-rose-100 rounded p-1.5 leading-snug">
                    ⚠️ Warning: ₹400 difference detected. Auto-allocated to Stripe/Razorpay Fees (A/C #4421).
                  </div>
                </div>
              </div>
              <div className="border-t border-brand-border/40 pt-3 mt-6 flex justify-between items-baseline">
                <span className="text-xs font-semibold text-brand-muted uppercase">Net Ledger</span>
                <span className="font-serif text-2xl text-brand-black font-bold">₹11,600.00</span>
              </div>
            </div>

            {/* Right Column: Evidence Strength & Action */}
            <div className="border border-accent-ink/30 rounded-xl p-5 bg-white shadow-sm flex flex-col justify-between relative overflow-hidden">
              <div>
                <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-3">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-brand-muted">Evidence Strength</span>
                  <span className="text-[9px] font-bold uppercase tracking-wider bg-green-50 text-green-700 px-2 py-0.5 rounded border border-green-200">
                    Strong
                  </span>
                </div>
                <motion.div
                  variants={{
                    hidden: {},
                    show: { transition: { staggerChildren: 0.15 } }
                  }}
                  initial="hidden"
                  animate="show"
                  className="space-y-2 text-xs text-brand-black"
                >
                  <motion.div variants={{ hidden: { opacity: 0, x: -10 }, show: { opacity: 1, x: 0 } }} className="flex items-center gap-2 font-medium text-green-700">
                    <span className="font-bold">✓</span>
                    <span>Amount Match (₹11,600 vs ₹11,600)</span>
                  </motion.div>
                  <motion.div variants={{ hidden: { opacity: 0, x: -10 }, show: { opacity: 1, x: 0 } }} className="flex items-center gap-2 font-medium text-green-700">
                    <span className="font-bold">✓</span>
                    <span>Date Match (Within 1 day lag)</span>
                  </motion.div>
                  <motion.div variants={{ hidden: { opacity: 0, x: -10 }, show: { opacity: 1, x: 0 } }} className="flex items-center gap-2 font-medium text-green-700">
                    <span className="font-bold">✓</span>
                    <span>Reference Match (INV-8821/22)</span>
                  </motion.div>
                </motion.div>
                <div className="mt-3 border-t border-slate-100 pt-3 flex items-center justify-between text-xs">
                  <span className="text-brand-muted font-medium">Suggested Resolution:</span>
                  <span className="font-semibold text-accent-ink bg-accent-soft/30 px-2 py-0.5 rounded text-[9px] uppercase">
                    Fee Entry
                  </span>
                </div>
                <div className="mt-2 text-[10px] text-brand-muted font-medium flex justify-between items-center">
                  <span>Confidence: <span className="font-bold text-brand-black">96%</span></span>
                  <span className="font-mono text-[8px] text-brand-muted/70">Audit code: AC-9912</span>
                </div>
              </div>

              <div className="mt-4">
                <button className="w-full bg-brand-black text-white hover:bg-brand-black/90 font-medium py-2 rounded-lg text-xs transition-all active:scale-[0.98] cursor-pointer">
                  Approve match
                </button>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </section>
  );
}

function WhyReconciliationBreaks() {
  const cards = [
    {
      title: "Gateway Fees",
      subtitle: "₹10,000 payout vs. ₹9,600 received",
      body: "ReconFlow identifies the missing ₹400 fee automatically using pre-built gateway models.",
    },
    {
      title: "Bulk Settlements",
      subtitle: "4 invoices vs. 1 payout",
      body: "ReconFlow automatically groups and bundles multiple invoices to match aggregate settlements.",
    },
    {
      title: "Timing Delays",
      subtitle: "Invoice on Monday vs. Settlement on Wednesday",
      body: "ReconFlow understands clearing lags and standard bank processing windows in India.",
    },
  ];

  return (
    <section className="py-24 bg-white border-t border-brand-border relative z-10">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-16 max-w-2xl">
          <Eyebrow index="01" label="Reconciliation Failure Modes" fileId="RF-FMOD" status="Reviewed" />
          <h2 className="mt-4 font-serif text-4xl md:text-5xl">
            Spreadsheets can't solve <span className="italic text-accent-ink">fintech math</span>.
          </h2>
          <p className="mt-4 text-brand-muted">
            Most discrepancies aren't errors — they are standard transaction attributes that confuse basic matching tools.
          </p>
        </div>
        <div className="grid gap-8 md:grid-cols-3">
          {cards.map((c) => (
            <div key={c.title} className="rounded-2xl border border-brand-border bg-accent-soft/20 p-8 flex flex-col justify-between hover:shadow-sm transition-all duration-300">
              <div>
                <h3 className="font-serif text-2xl font-medium text-brand-black">{c.title}</h3>
                <div className="mt-3 inline-block font-mono text-xs uppercase tracking-wider bg-accent-warm/15 text-brand-black px-2.5 py-1 rounded">
                  {c.subtitle}
                </div>
              </div>
              <p className="mt-6 text-sm leading-relaxed text-brand-muted">{c.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function WhyReconFlowIsDifferent() {
  const pillars = [
    {
      title: "Explainable",
      desc: "Every match includes evidence.",
      body: "Shows exact amount matches, clearing delays, and reference matching scores. No black box guesses.",
    },
    {
      title: "Controlled",
      desc: "Nothing updates without approval.",
      body: "Nothing touches the ledger without human sign-off. Approve suggestions with one click, or write custom adjustments.",
    },
    {
      title: "Audit-Ready",
      desc: "Every decision includes a complete audit trail.",
      body: "Every approval records: who approved it, when it was approved, and the exact evidence that was reviewed.",
    },
  ];

  return (
    <section className="py-32 bg-accent-soft/40 border-t border-brand-border relative z-10">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-16 max-w-2xl">
          <Eyebrow index="02" label="The Trust Architecture" fileId="RF-ARCH" status="Approved" />
          <h2 className="mt-4 font-serif text-4xl md:text-5xl">
            Built for <span className="italic text-accent-ink">auditors</span>, trusted by <span className="italic">CFOs</span>.
          </h2>
          <p className="mt-4 text-brand-muted">
            ReconFlow is engineered to deliver institutional-grade safety, giving you complete visibility into every entry before it hits your ledger.
          </p>
        </div>
        <div className="grid gap-12 md:grid-cols-3 md:gap-16">
          {pillars.map((p) => (
            <div key={p.title} className="rounded-2xl border border-brand-border bg-white p-8 hover:shadow-sm transition-all duration-300 relative overflow-hidden flex flex-col justify-between min-h-[260px]">
              <div>
                <h3 className="font-serif text-2xl font-medium text-brand-black">{p.title}</h3>
                <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-accent-ink">{p.desc}</p>
                <p className="mt-4 text-sm leading-relaxed text-brand-muted">{p.body}</p>
              </div>
              {p.title === "Audit-Ready" && (
                <div className="absolute right-4 bottom-4 opacity-50">
                  <AuditStamp text="AUDITED" date="18 JUN 2026" rotate="-10deg" />
                </div>
              )}
              {p.title === "Controlled" && (
                <div className="absolute right-4 bottom-4 opacity-50">
                  <AuditStamp text="APPROVED" date="18 JUN 2026" rotate="8deg" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Stats() {
  const stats = [
    { figure: "95%+", caption: "transactions auto-matched on day one" },
    { figure: "Every match", caption: "includes a complete, audit-ready evidence trail" },
    { figure: "Human approval", caption: "required before any changes are written to ledger" },
  ];
  return (
    <section className="border-y border-brand-border bg-accent-soft/60 py-24 relative z-10">
      <div className="mx-auto max-w-7xl px-6">

        {/* Exception Illustration Concept */}
        <div className="mb-20 grid grid-cols-1 md:grid-cols-2 items-center gap-12 border-b border-brand-border/40 pb-16">
          <div>
            <Eyebrow index="03" label="Philosophy & Exceptions" fileId="RF-PHIL" status="Reviewed" />
            <h3 className="mt-4 font-serif text-4xl md:text-5xl leading-tight">
              Review exceptions. <br />
              Ignore the easy stuff.
            </h3>
            <p className="mt-4 text-brand-muted text-base leading-relaxed">
              Most reconciliation systems require you to check every transaction manually. ReconFlow does the matching in the background, only surfacing the exceptions on your dashboard.
            </p>
          </div>

          <motion.div
            variants={{
              hidden: {},
              show: { transition: { staggerChildren: 0.25 } }
            }}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-100px" }}
            className="bg-white border border-brand-border/80 rounded-2xl p-8 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden"
          >
            <motion.div variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }} className="flex-1 text-center md:text-left">
              <div className="font-mono text-xs text-brand-muted uppercase tracking-wider">Imported</div>
              <div className="font-serif text-3xl font-semibold text-brand-black mt-1">1,000</div>
              <div className="text-xs text-brand-muted mt-0.5">Transactions</div>
            </motion.div>

            <motion.div variants={{ hidden: { opacity: 0 }, show: { opacity: 1 } }} className="text-brand-border text-2xl hidden md:block">&rarr;</motion.div>

            <motion.div variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }} className="flex-1 text-center md:text-left relative">
              <div className="font-mono text-xs text-green-700 uppercase tracking-wider">Auto-Matched</div>
              <div className="font-serif text-3xl font-semibold text-green-700 mt-1">950</div>
              <div className="text-xs text-brand-muted mt-0.5">Cleared automatically</div>
              <div className="absolute right-0 -bottom-1.5 opacity-60 hidden xl:block">
                <AuditStamp text="MATCHED" date="18 JUN" rotate="-15deg" />
              </div>
            </motion.div>

            <motion.div variants={{ hidden: { opacity: 0 }, show: { opacity: 1 } }} className="text-brand-border text-2xl hidden md:block">&rarr;</motion.div>

            <motion.div variants={{ hidden: { opacity: 0, scale: 0.95 }, show: { opacity: 1, scale: 1 } }} className="flex-1 text-center md:text-left bg-accent-soft/50 border border-brand-border/40 rounded-xl p-3 md:p-4 relative">
              <div className="font-mono text-xs text-accent-flag uppercase tracking-wider">Review</div>
              <div className="font-serif text-3xl font-semibold text-accent-flag mt-1">50</div>
              <div className="text-xs text-brand-muted mt-0.5 font-bold">Exceptions to review</div>
              <div className="absolute right-1 -bottom-1 opacity-70 hidden xl:block">
                <AuditStamp text="FLAGGED" date="18 JUN" rotate="12deg" className="!border-rose-200 !text-rose-600" />
              </div>
            </motion.div>
          </motion.div>
        </div>

        {/* High-credibility pillars */}
        <div className="grid gap-12 md:grid-cols-3">
          {stats.map((s, idx) => (
            <div key={idx} className="text-center md:text-left">
              <div className="font-serif text-5xl italic leading-none text-accent-ink md:text-6xl">
                {s.figure}
              </div>
              <p className="mt-4 max-w-xs text-sm leading-relaxed text-brand-muted md:text-base font-medium">
                {s.caption}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Integrations() {
  const apps = [
    { name: "Stripe", Icon: StripeIcon, note: "Payments & payouts" },
    { name: "QuickBooks", Icon: QuickBooksIcon, note: "Accounting ledger" },
    { name: "Tally", Icon: TallyIcon, note: "ERP & GST" },
    { name: "Razorpay", Icon: RazorpayIcon, note: "UPI & cards" },
  ];
  return (
    <section id="integrations" className="py-28 scroll-mt-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-14 max-w-2xl">
          <Eyebrow index="07" label="Connectivity Graph" fileId="RF-CONN" status="Connected" />
          <h2 className="mt-4 font-serif text-4xl md:text-5xl">
            One hub. <span className="italic text-accent-ink">Every</span> source of truth.
          </h2>
          <p className="mt-4 text-brand-muted">
            Direct, native connections — no Plaid middlemen, no brittle CSV pipelines.
            ReconFlow speaks each platform's API natively.
          </p>
        </div>

        <div className="relative rounded-3xl border border-brand-border bg-white p-10 shadow-[0_30px_80px_-50px_oklch(0.42_0.08_165/0.4)]">
          {/* hub & spokes */}
          <div className="relative grid grid-cols-2 items-center gap-12 md:grid-cols-[1fr_auto_1fr]">
            <div className="space-y-5">
              {apps.slice(0, 2).map(({ name, Icon, note }) => (
                <IntegrationBadge key={name} name={name} note={note} Icon={Icon} side="left" />
              ))}
            </div>

            <div className="mx-auto grid size-32 place-items-center rounded-full border border-accent-ink/30 bg-accent-soft text-center">
              <div>
                <Wordmark className="!text-lg" />
                <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-muted">
                  Hub
                </div>
              </div>
            </div>

            <div className="space-y-5">
              {apps.slice(2).map(({ name, Icon, note }) => (
                <IntegrationBadge key={name} name={name} note={note} Icon={Icon} side="right" />
              ))}
            </div>
          </div>
          <p className="mt-10 text-center text-xs uppercase tracking-[0.18em] text-brand-muted">
            + HDFC · ICICI · Axis · Kotak · 40 more banks via direct feeds
          </p>
        </div>
      </div>
    </section>
  );
}

function IntegrationBadge({
  name,
  note,
  Icon,
  side,
}: {
  name: string;
  note: string;
  Icon: () => React.ReactElement;
  side: "left" | "right";
}) {
  return (
    <div
      className={`flex items-center gap-4 rounded-2xl border border-brand-border bg-white px-5 py-4 transition-all hover:border-accent-ink/40 hover:shadow-md ${side === "right" ? "md:flex-row-reverse md:text-right" : ""
        }`}
    >
      <Icon />
      <div>
        <div className="font-serif text-xl leading-none">{name}</div>
        <div className="mt-1 text-xs uppercase tracking-wider text-brand-muted">{note}</div>
      </div>
    </div>
  );
}

function ProductPeek() {
  return (
    <section id="product" className="relative bg-accent-soft/60 py-32 overflow-hidden scroll-mt-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-16 max-w-2xl relative z-10">
          <Eyebrow index="04" label="The Resolution Engine" fileId="RF-DSB" status="Operational" />
          <h2 className="mt-4 font-serif text-4xl md:text-5xl">
            Every exception, <span className="italic text-accent-ink">explained</span>.
          </h2>
          <p className="mt-4 text-lg text-brand-muted">
            Legacy tools tell you it's mismatched. ReconFlow tells you it's a Stripe wire fee
            of ₹400 — and offers a one-click resolution.
          </p>
        </div>

        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-100px" }}
          variants={{
            hidden: {},
            show: {
              transition: { staggerChildren: 0.15 },
            },
          }}
          className="relative z-10"
        >
          {/* Magazine Annotation 1 */}
          <motion.div
            variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] } } }}
            className="absolute -left-4 top-1/4 hidden max-w-[140px] md:block xl:-left-12"
          >
            <div className="h-px w-8 bg-brand-border/80 mb-2"></div>
            <p className="font-serif text-sm italic text-brand-black">Every match includes evidence.</p>
          </motion.div>

          {/* Magazine Annotation 2 */}
          <motion.div
            variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.4 } } }}
            className="absolute -right-4 bottom-1/4 hidden max-w-[140px] text-right md:block xl:-right-12"
          >
            <div className="h-px w-8 bg-brand-border/80 mb-2 ml-auto"></div>
            <p className="font-serif text-sm italic text-brand-black">Nothing changes until you approve.</p>
          </motion.div>

          <motion.div
            variants={{ hidden: { opacity: 0, y: 30 }, show: { opacity: 1, y: 0, transition: { duration: 1, ease: [0.16, 1, 0.3, 1] } } }}
            className="relative overflow-hidden rounded-xl border border-brand-border/60 bg-white shadow-[0_20px_60px_-15px_oklch(0.42_0.08_165/0.15)] ring-1 ring-black/5 md:mx-16 xl:mx-24"
          >
            {/* Dashboard Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-brand-border/50 bg-accent-soft/20 px-6 py-4 gap-4">
              <div className="flex items-center gap-4">
                <h3 className="font-serif text-xl tracking-tight">Reconciliation Queue</h3>
                <span className="rounded-full bg-accent-ink/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent-ink">
                  14 Pending
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <input type="text" placeholder="Search references..." className="w-48 rounded-md border border-brand-border/60 bg-white px-3 py-1.5 text-xs text-brand-black placeholder-brand-muted/60 shadow-sm focus:border-accent-ink focus:outline-none focus:ring-1 focus:ring-accent-ink" readOnly />
                </div>
                <button className="rounded-md border border-brand-border/60 bg-white px-3 py-1.5 text-xs font-medium text-brand-black shadow-sm hover:bg-accent-soft/40">
                  Filter
                </button>
              </div>
            </div>

            {/* Table Header */}
            <div className="grid grid-cols-12 gap-4 border-b border-brand-border/50 bg-white px-6 py-3 text-[10px] font-semibold uppercase tracking-widest text-brand-muted/80">
              <div className="col-span-3 sm:col-span-2">Date & Ref</div>
              <div className="col-span-4 sm:col-span-3 hidden sm:block">Description</div>
              <div className="col-span-3 sm:col-span-2 text-right">Amount</div>
              <div className="col-span-4 sm:col-span-3">Evidence Trail</div>
              <div className="col-span-2 text-right">Action</div>
            </div>

            {/* Table Body */}
            <div className="divide-y divide-brand-border/40 bg-white">
              <DashRow
                date="18 Jun"
                refNum="INV-0184"
                description="Stripe Payout"
                counterparty="HDFC Current"
                amount="₹ 1,45,000"
                tone="match"
                status="Exact Match"
                analysis="100% confidence. Amounts and dates align perfectly."
                action="View"
              />
              <DashRow
                date="18 Jun"
                refNum="SUB-0991"
                description="Razorpay Settlement"
                counterparty="Tally Ledger"
                amount="₹ 11,600"
                tone="suggest"
                status="Suggested Match"
                analysis="Short ₹400. Identified as standard gateway fee."
                action="Approve"
                actionPrimary
              />
              <DashRow
                date="17 Jun"
                refNum="WIR-2210"
                description="Incoming Wire"
                counterparty="ICICI Bank"
                amount="+ ₹ 120"
                tone="flag"
                status="Unmatched"
                analysis="No matching invoice found in last 30 days."
                action="Review"
              />
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

function DashRow({
  date,
  refNum,
  description,
  counterparty,
  amount,
  tone,
  status,
  analysis,
  action,
  actionPrimary,
}: {
  date: string;
  refNum: string;
  description: string;
  counterparty: string;
  amount: string;
  tone: "match" | "suggest" | "flag";
  status: string;
  analysis: string;
  action: string;
  actionPrimary?: boolean;
}) {
  const toneStyles = {
    match: { badge: "bg-accent-ink/10 text-accent-ink" },
    suggest: { badge: "bg-[#855A1F]/10 text-[#855A1F]" },
    flag: { badge: "bg-accent-flag/10 text-accent-flag" },
  };

  const style = toneStyles[tone];

  return (
    <motion.div
      variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } } }}
      className="group grid grid-cols-12 gap-4 items-center px-6 py-4 transition-colors hover:bg-accent-soft/20"
    >
      <div className="col-span-3 sm:col-span-2">
        <div className="text-xs font-medium text-brand-black">{date}</div>
        <div className="mt-1 font-mono text-[10px] text-brand-muted/80">{refNum}</div>
      </div>

      <div className="col-span-4 sm:col-span-3 hidden sm:block">
        <div className="text-sm text-brand-black">{description}</div>
        <div className="mt-0.5 text-xs text-brand-muted">{counterparty}</div>
      </div>

      <div className="col-span-3 sm:col-span-2 text-right">
        <div className="font-serif text-base text-brand-black">{amount}</div>
      </div>

      <div className="col-span-4 sm:col-span-3">
        <div className="flex items-center gap-2 mb-1.5">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${style.badge}`}>
            {status}
          </span>
        </div>
        <p className="text-[11px] leading-snug text-brand-muted">{analysis}</p>
      </div>

      <div className="col-span-2 flex justify-end">
        <button
          className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${actionPrimary
              ? "bg-brand-black text-white shadow-sm hover:bg-brand-black/90 hover:shadow"
              : "border border-brand-border/60 bg-white text-brand-black shadow-sm hover:bg-accent-soft/40"
            }`}
        >
          {action}
        </button>
      </div>
    </motion.div>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: "01",
      title: "Connect",
      body: "1-click OAuth to Stripe, QuickBooks, Tally, and your bank. Read-only access. Live in an hour, not six months.",
    },
    {
      n: "02",
      title: "Matches identified",
      body: "Exact, fuzzy, and bulk matching — handles partial payments, FX deltas, and wire fees automatically.",
    },
    {
      n: "03",
      title: "Review exceptions",
      body: "Only what the engine couldn't confidently match lands on your dashboard, with evidence and a suggested fix.",
    },
    {
      n: "04",
      title: "You approve",
      body: "Nothing touches your ledger until a human clicks Approve. ReconFlow is the assistant, you stay in control.",
    },
  ];
  return (
    <section id="how-it-works" className="py-28 scroll-mt-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-16 max-w-2xl">
          <Eyebrow index="05" label="Matching Protocol" fileId="RF-PROC" status="Verified" />
          <h2 className="mt-4 font-serif text-4xl md:text-5xl">
            Four steps. <span className="italic text-accent-ink">Zero</span> spreadsheets.
          </h2>
        </div>
        <div className="grid gap-10 md:grid-cols-4">
          {steps.map((s, i) => (
            <div key={s.n} className="relative">
              {i < steps.length - 1 && (
                <div
                  aria-hidden
                  className="absolute left-12 top-6 hidden h-px w-[calc(100%-3rem)] bg-gradient-to-r from-accent-warm/60 to-transparent md:block"
                />
              )}
              <div className="font-serif text-5xl italic text-accent-warm">{s.n}</div>
              <h3 className="mt-4 font-serif text-2xl">{s.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-brand-muted">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Compare() {
  const rows = [
    { label: "Time spent", legacy: "3 days per month-end", us: "3 hours" },
    { label: "Reconciliation flow", legacy: "Spreadsheet hunting", us: "Evidence panel" },
    { label: "Fee tracking", legacy: "Manual fee tracking", us: "Auto-detected" },
    { label: "Review process", legacy: "Review everything", us: "Review exceptions only" },
    { label: "Audit trail", legacy: "Excel overrides (unlogged)", us: "Every decision is audit-ready" },
  ];
  return (
    <section className="bg-accent-soft/60 py-28 relative z-10">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-14 max-w-2xl">
          <Eyebrow index="06" label="System Comparison" fileId="RF-COMP" status="Evaluated" />
          <h2 className="mt-4 font-serif text-4xl md:text-5xl">
            Legacy tools were built for <span className="italic">audit firms</span>.
            We're built for <span className="italic text-accent-ink">your CFO</span>.
          </h2>
        </div>
        <div className="overflow-hidden rounded-2xl border border-brand-border bg-white">
          <div className="grid grid-cols-3 border-b border-brand-border bg-accent-soft/50 px-6 py-4 text-xs font-semibold uppercase tracking-[0.16em] text-brand-muted">
            <div></div>
            <div>Manual & Excel</div>
            <div className="font-brand text-sm normal-case tracking-normal text-slate-900">
              Recon<span className="italic text-accent-ink">F</span>low
            </div>
          </div>
          {rows.map((r) => (
            <div
              key={r.label}
              className="grid grid-cols-3 items-center border-b border-brand-border/70 px-6 py-5 last:border-b-0"
            >
              <div className="text-sm font-semibold">{r.label}</div>
              <div className="flex items-center gap-2 text-sm text-brand-muted">
                <span className="text-accent-flag">✕</span>
                {r.legacy}
              </div>
              <div className="flex items-center gap-2 text-sm text-brand-black">
                <span className="text-accent-ink">✓</span>
                {r.us}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  return (
    <section id="pricing" className="py-28 scroll-mt-24 relative z-10">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-16 text-center">
          <Eyebrow index="08" label="Program Agreement" fileId="RF-PRIC" status="Open" />
          <h2 className="mt-4 font-serif text-4xl md:text-5xl">
            Founding Customer Program
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-brand-muted">
            We are selecting 10 early design partners to co-build the future of Indian bank reconciliation. Lock in foundational pricing and work directly with our engineering team.
          </p>
        </div>

        <div className="max-w-3xl mx-auto rounded-3xl border border-accent-warm bg-white p-8 md:p-12 shadow-[0_30px_80px_-50px_oklch(0.78_0.13_65/0.5)] relative">
          <div className="absolute -top-3 right-6 rounded-full bg-accent-warm px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-brand-black">
            Beta Cohort Open
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
            <div>
              <h3 className="font-serif text-3xl font-medium text-brand-black">Design Partner Pilot</h3>
              <p className="text-xs uppercase tracking-[0.16em] text-brand-muted mt-2">Co-build ReconFlow with us</p>

              <div className="mt-6 flex flex-col justify-end">
                <span className="font-serif text-5xl leading-none">Free Pilot</span>
                <span className="mt-2 text-xs font-semibold text-accent-ink uppercase tracking-wider">
                  No implementation or software fees during beta
                </span>
              </div>

              <p className="mt-6 text-sm text-brand-muted leading-relaxed">
                We work alongside your finance team to map your charts of accounts, connect bank feeds, and configure settlement fee logic.
              </p>
            </div>

            <div className="bg-accent-soft/20 border border-brand-border rounded-2xl p-6 flex flex-col justify-between h-full">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-brand-muted block mb-4">Program Perks</span>
                <ul className="space-y-3.5 text-xs text-brand-black">
                  <li className="flex items-start gap-2.5">
                    <span className="text-accent-ink font-bold">✓</span>
                    <span><strong>Unlimited</strong> transaction volume</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="text-accent-ink font-bold">✓</span>
                    <span><strong>Custom</strong> Tally / QuickBooks connectors</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="text-accent-ink font-bold">✓</span>
                    <span>Direct WhatsApp/Slack with founding team</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="text-accent-ink font-bold">✓</span>
                    <span><strong>50% lifetime discount</strong> on launch pricing</span>
                  </li>
                </ul>
              </div>

              <div className="mt-8">
                <a
                  href="mailto:adityajain2903@gmail.com?subject=ReconFlow%20Pilot%20Application"
                  className="block w-full bg-brand-black text-white hover:bg-brand-black/90 font-medium py-3 rounded-full text-center text-sm transition-all hover:scale-[1.01]"
                >
                  Apply for Pilot
                </a>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-12 text-center text-xs text-brand-muted max-w-lg mx-auto leading-relaxed">
          Have custom requirements, multi-entity accounting, or special ERP constraints? &nbsp;
          <a
            href="mailto:adityajain2903@gmail.com?subject=ReconFlow%20Direct%20Founder%20Contact"
            className="font-semibold text-brand-black underline underline-offset-4 hover:text-accent-ink"
          >
            Talk to the founders directly &rarr;
          </a>
        </div>
      </div>
    </section>
  );
}

function Trust() {
  const items = [
    { label: "Read-only", body: "We never write to your bank without you" },
    { label: "SOC 2", body: "Type I in progress, Type II by Q4" },
    { label: "Hosted in India", body: "Secure cloud · DPDP-aligned" },
    { label: "Human-approved", body: "AI suggests, your accountant ships" },
  ];
  return (
    <section id="security" className="border-y border-brand-border bg-white py-20 relative z-10">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-10 text-center">
          <Eyebrow index="09" label="Risk & Security Audit" fileId="RF-SECR" status="Certified" />
          <h2 className="mt-4 font-serif text-3xl md:text-4xl">
            Your bank doesn't trust just <span className="italic">anyone</span>. Neither should you.
          </h2>
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          {items.map((i) => (
            <div
              key={i.label}
              className="rounded-xl border border-brand-border bg-white p-5 transition-colors hover:border-accent-ink/40"
            >
              <div className="flex items-center gap-2">
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  className="size-4 text-accent-ink"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 2 L3 6 v6 c0 5 3.5 8.5 9 10 c5.5 -1.5 9 -5 9 -10 V6 Z" />
                </svg>
                <span className="font-serif text-lg">{i.label}</span>
              </div>
              <p className="mt-2 text-sm text-brand-muted">{i.body}</p>
            </div>
          ))}
        </div>

        {/* Pilot Results Banner */}
        <div className="mt-16 rounded-2xl border border-brand-border bg-accent-soft/30 p-8 grid grid-cols-1 md:grid-cols-3 gap-8 items-center text-left">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-accent-warm">Pilot Results</div>
            <h4 className="font-serif text-3xl font-semibold text-brand-black mt-2">50,000+</h4>
            <p className="text-xs text-brand-muted mt-1 leading-relaxed">Transactions handled during testing and early beta operations.</p>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-accent-ink">Detected Anomalies</div>
            <h4 className="font-serif text-xl font-medium text-brand-black mt-2">Auto-Identified</h4>
            <p className="text-xs text-brand-muted mt-1 leading-relaxed">Instantly flags missing gateway fees, bulk payout bundles, and clearing delays.</p>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-brand-muted">Target Cohort</div>
            <h4 className="font-serif text-xl font-medium text-brand-black mt-2">Built for India</h4>
            <p className="text-xs text-brand-muted mt-1 leading-relaxed">Tailored specifically for finance operations using Stripe, Razorpay, QuickBooks, and Tally.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function FinalCTA({
  isLoggedIn,
}: {
  isLoggedIn: boolean;
}) {
  return (
    <section id="demo" className="relative overflow-hidden bg-[oklch(0.18_0.02_165)] py-28 text-white">
      <div className="absolute inset-0 opacity-[0.08]">
        <LedgerGrid />
      </div>
      <div className="relative mx-auto max-w-3xl px-6 text-center">
        <h2 className="font-serif text-5xl leading-[1.05] md:text-6xl">
          Close your books in <span className="italic text-accent-warm">hours</span>, not days.
        </h2>
        <p className="mx-auto mt-6 max-w-xl text-white/70">
          Join the finance teams who reclaimed their month-end. Live demo in 30 minutes — bring
          one real bank statement and we'll match it on the call.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          {isLoggedIn ? (
            <Link
              href="/dashboard"
              className="w-full rounded-full bg-accent-warm px-8 py-4 text-base font-semibold text-brand-black transition-all hover:scale-[1.02] sm:w-auto text-center"
            >
              Go to Dashboard
            </Link>
          ) : (
            <a
              href="mailto:adityajain2903@gmail.com?subject=ReconFlow%20Demo%20Booking"
              className="w-full rounded-full bg-accent-warm px-8 py-4 text-base font-semibold text-brand-black transition-all hover:scale-[1.02] sm:w-auto text-center"
            >
              Book your demo
            </a>
          )}
          <Link
            href="/dashboard?demo=true"
            className="w-full rounded-full border border-white/20 px-8 py-4 text-base font-medium text-white transition-colors hover:bg-white/5 sm:w-auto text-center"
          >
            Try Live Demo →
          </Link>
        </div>
        <p className="mt-6 text-xs uppercase tracking-[0.18em] text-white/40">
          No credit card · No procurement cycle · Pilot in a week
        </p>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-brand-border bg-white py-14">
      <div className="mx-auto grid max-w-7xl gap-10 px-6 md:grid-cols-3">
        <div>
          <Wordmark />
          <p className="mt-4 max-w-xs text-sm text-brand-muted">
            AI bank reconciliation for Indian startups. Stripe, QuickBooks, Tally — matched and
            approved.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-6 text-sm md:col-span-2 md:grid-cols-3">
          <FooterCol
            title="Product"
            links={["Integrations", "Pricing", "Security", "Changelog"]}
          />
          <FooterCol title="Company" links={["About", "Careers", "Blog", "Contact"]} />
          <FooterCol title="Legal" links={["Privacy", "Terms", "DPA", "Status"]} />
        </div>
      </div>
      <div className="mx-auto mt-12 flex max-w-7xl flex-col items-start justify-between gap-4 border-t border-brand-border px-6 pt-6 text-xs uppercase tracking-[0.16em] text-brand-muted md:flex-row md:items-center">
        <div>© {new Date().getFullYear()} ReconFlow Technologies Pvt. Ltd.</div>
        <div className="flex gap-6">
          <Link href="#">Twitter</Link>
          <Link href="#">LinkedIn</Link>
          <Link href="#">GitHub</Link>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: string[] }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-muted">
        {title}
      </div>
      <ul className="mt-4 space-y-2">
        {links.map((l) => (
          <li key={l}>
            <Link
              href={l === "Contact" ? "mailto:adityajain2903@gmail.com?subject=ReconFlow%20Contact" : "#"}
              className="text-brand-black hover:text-accent-ink"
            >
              {l}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}