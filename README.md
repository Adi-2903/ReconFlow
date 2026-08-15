<div align="center">

# ReconFlow

### AI-powered bank reconciliation for startups and SMEs

Stop matching bank statements to ledgers by hand. ReconFlow does it in minutes, explains every mismatch in plain English, and leaves an audit trail behind it.

Built by **Aditya Jain**, **Rachit Bhatia**, and **Nisarg Gandhi**

### 🎥 [Watch the Demo Video](https://youtu.be/VmrsUTN3rNw) &nbsp;|&nbsp; 🚀 [Try the Live App](https://recon-flow-flax.vercel.app/)

[![Live Demo](https://img.shields.io/badge/Live%20Demo-recon--flow--flax.vercel.app-black?style=for-the-badge&logo=vercel)](https://recon-flow-flax.vercel.app/)
[![Watch Demo Video](https://img.shields.io/badge/Watch-Demo%20Video-red?style=for-the-badge&logo=youtube)](https://youtu.be/VmrsUTN3rNw)

![Next.js](https://img.shields.io/badge/Next.js-15.4-black?logo=next.js) ![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript) ![PostgreSQL](https://img.shields.io/badge/Aurora-PostgreSQL-4169E1?logo=postgresql) ![Gemini](https://img.shields.io/badge/AI-Gemini%202.5%20Flash-8E75B2?logo=googlegemini)

</div>

---

## Table of Contents

- [The Problem](#the-problem)
- [The Solution](#the-solution)
- [Demo](#demo)
- [Key Features](#key-features)
- [How It Works](#how-it-works--the-reconflow-pipeline)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Roadmap](#roadmap)
- [Why ReconFlow](#why-reconflow)
- [Contributing](#contributing)
- [Team](#team)

---

## The Problem

Every business that takes payments through more than one channel — a bank account, Stripe, a payment gateway — ends up with two records of the truth: what the **bank** says happened, and what the **ledger** (QuickBooks, Tally, a spreadsheet) says happened. They rarely match perfectly.

For a startup or small finance team, closing the gap between them today usually means:

- An accountant scrolling between a bank CSV and a ledger export, matching rows by eye.
- Getting stuck on the same few discrepancies every month — a Stripe fee, an FX conversion, a cheque that cleared three days late — and re-deriving the explanation from scratch each time.
- No audit trail of *why* a transaction was marked as matched, which becomes a real problem the moment an investor, auditor, or tax authority asks.
- Hours of skilled finance time spent on pattern-matching instead of on decisions that actually need a human.

This doesn't scale, and it's exactly the kind of structured, rules-plus-judgment problem that's well suited to being automated — reliably, and with a clear paper trail.

## The Solution

**ReconFlow** is a reconciliation platform that ingests transactions from your bank statements, Stripe, and accounting ledger, and automatically works out which ones refer to the same real-world event.

It doesn't just pattern-match on amount and date. A deterministic multi-pass engine handles the matches that have one obvious right answer, and only the genuinely ambiguous cases — the ones a human would actually have to think about — are escalated to an AI reasoning layer that explains the discrepancy in plain English before it reaches an accountant's review queue.

The result: most transactions are matched and explained with no human involvement at all, and the ones that do need a person come with the reasoning already attached.

## Demo

<div align="center">

[![Watch the ReconFlow demo](https://img.youtube.com/vi/VmrsUTN3rNw/hqdefault.jpg)](https://youtu.be/VmrsUTN3rNw)

**▶ [https://youtu.be/VmrsUTN3rNw](https://youtu.be/VmrsUTN3rNw)** &nbsp;·&nbsp; **🔗 [https://recon-flow-flax.vercel.app](https://recon-flow-flax.vercel.app/)**

</div>

> If you're reviewing this repo ahead of a demo or pitch: the live link runs in demo mode with seeded data, so you can explore the dashboard, the matching engine output, and the AI reasoning panel without connecting a real bank or ledger account.

## Key Features

**Matching intelligence**
- **Multi-pass matching engine** — a deterministic 4-pass algorithm covering exact matches, bulk/subset-sum matches (one wire transfer paying several invoices), fuzzy matches, and exceptions, all in a single run.
- **Risk engine** — scores every match for auditability and flags high-risk patterns before they're auto-approved.
- **Fee formula library** — built-in knowledge of Stripe, PayPal, and bank wire fee structures, so a $12.50 gap doesn't have to be investigated manually if it's just a known processing fee.

**AI reasoning**
- **Gemini-powered explanations** — for every transaction that isn't a clean automatic match, Gemini 2.5 Flash explains *why* in plain English, and revises the confidence score based on that reasoning.
- **Round-robin key rotation** across up to 10 Gemini API keys, so large reconciliation runs don't get rate-limited.

**Integrations & ingestion**
- **QuickBooks Online** — OAuth 2.0 integration pulling live invoice data directly from QBO.
- **Stripe** — OAuth connection pulling payout and fee data, which is what makes Stripe fee discrepancies explainable rather than mysterious.
- **Flexible file ingestion** — bank CSV/Excel, Tally exports, or QuickBooks CSV, with an intelligent schema-mapping wizard that learns your column layout once and reuses it.
- **FX rate sync** — background job syncing exchange rates, enabling precise cross-currency reconciliation.

**Trust & operations**
- **Audit logs** — every match decision (approval, rejection, AI reasoning) is recorded, so the process is defensible to an auditor or investor.
- **Human review queue** — anything the system isn't confident about goes to an accountant, with the AI's best guess and reasoning already attached.
- **Enterprise-grade data layer** — Amazon Aurora PostgreSQL (Serverless v2) via Drizzle ORM.
- **Fast, modern UI** — Next.js App Router, virtualized tables for large datasets, and Google/credential sign-in via NextAuth.js (Auth.js v5).

## How It Works — The ReconFlow Pipeline

Every reconciliation run moves through the same seven phases, from raw ingestion to a fully explained, human-reviewable result.

```mermaid
flowchart TD
    %% Phase 1
    subgraph Phase 1: Ingestion
        A[File Upload CSV/Excel] --> Ingest[Ingestion Service]
        B[QuickBooks API] --> Ingest
        C[Stripe API] --> Ingest
    end

    %% Phase 2
    subgraph Phase 2: Cleaning
        Ingest --> Clean[Cleaning Service]
        Clean --> Dup[Remove Exact Duplicates]
        Clean --> Normal[Normalize Date, Amount, Currency]
        Clean --> Suffix[Strip Suffixes & Punctuation]
    end

    %% Phase 3
    subgraph Phase 3: Schema Mapper
        Dup & Normal & Suffix --> Mapper[Universal Schema Mapper]
        Mapper --> Template{Template Match?}
        Template -- No --> Prompt[User Manual Mapping] --> Save[Save Mapping Template]
        Template -- Yes --> Schema[Save to canonical_transactions]
        Save --> Schema
    end

    %% Phase 4
    subgraph Phase 4: Matching Engine
        Schema --> Engine[4-Pass Matching Engine]
        Engine --> P1[Pass 1: Exact Match]
        Engine --> P2[Pass 2: Bulk / Subset-Sum]
        Engine --> P3[Pass 3: Fuzzy Match]
        Engine --> P4[Pass 4: Exceptions]
    end

    %% Phase 5
    subgraph Phase 5: Discrepancy Classification
        P2 & P3 --> Classify[Discrepancy Classifier]
        Classify --> Tags[Timing / Partial / Typos / FX / Fees]
    end

    %% Phase 6
    subgraph Phase 6: AI Reasoning Layer
        P4 & Tags --> Gemini[Gemini 2.5 Flash Reasoner]
        Gemini --> Expl[Plain English Explanation & Adjusted Confidence]
    end

    %% Phase 7
    subgraph Phase 7: Human Review Queue
        P1 --> Auto[Auto-Approved: High Score 80-100]
        Expl --> Check{Revised Score}
        Check -- >= 80 --> Auto
        Check -- 50-79 --> Med[Accountant Consent Queue]
        Check -- < 50 --> Manual[Full Manual Link Queue]
    end
```

<details>
<summary><strong>Phase-by-phase breakdown</strong> (click to expand)</summary>

<br>

**Phase 1 — Data Ingestion**
Three data source paths feed into the pipeline: file uploads (bank CSV/Excel, QuickBooks or Tally exports) through `file-ingestion-wizard.tsx`, live QuickBooks Online data via OAuth, and live Stripe payout/fee data via OAuth — critical for explaining the small amount discrepancies Stripe fees cause.

**Phase 2 — Data Cleaning**
`cleaning.service.ts` removes exact duplicate rows, flags rows with missing critical fields, normalizes dates to ISO 8601 and currencies to ISO 4217, strips stray characters from vendor names and references, and flags obvious anomalies (negative amounts, future dates) for review.

**Phase 3 — Universal Schema Mapper**
QuickBooks, Tally, Stripe, and bank exports all use different column names. The mapper (`services/mapping/`) converts everything into one internal schema — `transaction_id`, `date`, `amount`, `currency`, `vendor_name`, `reference_number`, `transaction_type`, `source`, `raw_source`. New sources are auto-detected by column similarity, or mapped once manually and saved as a reusable template.

**Phase 4 — Matching Engine**
The core (`core/matching/engine.ts`) runs four sequential passes: **exact match** (same amount to the cent, date within 1 day, reference match if available — auto-approved at 95–100 confidence), **bulk/subset-sum match** (one bank transaction against a combination of 2–5 ledger entries via a subset-sum algorithm, for wires that pay several invoices at once), **fuzzy match** (a composite score from amount similarity, date proximity, Jaccard text similarity on vendor names, and FX-adjusted amounts), and **exceptions** (anything below threshold, routed onward). The **Risk Engine** (`riskEngine.ts`) and **Fee Formula Library** (`feeFormulas.ts`) augment every score with known fee rates and risk signals.

**Phase 5 — Discrepancy Classification**
`classifier.ts` tags every fuzzy or bulk match: timing difference, partial payment, missing entry, typo in reference/vendor name, FX rate movement, or hidden processing fee.

**Phase 6 — AI Reasoning Layer**
Only unmatched or low/medium-confidence transactions reach Gemini 2.5 Flash (`lib/ai-reason.ts`, `services/intelligence.service.ts`). It receives the bank transaction, the closest ledger candidate(s), the confidence score, the discrepancy tag, and relevant context (e.g. a Stripe fee rate), and returns a plain-English explanation, a revised confidence score, and a review recommendation. Up to 10 Gemini API keys can be configured for round-robin rotation to avoid rate limits on large runs.

**Phase 7 — Human Review Queue**
High-confidence matches (80–100) are auto-approved. Medium-confidence matches (50–79) go to the accountant for one-click approval, with the bank transaction, the candidate ledger match, the confidence score, the discrepancy type, and the AI's reasoning all shown together. Low-confidence or unmatched transactions (below 50) go to full manual review, where the accountant sees the AI's best guess and all nearby candidates and can manually link or create a new entry.

</details>

## Tech Stack

| Category | Technology |
| :--- | :--- |
| **Framework** | Next.js 15.4 (App Router) |
| **Language** | TypeScript 5.9 |
| **Styling** | Tailwind CSS 4, ShadCN UI, Lucide Icons |
| **Animation** | Motion (Framer Motion) |
| **Database** | Amazon Aurora PostgreSQL (Serverless v2) |
| **ORM** | Drizzle ORM + Drizzle Kit |
| **Authentication** | NextAuth.js v5 (Auth.js) — Google OAuth + Credentials |
| **AI/ML** | `@google/genai` (Gemini 2.5 Flash) with round-robin key rotation |
| **PDF Export** | `@react-pdf/renderer`, `jspdf` |
| **Table Virtualization** | `@tanstack/react-virtual` |
| **Integrations** | `intuit-oauth` (QuickBooks Online), `stripe` SDK |
| **File Parsing** | `csv-parse`, `csv-parser`, `exceljs`, `xlsx` |
| **Testing** | Jest + `ts-jest` |

## Project Structure

<details>
<summary><strong>Full directory layout</strong> (click to expand)</summary>

```text
reconflow/
├── app/                          # Next.js App Router — Pages & API routes
│   ├── api/                      # Backend API endpoints
│   │   ├── audit-logs/           # Fetch audit trail for match decisions
│   │   ├── auth/                 # NextAuth.js authentication routes
│   │   ├── exceptions/           # Fetch and resolve reconciliation exceptions
│   │   ├── matches/              # Matching engine actions (approve, reject, bulk-approve)
│   │   ├── onboard/               # Organization onboarding initialization
│   │   ├── qbo/                  # QuickBooks Online OAuth, callbacks, and syncing
│   │   ├── recon/                # Triggers for the reconciliation engine and match counts
│   │   ├── reports/               # Dashboard analytics and summary reporting
│   │   ├── seed/                 # Demo data seeding for testing
│   │   ├── settings/              # User settings (delete account, reset data)
│   │   ├── stripe/                # Stripe OAuth, callbacks, and data syncing
│   │   ├── transactions/          # Raw transaction fetch endpoints
│   │   └── upload/                # File ingestion (CSV/Excel uploads and history)
│   ├── connect/                   # UI Page: Integration setup (Stripe, QuickBooks, File Uploads)
│   ├── dashboard/                 # UI Page: Main reconciliation overview and metrics
│   ├── exceptions/                # UI Page: Management of unmatched transactions
│   ├── onboarding/                # UI Page: Initial user setup flow
│   ├── reports/                   # UI Page: Financial analytics and health scores
│   ├── settings/                  # UI Page: App configuration
│   └── sign-in/                   # UI Page: Authentication and login
│
├── components/                    # React UI components (presentation layer)
│   ├── app-shell.tsx              # Main layout wrapper (sidebar + top navigation)
│   ├── auth-modal.tsx             # Authentication modal (sign-in/sign-up)
│   ├── demo-banner.tsx            # Demo mode banner
│   ├── empty-dashboard-state.tsx  # Empty state for first-time users
│   ├── evidence-panel/            # Side panel showing match evidence & Gemini AI reasoning
│   ├── file-ingestion-wizard.tsx  # Step-by-step file upload and column mapping wizard
│   ├── landing-page.tsx           # Public-facing marketing landing page
│   ├── new-run-modal/             # Modal to trigger a new reconciliation run
│   ├── skeletons/                 # Loading skeleton components
│   ├── ui/                        # ShadCN base components (buttons, dialogs, inputs, tables)
│   └── virtual-match-table.tsx    # Virtualized table for large transaction datasets
│
├── core/                          # Core database and engine logic
│   ├── db/
│   │   ├── index.ts               # Drizzle DB connection (Aurora PostgreSQL via pg driver)
│   │   ├── schema.ts              # Drizzle schema definitions (all tables)
│   │   ├── org-helper.ts          # Multi-tenant organization context helpers
│   │   ├── types.ts               # DB-level TypeScript types inferred from schema
│   │   └── migrations/            # SQL migration files generated by Drizzle Kit
│   ├── matching/
│   │   ├── engine.ts              # The deterministic 4-pass reconciliation algorithm
│   │   ├── classifier.ts          # Discrepancy tagging (fees, FX, timing, partial)
│   │   ├── candidateGenerator.ts  # Generates candidate matches for the fuzzy pass
│   │   ├── feeFormulas.ts         # Known fee rate formulas (Stripe, PayPal, wire)
│   │   ├── matchingHelpers.ts     # Shared scoring utilities
│   │   └── riskEngine.ts          # Risk scoring for individual matches
│   ├── utils/
│   │   └── dateUtils.ts           # Shared date utility functions
│   └── env.ts                     # Environment variable validation (fail-fast at startup)
│
├── services/                      # Business logic & data decoupling layer
│   ├── cleaning.service.ts        # Normalization & sanitation (dates, amounts, currencies)
│   ├── exceptions.service.ts      # Handles unmatched rows and the review queue
│   ├── fx-sync.job.ts             # Background job for syncing foreign exchange rates
│   ├── ingestion.service.ts       # Data ingestion manager (coordinates parsers and db)
│   ├── intelligence.service.ts    # Coordination with Gemini AI for match explanations
│   ├── matches.service.ts         # Database operations for confirmed/pending matches
│   ├── qbo.service.ts             # QuickBooks API interaction layer
│   ├── recon.service.ts           # Orchestrator for the full matching engine workflow
│   ├── reports.service.ts         # Aggregation and analytics queries for the reports page
│   ├── settings.service.ts        # Account and organization settings operations
│   ├── stripe.service.ts          # Stripe API interaction layer
│   ├── connectors/                # Abstract connector interfaces for data sources
│   ├── mapping/                   # Column heuristic detection & mapping template matcher
│   └── parsers/                   # Extractors for CSV, Excel, and Tally formats
│
├── lib/                           # Shared utilities & helpers
│   ├── ai-reason.ts               # Gemini prompt generation and JSON parsing logic
│   ├── api-client.ts              # Typed wrapper for frontend API calls
│   ├── data-context.tsx           # React context for global data state
│   ├── data.ts                    # Static reference data
│   ├── fx-math.ts                 # Precision math for foreign exchange calculations
│   ├── llm-provider.ts            # LLM provider abstraction (Gemini, round-robin key rotation)
│   ├── prompt-context.ts          # Prompt context builders for Gemini calls
│   ├── render-explanation.ts      # Formats AI explanations for display
│   ├── toast.ts                   # Toast notification helpers
│   └── utils.ts                   # Shared Tailwind and string utility functions
│
├── scripts/                       # Standalone CLI tools and migration scripts
│   ├── seed-stripe-test.ts        # Database fixture script for local testing
│   ├── seed-enrichment.ts         # Enrichment data seeding script
│   ├── reset-db.ts                # Resets all database tables (dev only)
│   ├── migration-phase7.ts        # Data migration: Phase 7 schema changes
│   ├── migration-phase8.ts        # Data migration: Phase 8 schema changes
│   ├── migration-add-password-and-onboarded.ts  # Adds password & onboarding fields
│   └── migration-f13-constraint.ts              # Constraint migration for F-13
│
├── types/                         # TypeScript type definitions
│   ├── match.ts                   # Strong typing for match results and confidence bands
│   └── next-auth.d.ts             # NextAuth session type augmentation
│
├── auth.ts                        # NextAuth.js configuration (providers, callbacks, adapter)
├── auth.config.ts                 # Auth config (edge-compatible, used in middleware)
├── middleware.ts                  # Next.js middleware for route protection
├── drizzle.config.ts              # Drizzle Kit configuration (Aurora SSL auto-detection)
├── package.json                   # Node dependencies and NPM scripts
└── README.md                      # This documentation file
```

</details>

## Getting Started

### Prerequisites
- Node.js 18+
- A PostgreSQL database (local, Docker, or managed like **AWS Aurora PostgreSQL Serverless v2** or Neon)

### 1. Clone & Install
```bash
git clone https://github.com/your-username/reconflow.git
cd reconflow
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
```

```env
# ── Database ─────────────────────────────────────────────────────────────────
# Aurora PostgreSQL (Serverless v2) or any PostgreSQL-compatible database
DATABASE_URL="postgresql://username:password@host:5432/dbname"

# ── AI / Gemini ──────────────────────────────────────────────────────────────
# Required. Add GEMINI_API_KEY_2, GEMINI_API_KEY_3, etc. for round-robin
# key rotation to avoid rate limits on large reconciliation runs.
GEMINI_API_KEY="your_gemini_api_key_here"
GEMINI_API_KEY_2="your_second_gemini_api_key_here"   # optional

# ── FX Rates ─────────────────────────────────────────────────────────────────
# Optional. Falls back to open.er-api.com if not provided.
EXCHANGERATE_HOST_API_KEY="your_exchangerate_host_api_key_here"

# ── Authentication ────────────────────────────────────────────────────────────
NEXTAUTH_SECRET="any_random_32_character_string"
NEXTAUTH_URL="http://localhost:3000"
GOOGLE_CLIENT_ID="your_google_client_id_here"
GOOGLE_CLIENT_SECRET="your_google_client_secret_here"

# ── Stripe ────────────────────────────────────────────────────────────────────
STRIPE_PUBLISHABLE_KEY="pk_test_..."
STRIPE_SECRET_KEY="sk_test_..."

# ── QuickBooks Online ─────────────────────────────────────────────────────────
QBO_CLIENT_ID="your_qbo_client_id_here"
QBO_CLIENT_SECRET="your_qbo_client_secret_here"
QBO_REALM_ID="your_qbo_realm_id_here"
QBO_ENVIRONMENT="sandbox"
```

### 3. Set Up the Database
```bash
npx drizzle-kit push
```
> **AWS Aurora note:** `drizzle.config.ts` automatically detects Aurora endpoints (`.rds.amazonaws.com`) and configures the SSL connection with `rejectUnauthorized: false`.

Optionally seed curated demo data to test the matching engine without connecting live accounts:
```bash
npx tsx scripts/seed-stripe-test.ts
```

### 4. Run It
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000).

### Available Scripts

| Script | Command | Description |
| :--- | :--- | :--- |
| Dev Server | `npm run dev` | Starts Next.js in development mode |
| Lint | `npm run lint` | Runs ESLint across the project |
| Full Audit | `npm run full-audit` | Runs the comprehensive engine audit suite |
| DB Reset | `npm run db:reset` | Drops and re-creates all tables (dev only) |
| Schema Push | `npx drizzle-kit push` | Syncs Drizzle schema to the database |
| Migrate | `npx drizzle-kit migrate` | Runs pending Drizzle migrations |

## Roadmap

Directions being explored for future versions:

- [ ] Direct Tally integration (beyond CSV/Excel export) for real-time sync
- [ ] Additional payment gateway connectors (Razorpay, PayPal, wire APIs)
- [ ] A confidence-tuning dashboard so teams can adjust auto-approval thresholds per organization
- [ ] Scheduled/recurring reconciliation runs, not just on-demand
- [ ] Exportable audit-ready reconciliation reports (PDF/CSV) for auditors and investors
- [ ] Role-based access control for larger finance teams

## Why ReconFlow

- **Explains, not just matches.** Most reconciliation tools stop at "matched" or "unmatched." ReconFlow tells you *why* — in plain English — which is what actually saves an accountant's time.
- **Deterministic first, AI second.** The matching engine handles clear-cut cases with a transparent, auditable algorithm. AI is reserved for genuine ambiguity, not used as a black box for everything.
- **Built for the tools SMEs already use.** Native support for Tally and QuickBooks alongside Stripe and raw bank exports, rather than assuming everyone is already on a single accounting platform.
- **Audit-first design.** Every decision — automatic or human — is logged, which matters the moment a reconciliation process needs to survive investor or auditor scrutiny.

## Contributing

Issues and pull requests are welcome. If you're proposing a significant change, please open an issue first to discuss what you'd like to change.

## Team

- **Aditya Jain**
- **Rachit Bhatia**
- **Nisarg Gandhi**
