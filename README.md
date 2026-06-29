# ReconFlow

**AI-powered bank reconciliation for startups and SMEs.**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-recon--flow--flax.vercel.app-black?style=for-the-badge&logo=vercel)](https://recon-flow-flax.vercel.app/)

ReconFlow is a modern, automated financial reconciliation platform that bridges the gap between your bank statements (Stripe payouts, bank NEFTs, CSV exports) and your accounting ledger (QuickBooks Online, Tally). It automatically matches transactions, classifies discrepancies, explains anomalies using Gemini AI, and provides a clean, actionable dashboard for your finance team.

---

## 🚀 Key Features

*   **Multi-Pass Matching Engine:** A deterministic 4-pass algorithm that handles exact matches, bulk/subset-sum matches, fuzzy matches, and flags exceptions — all in a single reconciliation run.
*   **AI-Powered Reasoning:** Uses Google Gemini 2.5 Flash with round-robin API key rotation to explain *why* transactions matched (or didn't) in plain English. Detects Stripe fees, FX conversions, timing gaps, and more.
*   **Risk Engine:** A dedicated risk scoring layer (`riskEngine.ts`) that scores each match for auditability and flags high-risk patterns.
*   **Fee Formula Library:** Built-in knowledge of Stripe, PayPal, and bank wire fee structures to automatically explain amount discrepancies.
*   **QuickBooks Integration:** OAuth 2.0 integration to pull live invoice data directly from QuickBooks Online.
*   **Stripe Integration:** OAuth connection to pull payout and fee data from Stripe, critical for reconciling processing fees.
*   **Flexible File Ingestion:** Upload bank CSV/Excel, Tally exports, or QuickBooks CSV with an intelligent schema-mapping wizard.
*   **FX Rate Sync:** Background job that syncs foreign exchange rates, enabling cross-currency reconciliation with precision math.
*   **Audit Logs:** All match decisions — approvals, rejections, and AI reasoning — are recorded in an audit trail.
*   **Beautiful, High-Performance UI:** Next.js App Router with virtualized tables for large datasets, dark-mode glassmorphic aesthetics, and a full landing page.
*   **Enterprise-Grade Database:** Amazon Aurora PostgreSQL (Serverless v2) via Drizzle ORM for robust, scalable data persistence.
*   **Google Sign-In:** NextAuth.js (Auth.js v5) with Google OAuth and credential-based authentication.

---

## 🧠 The ReconFlow Pipeline.

ReconFlow processes, cleans, normalizes, and reconciles your financial transactions using a robust 7-Phase pipeline.

### Pipeline Flowchart

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

---

### Pipeline Phase Details

#### **Phase 1 — Data Ingestion**
Three data source paths:
*   **File Upload** — User uploads bank CSV/Excel, QuickBooks CSV/Excel, or Tally Excel/CSV directly through the UI (`file-ingestion-wizard.tsx`). Parsers handle format detection and extraction.
*   **QuickBooks API** — OAuth-connected QBO account pulls live invoice and transaction data via the QBO REST API on demand.
*   **Stripe API** — Connected Stripe account pulls payout and fee data. Critical for reconciling Stripe processing fees that cause small amount discrepancies.

#### **Phase 2 — Data Cleaning**
All ingested data runs through `cleaning.service.ts`:
*   Remove exact duplicate rows (same amount, date, reference).
*   Handle missing values — flag rows where critical fields like amount or date are null.
*   Normalize formats — dates to ISO 8601, amounts to a standard decimal format, currency codes to ISO 4217.
*   Strip whitespace and special characters from vendor names and reference numbers.
*   Flag rows with obvious anomalies (negative amounts where unexpected, future dates) for review.

#### **Phase 3 — Universal Schema Mapper**
Every source — QBO, Tally, Stripe, bank — has its own column names. The mapper (`services/mapping/`) converts everything into one internal schema with fields: `transaction_id`, `date`, `amount`, `currency`, `vendor_name`, `reference_number`, `transaction_type` (debit/credit), `source` (bank/ledger), `raw_source` (QBO/Tally/Stripe/CSV).

For new or unknown sources, the wizard auto-detects via column name similarity or prompts the user to map columns manually once, then saves that mapping template for future uploads.

#### **Phase 4 — Matching Engine**
The core (`core/matching/engine.ts`) runs a sequential 4-pass algorithm:
*   **Pass 1 — Exact Match:** Same amount (to the cent) and date within 1 day, plus reference number match if available. Auto-approved, high confidence score (95–100).
*   **Pass 2 — Bulk / Subset-Sum Match:** One bank transaction matches a combination of 2–5 ledger entries that sum to the same amount within a 5-day window. Uses a subset-sum algorithm to handle multiple invoices paid in a single wire transfer.
*   **Pass 3 — Fuzzy Match:** Composite confidence score based on amount similarity, date proximity, text similarity (Jaccard on vendor name tokens), and FX-adjusted amounts.
*   **Pass 4 — Exceptions:** Anything scoring below the minimum threshold is flagged as unmatched and routed to the AI layer and human review queue.

A dedicated **Risk Engine** (`riskEngine.ts`) and **Fee Formula Library** (`feeFormulas.ts`) augment match scoring with known fee rates (Stripe 2.9% + 30¢, etc.) and risk signals.

#### **Phase 5 — Discrepancy Classification**
Every fuzzy or bulk match gets tagged by `classifier.ts` with one or more categories:
*   **Timing difference** — amount matches perfectly but date is off (e.g., cheque clearing delay).
*   **Partial payment** — bank received less than the invoice amount.
*   **Missing entry** — a bank transaction has no corresponding ledger entry (or vice versa).
*   **Typo** — reference number or vendor name is slightly off (e.g., "INV-1023" vs "INV-1032").
*   **Foreign exchange rate** — amount difference is proportional to an FX rate movement on that date.
*   **Hidden processing fee** — amount difference matches a known fee percentage.

#### **Phase 6 — AI Reasoning Layer**
Only unmatched or low/medium confidence transactions are sent to Gemini 2.5 Flash (`lib/ai-reason.ts`, `services/intelligence.service.ts`). The system sends: the bank transaction, the closest candidate ledger entry/entries, the confidence score, the discrepancy type tag, and contextual info (e.g., Stripe fee rate).

Gemini returns a plain-English explanation, a revised confidence assessment, and a human-review recommendation.

*Example output: "This $487.50 bank deposit likely corresponds to invoice INV-2041 for $500. The $12.50 difference matches Stripe's standard processing fee of 2.5%. Recommend auto-approving with a Stripe fee tag."*

Supports **round-robin key rotation** across up to 10 Gemini API keys (`GEMINI_API_KEY`, `GEMINI_API_KEY_2`, … `GEMINI_API_KEY_10`) to avoid rate limits on large reconciliation runs.

#### **Phase 7 — Human Review Queue**
Based on confidence score:
*   **High score (80–100)** — auto-approved, shown in dashboard as matched.
*   **Medium score (50–79)** — presented to the accountant for one-click approval. Shows both the bank transaction and the ledger match, confidence score, discrepancy type, and AI reasoning.
*   **Low score / unmatched (below 50)** — full manual review. Accountant sees the AI's best guess, all nearby candidates, and can manually link or create a new entry.

---

## 🛠️ Tech Stack

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

---

## 📁 Project Structure

```text
reconflow/
├── app/                          # Next.js App Router — Pages & API routes
│   ├── api/                      # Backend API endpoints
│   │   ├── audit-logs/           # Fetch audit trail for match decisions
│   │   ├── auth/                 # NextAuth.js authentication routes
│   │   ├── exceptions/           # Fetch and resolve reconciliation exceptions
│   │   ├── matches/              # Matching engine actions (approve, reject, bulk-approve)
│   │   ├── onboard/              # Organization onboarding initialization
│   │   ├── qbo/                  # QuickBooks Online OAuth, callbacks, and syncing
│   │   ├── recon/                # Triggers for the reconciliation engine and match counts
│   │   ├── reports/              # Dashboard analytics and summary reporting
│   │   ├── seed/                 # Demo data seeding for testing
│   │   ├── settings/             # User settings (delete account, reset data)
│   │   ├── stripe/               # Stripe OAuth, callbacks, and data syncing
│   │   ├── transactions/         # Raw transaction fetch endpoints
│   │   └── upload/               # File ingestion (CSV/Excel uploads and history)
│   ├── connect/                  # UI Page: Integration setup (Stripe, QuickBooks, File Uploads)
│   ├── dashboard/                # UI Page: Main reconciliation overview and metrics
│   ├── exceptions/               # UI Page: Management of unmatched transactions
│   ├── onboarding/               # UI Page: Initial user setup flow
│   ├── reports/                  # UI Page: Financial analytics and health scores
│   ├── settings/                 # UI Page: App configuration
│   └── sign-in/                  # UI Page: Authentication and login
│
├── components/                   # React UI components (presentation layer)
│   ├── app-shell.tsx             # Main layout wrapper (sidebar + top navigation)
│   ├── auth-modal.tsx            # Authentication modal (sign-in/sign-up)
│   ├── demo-banner.tsx           # Demo mode banner
│   ├── empty-dashboard-state.tsx # Empty state for first-time users
│   ├── evidence-panel/           # Side panel showing match evidence & Gemini AI reasoning
│   ├── file-ingestion-wizard.tsx # Step-by-step file upload and column mapping wizard
│   ├── landing-page.tsx          # Public-facing marketing landing page
│   ├── new-run-modal/            # Modal to trigger a new reconciliation run
│   ├── skeletons/                # Loading skeleton components
│   ├── ui/                       # ShadCN base components (buttons, dialogs, inputs, tables)
│   └── virtual-match-table.tsx   # Virtualized table for large transaction datasets
│
├── core/                         # Core database and engine logic
│   ├── db/
│   │   ├── index.ts              # Drizzle DB connection (Aurora PostgreSQL via pg driver)
│   │   ├── schema.ts             # Drizzle schema definitions (all tables)
│   │   ├── org-helper.ts         # Multi-tenant organization context helpers
│   │   ├── types.ts              # DB-level TypeScript types inferred from schema
│   │   └── migrations/           # SQL migration files generated by Drizzle Kit
│   ├── matching/
│   │   ├── engine.ts             # The deterministic 4-pass reconciliation algorithm
│   │   ├── classifier.ts         # Discrepancy tagging (fees, FX, timing, partial)
│   │   ├── candidateGenerator.ts # Generates candidate matches for the fuzzy pass
│   │   ├── feeFormulas.ts        # Known fee rate formulas (Stripe, PayPal, wire)
│   │   ├── matchingHelpers.ts    # Shared scoring utilities
│   │   └── riskEngine.ts         # Risk scoring for individual matches
│   ├── utils/
│   │   └── dateUtils.ts          # Shared date utility functions
│   └── env.ts                    # Environment variable validation (fail-fast at startup)
│
├── services/                     # Business logic & data decoupling layer
│   ├── cleaning.service.ts       # Normalization & sanitation (dates, amounts, currencies)
│   ├── exceptions.service.ts     # Handles unmatched rows and the review queue
│   ├── fx-sync.job.ts            # Background job for syncing foreign exchange rates
│   ├── ingestion.service.ts      # Data ingestion manager (coordinates parsers and db)
│   ├── intelligence.service.ts   # Coordination with Gemini AI for match explanations
│   ├── matches.service.ts        # Database operations for confirmed/pending matches
│   ├── qbo.service.ts            # QuickBooks API interaction layer
│   ├── recon.service.ts          # Orchestrator for the full matching engine workflow
│   ├── reports.service.ts        # Aggregation and analytics queries for the reports page
│   ├── settings.service.ts       # Account and organization settings operations
│   ├── stripe.service.ts         # Stripe API interaction layer
│   ├── connectors/               # Abstract connector interfaces for data sources
│   ├── mapping/                  # Column heuristic detection & mapping template matcher
│   └── parsers/                  # Extractors for CSV, Excel, and Tally formats
│
├── lib/                          # Shared utilities & helpers
│   ├── ai-reason.ts              # Gemini prompt generation and JSON parsing logic
│   ├── api-client.ts             # Typed wrapper for frontend API calls
│   ├── data-context.tsx          # React context for global data state
│   ├── data.ts                   # Static reference data
│   ├── fx-math.ts                # Precision math for foreign exchange calculations
│   ├── llm-provider.ts           # LLM provider abstraction (Gemini, round-robin key rotation)
│   ├── prompt-context.ts         # Prompt context builders for Gemini calls
│   ├── render-explanation.ts     # Formats AI explanations for display
│   ├── toast.ts                  # Toast notification helpers
│   └── utils.ts                  # Shared Tailwind and string utility functions
│
├── scripts/                      # Standalone CLI tools and migration scripts
│   ├── seed-stripe-test.ts       # Database fixture script for local testing
│   ├── seed-enrichment.ts        # Enrichment data seeding script
│   ├── reset-db.ts               # Resets all database tables (dev only)
│   ├── migration-phase7.ts       # Data migration: Phase 7 schema changes
│   ├── migration-phase8.ts       # Data migration: Phase 8 schema changes
│   ├── migration-add-password-and-onboarded.ts  # Adds password & onboarding fields
│   └── migration-f13-constraint.ts              # Constraint migration for F-13
│
├── types/                        # TypeScript type definitions
│   ├── match.ts                  # Strong typing for match results and confidence bands
│   └── next-auth.d.ts            # NextAuth session type augmentation
│
├── auth.ts                       # NextAuth.js configuration (providers, callbacks, adapter)
├── auth.config.ts                # Auth config (edge-compatible, used in middleware)
├── middleware.ts                 # Next.js middleware for route protection
├── drizzle.config.ts             # Drizzle Kit configuration (Aurora SSL auto-detection)
├── package.json                  # Node dependencies and NPM scripts
└── README.md                     # This documentation file
```

---

## 💻 Local Development Setup

### 1. Prerequisites
*   Node.js 18+
*   A PostgreSQL database (local, Docker, or managed like **AWS Aurora PostgreSQL Serverless v2** or Neon)

### 2. Installation
```bash
git clone https://github.com/your-username/reconflow.git
cd reconflow
npm install
```

### 3. Environment Configuration
Copy the example file and fill in your values:
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

### 4. Database Setup
Push the Drizzle schema to your database:
```bash
npx drizzle-kit push
```

> **AWS Aurora note:** `drizzle.config.ts` automatically detects Aurora endpoints (`.rds.amazonaws.com`) and configures the SSL connection with `rejectUnauthorized: false`.

*(Optional)* Seed the database with curated demo data to test the matching engine without connecting live accounts:
```bash
npx tsx scripts/seed-stripe-test.ts
```

*(Optional)* Reset all tables in dev:
```bash
npm run db:reset
```

### 5. Run the Application
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 6. Available Scripts

| Script | Command | Description |
| :--- | :--- | :--- |
| Dev Server | `npm run dev` | Starts Next.js in development mode |
| Lint | `npm run lint` | Runs ESLint across the project |
| Full Audit | `npm run full-audit` | Runs the comprehensive engine audit suite |
| DB Reset | `npm run db:reset` | Drops and re-creates all tables (dev only) |
| Schema Push | `npx drizzle-kit push` | Syncs Drizzle schema to the database |
| Migrate | `npx drizzle-kit migrate` | Runs pending Drizzle migrations |

---

## 📄 License

MIT License

Copyright (c) 2026 ReconFlow Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
