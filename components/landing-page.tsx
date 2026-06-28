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
    <span className={`font-serif text-2xl leading-none tracking-tight ${className}`}>
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
      <Stats />
      <Integrations />
      <ProductPeek />
      <HowItWorks />
      <Compare />
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
            <a
              href="mailto:adityajain2903@gmail.com?subject=ReconFlow%20Demo%20Booking"
              className="rounded-full bg-brand-black px-5 py-2 text-sm font-medium text-white ring-2 ring-transparent transition-all hover:ring-accent-warm/60"
            >
              Book a demo
            </a>
          )}
        </div>
      </div>
    </nav>
  );
}

function Eyebrow({ index, label }: { index: string; label: string }) {
  return (
    <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-brand-muted">
      <span className="size-1.5 bg-accent-warm" />
      <span>{index}</span>
      <span className="text-brand-border">—</span>
      <span>{label}</span>
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
          The intelligent layer for <br className="hidden sm:block" />
          <span className="relative inline-block">
            <span className="italic">modern</span>
            <Squiggle className="absolute -bottom-2 left-0 h-3 w-full text-accent-warm opacity-80" />
          </span>{" "}
          reconciliation.
        </motion.h1>
        
        <motion.p variants={{ hidden: { opacity: 0, y: 15 }, show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 50, damping: 20 } } }} className="mx-auto mt-10 max-w-[38rem] text-lg leading-relaxed text-brand-muted/90 md:text-xl">
          ReconFlow auto-matches Stripe, QuickBooks, and Tally against your bank ledger.
          AI suggests, your accountant approves — close the month in hours, not days.
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
            href="#product"
            className="w-full rounded-full border border-brand-border bg-white px-8 py-4 text-base font-medium text-brand-black shadow-sm transition-all duration-300 hover:bg-accent-soft/40 sm:w-auto text-center"
          >
            Try the live demo
          </Link>
        </motion.div>

        {/* Trust Row */}
        <motion.div variants={{ hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 1, delay: 0.5 } } }} className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-[11px] font-medium tracking-wide text-brand-muted/60 uppercase">
          <span>• No implementation fee</span>
          <span>• Read-only integrations</span>
          <span>• Enterprise-ready security</span>
        </motion.div>
      </motion.div>

      {/* Product Transition Peek */}
      <motion.div 
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.6 }}
        className="relative mx-auto mt-20 max-w-5xl px-6 md:mt-28"
      >
        <div className="relative mx-auto overflow-hidden rounded-t-3xl border-x border-t border-brand-border/80 bg-white shadow-2xl shadow-brand-black/[0.03] [mask-image:linear-gradient(to_bottom,white_50%,transparent_100%)]">
          <div className="flex items-center justify-between border-b border-brand-border/50 bg-accent-soft/30 px-6 py-4 md:px-8">
            <div className="flex items-center gap-3">
              <div className="size-2 rounded-full bg-accent-ink"></div>
              <div className="text-xs font-semibold uppercase tracking-widest text-brand-muted">Ledger Sync</div>
            </div>
            <div className="hidden text-xs font-medium text-brand-muted sm:block">Last synced: Just now</div>
          </div>
          <div className="h-40 bg-white p-6 md:h-56 md:p-8">
             <div className="flex flex-col gap-4">
               <div className="flex items-center justify-between rounded-xl border border-brand-border/40 bg-accent-soft/10 p-4">
                 <div className="flex items-center gap-4">
                   <div className="size-8 rounded-full bg-brand-border/30"></div>
                   <div className="h-2 w-24 rounded bg-brand-border/40 md:w-32"></div>
                 </div>
                 <div className="h-2 w-12 rounded bg-brand-border/40 md:w-16"></div>
               </div>
               <div className="flex items-center justify-between rounded-xl border border-brand-border/40 bg-accent-soft/10 p-4">
                 <div className="flex items-center gap-4">
                   <div className="size-8 rounded-full bg-brand-border/30"></div>
                   <div className="h-2 w-20 rounded bg-brand-border/40 md:w-28"></div>
                 </div>
                 <div className="h-2 w-12 rounded bg-brand-border/40 md:w-16"></div>
               </div>
             </div>
          </div>
        </div>
      </motion.div>
    </section>
  );
}

