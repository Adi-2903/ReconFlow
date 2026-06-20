import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Zap,
  BarChart3,
  Link2,
  ShieldCheck,
  Activity,
  BrainCircuit,
  X,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface LandingPageProps {
  isLoggedIn: boolean;
}

export default function LandingPage({ isLoggedIn }: LandingPageProps) {
  return (
    <div className="min-h-screen bg-white selection:bg-[var(--accent-soft)] selection:text-[var(--accent-ink)] font-sans">
      <style>{`
        :root {
          --accent-ink: oklch(0.42 0.13 165);
          --accent-warm: oklch(0.78 0.13 65);
          --accent-soft: oklch(0.97 0.03 90);
          --accent-flag: oklch(0.65 0.18 35);
          --brand-black: oklch(0.18 0.01 270);
          --brand-muted: oklch(0.52 0.01 270);
          --brand-border: oklch(0.9 0.005 270);
        }
        .font-serif-display {
          font-family: "Source Serif 4", "Georgia", serif;
        }
      `}</style>

      {/* Navbar */}
      <header className="fixed top-0 inset-x-0 h-16 bg-white/80 backdrop-blur-lg border-b border-[var(--brand-border)] z-50 transition-all">
        <div className="container mx-auto px-4 sm:px-6 h-full flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shadow-sm"
              style={{ backgroundColor: "var(--accent-ink)" }}
            >
              <Activity className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight text-[var(--brand-black)]">
              ReconFlow
            </span>
          </div>

          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-[var(--brand-muted)]">
            <a
              href="#features"
              className="hover:text-[var(--accent-ink)] transition-colors"
            >
              Features
            </a>
            <a
              href="#how-it-works"
              className="hover:text-[var(--accent-ink)] transition-colors"
            >
              How it Works
            </a>
            <a
              href="#why"
              className="hover:text-[var(--accent-ink)] transition-colors"
            >
              Why ReconFlow
            </a>
            <a
              href="#integrations"
              className="hover:text-[var(--accent-ink)] transition-colors"
            >
              Integrations
            </a>
          </nav>

          <div className="flex items-center gap-4">
            <Link href="/sign-in">
              <Button
                variant="ghost"
                className="hidden sm:inline-flex text-[var(--brand-muted)] hover:text-[var(--brand-black)]"
              >
                Log in
              </Button>
            </Link>
            <Link href={isLoggedIn ? "/dashboard" : "/sign-in"}>
              <Button
                className="text-white shadow-md hover:opacity-90"
                style={{ backgroundColor: "var(--accent-ink)" }}
              >
                {isLoggedIn ? "Go to Dashboard" : "Get Started"}
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="pt-16">
        {/* Hero Section */}
        <section className="relative pt-24 pb-32 overflow-hidden bg-white">
          <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.06] mix-blend-multiply pointer-events-none" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full max-w-7xl pointer-events-none">
            <div
              className="absolute -top-[35%] -left-[10%] w-[60%] h-[60%] rounded-full blur-[130px] opacity-[0.18]"
              style={{ backgroundColor: "var(--accent-ink)" }}
            />
            <div
              className="absolute top-[15%] -right-[10%] w-[50%] h-[50%] rounded-full blur-[130px] opacity-[0.18]"
              style={{ backgroundColor: "var(--accent-warm)" }}
            />
          </div>

          <div className="container mx-auto px-4 sm:px-6 relative z-10">
            <div className="max-w-4xl mx-auto text-center">
              <div
                className="inline-flex items-center gap-2 px-3 py-1 rounded-full border text-sm font-medium mb-8"
                style={{
                  backgroundColor: "var(--accent-soft)",
                  borderColor: "var(--brand-border)",
                  color: "var(--accent-ink)",
                }}
              >
                <SparklesIcon className="w-4 h-4" />
                <span>AI-Powered Bank Reconciliation</span>
              </div>

              <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight text-[var(--brand-black)] mb-8 leading-[1.1]">
                Reconcile faster with <br className="hidden md:block" />
                <span style={{ color: "var(--accent-ink)" }}>
                  intelligent automation
                </span>
              </h1>

              <p className="text-lg md:text-xl text-[var(--brand-muted)] mb-10 max-w-2xl mx-auto leading-relaxed">
                Connect your bank feeds, QuickBooks, and Tally exports. Let
                our AI engine instantly match transactions, handle
                exceptions, and generate audit-ready reports.
              </p>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link href={isLoggedIn ? "/dashboard" : "/sign-in"}>
                  <Button
                    size="lg"
                    className="h-14 px-8 text-base text-white shadow-xl hover:opacity-90"
                    style={{ backgroundColor: "var(--brand-black)" }}
                  >
                    {isLoggedIn ? "Go to Dashboard" : "Start Reconciling Now"}
                    <ArrowRight className="ml-2 w-5 h-5" />
                  </Button>
                </Link>
                <Link href="#how-it-works">
                  <Button
                    size="lg"
                    variant="outline"
                    className="h-14 px-8 text-base bg-white border-[var(--brand-border)] text-[var(--brand-black)] hover:bg-[var(--accent-soft)]"
                  >
                    See how it works
                  </Button>
                </Link>
              </div>
            </div>

            {/* Dashboard Mockup Visual */}
            <div className="mt-20 relative max-w-5xl mx-auto">
              <div
                className="absolute -inset-1 rounded-2xl blur opacity-20"
                style={{
                  background:
                    "linear-gradient(90deg, var(--accent-ink), var(--accent-warm))",
                }}
              />
              <div className="relative rounded-2xl bg-white border border-[var(--brand-border)] shadow-2xl overflow-hidden">
                <div className="h-12 border-b border-[var(--brand-border)] bg-[var(--accent-soft)] flex items-center px-4 gap-2">
                  <div className="flex gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-[var(--accent-flag)]" />
                    <div className="w-3 h-3 rounded-full bg-[var(--accent-warm)]" />
                    <div className="w-3 h-3 rounded-full bg-[var(--accent-ink)]" />
                  </div>
                  <div className="mx-auto w-64 h-6 bg-white rounded-md border border-[var(--brand-border)] flex items-center justify-center">
                    <span className="text-[10px] text-[var(--brand-muted)] font-mono">
                      reconflow.com/dashboard
                    </span>
                  </div>
                </div>

                <div className="p-6 md:p-8 bg-[var(--accent-soft)]/40 flex flex-col gap-6">
                  {/* Mock Stats */}
                  <div className="grid grid-cols-3 gap-4">
                    {[
                      {
                        label: "Total Matches",
                        value: "1,248",
                        color: "var(--accent-ink)",
                      },
                      {
                        label: "Pending Exceptions",
                        value: "12",
                        color: "var(--accent-flag)",
                      },
                      {
                        label: "Reconciliation Rate",
                        value: "98.4%",
                        color: "var(--accent-ink)",
                      },
                    ].map((stat, i) => (
                      <div
                        key={i}
                        className="bg-white p-4 rounded-xl border border-[var(--brand-border)] shadow-sm"
                      >
                        <div className="text-sm text-[var(--brand-muted)] font-medium mb-1">
                          {stat.label}
                        </div>
                        <div
                          className="text-2xl font-bold"
                          style={{ color: stat.color }}
                        >
                          {stat.value}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Interactive Visualizer Mock */}
                  <div className="bg-white rounded-xl border border-[var(--brand-border)] shadow-sm p-6 relative overflow-hidden">
                    <div className="text-sm font-semibold text-[var(--brand-black)] mb-6 flex items-center justify-between">
                      <span>Live Matching Engine</span>
                      <div
                        className="flex items-center gap-2 text-xs px-2 py-1 rounded-full"
                        style={{
                          color: "var(--accent-ink)",
                          backgroundColor: "var(--accent-soft)",
                        }}
                      >
                        <BrainCircuit className="w-3.5 h-3.5" /> AI Active
                      </div>
                    </div>

                    <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                      {/* Left: Bank */}
                      <div className="w-full md:w-2/5 border border-[var(--brand-border)] rounded-lg p-4 bg-[var(--accent-soft)]/40">
                        <div className="text-[10px] font-bold text-[var(--brand-muted)] uppercase tracking-wider mb-3">
                          Stripe Payout
                        </div>
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="font-medium text-[var(--brand-black)] text-sm">
                              Transfer to Bank
                            </div>
                            <div className="text-xs text-[var(--brand-muted)] mt-1">
                              po_1NxY...
                            </div>
                          </div>
                          <div
                            className="font-bold text-sm"
                            style={{ color: "var(--accent-ink)" }}
                          >
                            +$4,250.00
                          </div>
                        </div>
                      </div>

                      {/* Center: Match Link */}
                      <div className="flex flex-col items-center justify-center shrink-0 py-2 relative w-full md:w-1/5">
                        <div className="w-full h-px bg-[var(--brand-border)] absolute top-1/2 -translate-y-1/2 z-0 hidden md:block" />
                        <div className="w-px h-full bg-[var(--brand-border)] absolute left-1/2 -translate-x-1/2 z-0 md:hidden" />
                        <div
                          className="relative z-10 bg-white border-2 rounded-full w-8 h-8 flex items-center justify-center shadow-sm"
                          style={{ borderColor: "var(--accent-ink)" }}
                        >
                          <CheckCircle2
                            className="w-4 h-4"
                            style={{ color: "var(--accent-ink)" }}
                          />
                        </div>
                        <div
                          className="text-[10px] font-bold mt-2 bg-white px-2 relative z-10"
                          style={{ color: "var(--accent-ink)" }}
                        >
                          EXACT MATCH
                        </div>
                      </div>

                      {/* Right: Ledger */}
                      <div className="w-full md:w-2/5 border border-[var(--brand-border)] rounded-lg p-4 bg-[var(--accent-soft)]/40">
                        <div className="text-[10px] font-bold text-[var(--brand-muted)] uppercase tracking-wider mb-3">
                          QuickBooks Ledger
                        </div>
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="font-medium text-[var(--brand-black)] text-sm">
                              Stripe Settlement
                            </div>
                            <div className="text-xs text-[var(--brand-muted)] mt-1">
                              Ref: STR-4250
                            </div>
                          </div>
                          <div className="font-bold text-[var(--brand-black)] text-sm">
                            $4,250.00
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Logos Section */}
        <section
          id="integrations"
          className="py-16 bg-white border-y border-[var(--brand-border)]"
        >
          <div className="container mx-auto px-4 text-center">
            <p className="text-sm font-semibold text-[var(--brand-muted)] tracking-widest uppercase mb-8">
              Connects seamlessly with
            </p>
            <div className="flex flex-wrap justify-center items-center gap-12 opacity-70 grayscale hover:grayscale-0 transition-all duration-500">
              <div className="text-2xl font-bold tracking-tighter text-[var(--brand-black)]">
                QuickBooks
              </div>
              <div className="text-2xl font-bold tracking-tighter text-[var(--brand-black)] flex items-center gap-1">
                <div
                  className="w-5 h-5 rounded-sm"
                  style={{ backgroundColor: "var(--accent-ink)" }}
                />{" "}
                Stripe
              </div>
              <div className="text-2xl font-bold tracking-tighter text-[var(--brand-black)]">
                TALLY.ERP
              </div>
              <div className="text-xl font-bold tracking-tighter text-[var(--brand-black)]">
                CSV &amp; Excel
              </div>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="py-24 bg-white">
          <div className="container mx-auto px-4 sm:px-6 max-w-6xl">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold text-[var(--brand-black)] mb-4">
                Everything you need to close the books
              </h2>
              <p className="text-lg text-[var(--brand-muted)] max-w-2xl mx-auto">
                Reconflow automates the tedious parts of financial
                reconciliation, giving your finance team their time back.
              </p>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              <FeatureCard
                icon={<Link2 className="w-6 h-6" style={{ color: "var(--accent-ink)" }} />}
                title="Multi-Source Sync"
                description="Connect live to QuickBooks and Stripe, or upload your bank statements and Tally XMLs directly."
              />
              <FeatureCard
                icon={<Zap className="w-6 h-6" style={{ color: "var(--accent-ink)" }} />}
                title="4-Pass Matching Engine"
                description="Our deterministic engine matches exact amounts, fuzzy dates, reference IDs, and grouped payouts."
              />
              <FeatureCard
                icon={<BrainCircuit className="w-6 h-6" style={{ color: "var(--accent-ink)" }} />}
                title="AI Exception Handling"
                description="Reconflow reasons through edge cases, mismatched names, and missing fees to explain every suggested match in plain language."
              />
              <FeatureCard
                icon={<BarChart3 className="w-6 h-6" style={{ color: "var(--accent-ink)" }} />}
                title="Real-time Reporting"
                description="View your reconciliation health instantly. Spot unrecorded payments or missing deposits before month-end."
              />
              <FeatureCard
                icon={<ShieldCheck className="w-6 h-6" style={{ color: "var(--accent-ink)" }} />}
                title="Audit-Ready Exports"
                description="Download complete reconciliation reports as CSV, Excel, or PDF to hand off to your auditors."
              />
              <FeatureCard
                icon={<Activity className="w-6 h-6" style={{ color: "var(--accent-ink)" }} />}
                title="Privacy First"
                description="Your financial data is encrypted and secure. We never store raw credentials."
              />
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section
          id="how-it-works"
          className="py-24"
          style={{ backgroundColor: "var(--accent-soft)" }}
        >
          <div className="container mx-auto px-4 sm:px-6 max-w-6xl">
            <div className="text-center mb-20">
              <p
                className="text-sm font-semibold tracking-widest uppercase mb-3"
                style={{ color: "var(--accent-ink)" }}
              >
                How it works
              </p>
              <h2 className="font-serif-display text-3xl md:text-4xl font-bold text-[var(--brand-black)]">
                From statement to sign-off in four steps
              </h2>
            </div>

            <div className="relative grid md:grid-cols-4 gap-12 md:gap-6">
              {/* hairline connector row, desktop only */}
              <div
                className="hidden md:block absolute top-7 left-[12.5%] right-[12.5%] h-px"
                style={{ backgroundColor: "var(--brand-border)" }}
              />

              {[
                {
                  n: "01",
                  title: "Connect",
                  desc: "Link QuickBooks and Stripe, or drop in bank statements and Tally exports — HDFC, ICICI, SBI, all formats welcome.",
                },
                {
                  n: "02",
                  title: "AI Match",
                  desc: "The 4-pass engine runs exact, fuzzy, and bulk matching in seconds, then hands edge cases to the AI for a plain-language read.",
                },
                {
                  n: "03",
                  title: "Exception Dashboard",
                  desc: "Everything that didn't auto-match lands in one queue, each with the AI's reasoning attached — no spreadsheet archaeology.",
                },
                {
                  n: "04",
                  title: "Approve",
                  desc: "Review the AI's suggested matches, approve or override in one click, and export an audit-ready reconciliation report.",
                },
              ].map((step) => (
                <div key={step.n} className="relative flex flex-col items-start">
                  <div
                    className="font-serif-display italic text-4xl mb-5 bg-[var(--accent-soft)] pr-3 relative z-10"
                    style={{ color: "var(--accent-ink)" }}
                  >
                    {step.n}
                  </div>
                  <h3 className="text-lg font-bold text-[var(--brand-black)] mb-2">
                    {step.title}
                  </h3>
                  <p className="text-[var(--brand-muted)] leading-relaxed text-[15px]">
                    {step.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Why ReconFlow — compare table */}
        <section id="why" className="py-24 bg-white">
          <div className="container mx-auto px-4 sm:px-6 max-w-5xl">
            <div className="text-center mb-16">
              <p
                className="text-sm font-semibold tracking-widest uppercase mb-3"
                style={{ color: "var(--accent-ink)" }}
              >
                Why ReconFlow
              </p>
              <h2 className="font-serif-display text-3xl md:text-4xl font-bold text-[var(--brand-black)]">
                Built for how Indian finance teams actually reconcile
              </h2>
            </div>

            <div className="rounded-2xl border border-[var(--brand-border)] overflow-hidden shadow-sm">
              {/* header row */}
              <div className="grid grid-cols-2">
                <div className="px-6 md:px-8 py-5 bg-white border-b border-r border-[var(--brand-border)]">
                  <span className="text-sm font-semibold text-[var(--brand-muted)] uppercase tracking-wider">
                    Legacy tools
                  </span>
                </div>
                <div
                  className="px-6 md:px-8 py-5 border-b border-[var(--brand-border)]"
                  style={{ backgroundColor: "var(--accent-soft)" }}
                >
                  <span
                    className="text-sm font-semibold uppercase tracking-wider"
                    style={{ color: "var(--accent-ink)" }}
                  >
                    ReconFlow
                  </span>
                </div>
              </div>

              {[
                {
                  legacy: "Exact-match only — anything else becomes manual work",
                  recon:
                    "AI-explained matches for fuzzy dates, partial refs, and renamed counterparties",
                },
                {
                  legacy: "6–12 month implementation with consultants",
                  recon: "Connect your accounts and start matching within an hour",
                },
                {
                  legacy: "Bulk payouts unpacked by hand, line by line",
                  recon:
                    "Bulk subset-sum matching reconciles grouped settlements automatically",
                },
                {
                  legacy: "Black-box scoring with no audit trail",
                  recon: "Every AI suggestion comes with a plain-language explanation",
                },
              ].map((row, i, arr) => (
                <div
                  key={i}
                  className={`grid grid-cols-2 ${i !== arr.length - 1 ? "border-b border-[var(--brand-border)]" : ""}`}
                >
                  <div className="px-6 md:px-8 py-6 border-r border-[var(--brand-border)] flex gap-3 items-start">
                    <X
                      className="w-5 h-5 shrink-0 mt-0.5"
                      style={{ color: "var(--accent-flag)" }}
                    />
                    <span className="text-[var(--brand-muted)] leading-relaxed">
                      {row.legacy}
                    </span>
                  </div>
                  <div className="px-6 md:px-8 py-6 flex gap-3 items-start bg-[var(--accent-soft)]/40">
                    <Check
                      className="w-5 h-5 shrink-0 mt-0.5"
                      style={{ color: "var(--accent-ink)" }}
                    />
                    <span className="text-[var(--brand-black)] leading-relaxed font-medium">
                      {row.recon}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section
          className="py-28 relative overflow-hidden"
          style={{ backgroundColor: "var(--accent-ink)" }}
        >
          <div
            className="absolute -top-1/3 -right-1/4 w-[60%] h-[140%] rounded-full blur-[120px] opacity-20 pointer-events-none"
            style={{ backgroundColor: "var(--accent-warm)" }}
          />
          <div className="container mx-auto px-4 sm:px-6 max-w-3xl text-center relative z-10">
            <h2 className="font-serif-display text-4xl md:text-5xl font-bold text-white mb-8 leading-tight">
              Close your books in hours, not days.
            </h2>
            <p className="text-white/75 text-lg mb-10 max-w-xl mx-auto">
              Start matching your first statement free — no credit card, no
              setup call.
            </p>
            <Link href={isLoggedIn ? "/dashboard" : "/sign-in"}>
              <Button
                size="lg"
                className="h-14 px-10 text-base font-semibold shadow-xl hover:opacity-90"
                style={{ backgroundColor: "var(--accent-warm)", color: "var(--brand-black)" }}
              >
                {isLoggedIn ? "Go to Dashboard" : "Start Reconciling Now"}
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </Link>
          </div>
        </section>
      </main>

      {/* Footer — minimal three-column */}
      <footer className="bg-white border-t border-[var(--brand-border)] py-16">
        <div className="container mx-auto px-4 sm:px-6 max-w-6xl">
          <div className="grid md:grid-cols-3 gap-10 mb-12">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: "var(--accent-ink)" }}
                >
                  <Activity className="w-4 h-4 text-white" />
                </div>
                <span className="text-lg font-bold tracking-tight text-[var(--brand-black)]">
                  ReconFlow
                </span>
              </div>
              <p className="text-sm text-[var(--brand-muted)] leading-relaxed max-w-xs">
                AI-powered reconciliation for Indian startups. Connect your
                books and your bank, and let the matching engine do the rest.
              </p>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-[var(--brand-black)] uppercase tracking-wider mb-4">
                Product
              </h4>
              <ul className="space-y-3 text-sm text-[var(--brand-muted)]">
                <li>
                  <a href="#features" className="hover:text-[var(--accent-ink)] transition-colors">
                    Features
                  </a>
                </li>
                <li>
                  <a href="#how-it-works" className="hover:text-[var(--accent-ink)] transition-colors">
                    How it Works
                  </a>
                </li>
                <li>
                  <a href="#integrations" className="hover:text-[var(--accent-ink)] transition-colors">
                    Integrations
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-[var(--brand-black)] uppercase tracking-wider mb-4">
                Company
              </h4>
              <ul className="space-y-3 text-sm text-[var(--brand-muted)]">
                <li>
                  <a href="#" className="hover:text-[var(--accent-ink)] transition-colors">
                    Privacy
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-[var(--accent-ink)] transition-colors">
                    Terms
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-[var(--accent-ink)] transition-colors">
                    Contact
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="pt-8 border-t border-[var(--brand-border)] text-sm text-[var(--brand-muted)]">
            &copy; {new Date().getFullYear()} ReconFlow Inc. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="bg-white p-6 md:p-8 rounded-2xl border border-[var(--brand-border)] shadow-sm hover:shadow-md transition-shadow">
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center mb-6"
        style={{ backgroundColor: "var(--accent-soft)" }}
      >
        {icon}
      </div>
      <h3 className="text-xl font-bold text-[var(--brand-black)] mb-3">{title}</h3>
      <p className="text-[var(--brand-muted)] leading-relaxed">{description}</p>
    </div>
  );
}

function SparklesIcon(props: any) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
      <path d="M5 3v4" />
      <path d="M19 17v4" />
      <path d="M3 5h4" />
      <path d="M17 19h4" />
    </svg>
  );
}