function Stats() {
  const stats = [
    { figure: "3–5", unit: "days", caption: "saved at every month-end close" },
    { figure: "98%", unit: "", caption: "transactions auto-matched on day one" },
    { figure: "₹15–25k", unit: "/mo", caption: "accountant cost saved, per company" },
  ];
  return (
    <section className="border-y border-brand-border bg-accent-soft/60 py-20">
      <div className="mx-auto grid max-w-7xl gap-12 px-6 md:grid-cols-3">
        {stats.map((s) => (
          <div key={s.caption} className="text-center md:text-left">
            <div className="font-serif text-6xl italic leading-none text-accent-ink md:text-7xl">
              {s.figure}
              <span className="ml-1 font-sans text-xl not-italic text-brand-muted">{s.unit}</span>
            </div>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-brand-muted md:text-base">
              {s.caption}
            </p>
          </div>
        ))}
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
          <Eyebrow index="01" label="Integrations" />
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
      className={`flex items-center gap-4 rounded-2xl border border-brand-border bg-white px-5 py-4 transition-all hover:border-accent-ink/40 hover:shadow-md ${
        side === "right" ? "md:flex-row-reverse md:text-right" : ""
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
          <Eyebrow index="02" label="Inside the product" />
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
            <p className="font-serif text-sm italic text-brand-black">AI explains every match.</p>
          </motion.div>

          {/* Magazine Annotation 2 */}
          <motion.div 
            variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.4 } } }}
            className="absolute -right-4 bottom-1/4 hidden max-w-[140px] text-right md:block xl:-right-12"
          >
            <div className="h-px w-8 bg-brand-border/80 mb-2 ml-auto"></div>
            <p className="font-serif text-sm italic text-brand-black">Approve with one click.</p>
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
              <div className="col-span-4 sm:col-span-3">AI Analysis</div>
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
                status="AI Suggestion"
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
          className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${
            actionPrimary
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
      title: "AI matches",
      body: "Exact, fuzzy, and bulk matching — handles partial payments, FX deltas, and wire fees automatically.",
    },
    {
      n: "03",
      title: "Review exceptions",
      body: "Only what AI couldn't confidently match lands on your dashboard, with evidence and a suggested fix.",
    },
    {
      n: "04",
      title: "You approve",
      body: "Nothing touches your ledger until a human clicks Approve. AI is the assistant, you stay in control.",
    },
  ];
  return (
    <section id="how-it-works" className="py-28 scroll-mt-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-16 max-w-2xl">
          <Eyebrow index="03" label="How it works" />
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
    { label: "Setup time", legacy: "6–12 months", us: "Under 1 hour" },
    { label: "Mismatch handling", legacy: "Flag and fail", us: "AI explains the root cause" },
    { label: "Bulk payments", legacy: "Manual unbundling", us: "4 invoices + 1 fee → matched" },
    { label: "FX & wire fees", legacy: "Treated as errors", us: "Auto-reconciled with evidence" },
    { label: "Pricing", legacy: "Crores per year", us: "₹25k–₹1.6L per month" },
  ];
  return (
    <section className="bg-accent-soft/60 py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-14 max-w-2xl">
          <Eyebrow index="04" label="Why ReconFlow" />
          <h2 className="mt-4 font-serif text-4xl md:text-5xl">
            Legacy tools were built for <span className="italic">audit firms</span>.
            We're built for <span className="italic text-accent-ink">your CFO</span>.
          </h2>
        </div>
        <div className="overflow-hidden rounded-2xl border border-brand-border bg-white">
          <div className="grid grid-cols-3 border-b border-brand-border bg-accent-soft/50 px-6 py-4 text-xs font-semibold uppercase tracking-[0.16em] text-brand-muted">
            <div></div>
            <div>BlackLine / Numeric</div>
            <div className="text-accent-ink">ReconFlow</div>
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
  const tiers = [
    {
      name: "Early Adopter",
      audience: "Self-serve beta",
      price: "₹0",
      priceSub: "Free during beta",
      features: [
        "Up to 5,000 transactions/mo",
        "Stripe + QuickBooks integration",
        "Community support (Discord)",
        "Read-only secure bank feeds",
      ],
      cta: "Get Beta Access",
      href: "mailto:adityajain2903@gmail.com?subject=ReconFlow%20Beta%20Access%20Request",
    },
    {
      name: "Design Partner",
      audience: "Co-build ReconFlow with us",
      price: "Free Pilot",
      priceSub: "Co-build with founders",
      features: [
        "Unlimited transactions",
        "Custom ERP connectors (Tally, etc.)",
        "Direct WhatsApp/Slack with founders",
        "50% lifetime discount post-beta",
      ],
      highlight: true,
      cta: "Book a 15-min Call",
      href: "mailto:adityajain2903@gmail.com?subject=ReconFlow%20Design%20Partner%20Call",
    },
    {
      name: "Enterprise",
      audience: "For larger scale-ups",
      price: "Custom",
      priceSub: "Tailored deployment",
      features: [
        "Multi-entity support",
        "On-premise / private cloud",
        "SLA & dedicated support",
        "Custom matching engine rules",
      ],
      cta: "Contact Founders",
      href: "mailto:adityajain2903@gmail.com?subject=ReconFlow%20Enterprise%20Inquiry",
    },
  ];
  return (
    <section id="pricing" className="py-28 scroll-mt-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-14 text-center">
          <Eyebrow index="05" label="Pricing & Plans" />
          <h2 className="mt-4 font-serif text-4xl md:text-5xl">
            SaaS-ready plans, <span className="italic text-accent-ink">open for pilots</span>.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-brand-muted">
            We are looking for early design partners and beta testers to co-build the future of Indian bank reconciliation.
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {tiers.map((t) => (
            <div
              key={t.name}
              className={`relative flex flex-col rounded-2xl border bg-white p-8 ${
                t.highlight
                  ? "border-accent-warm shadow-[0_30px_80px_-50px_oklch(0.78_0.13_65/0.6)]"
                  : "border-brand-border"
              }`}
            >
              {t.highlight && (
                <div className="absolute -top-3 right-6 rounded-full bg-accent-warm px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-brand-black">
                  Most chosen
                </div>
              )}
              <div className="font-serif text-2xl">{t.name}</div>
              <div className="mt-1 text-xs uppercase tracking-[0.16em] text-brand-muted">
                {t.audience}
              </div>
              <div className="mt-6 flex flex-col min-h-[70px] justify-end">
                <span className="font-serif text-5xl leading-none">{t.price}</span>
                {t.priceSub && (
                  <span className="mt-2 text-xs font-medium text-brand-muted uppercase tracking-wider">
                    {t.priceSub}
                  </span>
                )}
              </div>
              <ul className="mt-8 flex-1 space-y-3 text-sm text-brand-muted">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <span className="mt-1 text-accent-ink">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <a
                href={t.href}
                className={`mt-8 rounded-full px-5 py-3 text-center text-sm font-medium transition-all ${
                  t.highlight
                    ? "bg-brand-black text-white hover:scale-[1.02]"
                    : "border border-brand-border text-brand-black hover:bg-accent-soft"
                }`}
              >
                {t.cta}
              </a>
            </div>
          ))}
        </div>
        <div className="mt-8 rounded-2xl border border-dashed border-brand-border bg-accent-soft/40 p-6 text-center text-sm text-brand-muted">
          Want to co-build a custom integration or run a pilot during the hackathon? &nbsp;
          <a
            href="mailto:adityajain2903@gmail.com?subject=ReconFlow%20Direct%20Founder%20Contact"
            className="font-semibold text-brand-black underline underline-offset-4 hover:text-accent-ink"
          >
            Talk to the founders directly →
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
    <section id="security" className="border-y border-brand-border bg-white py-20">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-10 text-center">
          <Eyebrow index="06" label="Security & trust" />
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
            href="#product"
            className="w-full rounded-full border border-white/20 px-8 py-4 text-base font-medium text-white transition-colors hover:bg-white/5 sm:w-auto text-center"
          >
            Watch a 2-min walkthrough
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