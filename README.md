# ReconFlow

**AI-powered bank reconciliation for startups and SMEs.**

ReconFlow is a modern, automated financial reconciliation platform that bridges the gap between your bank statements (like Stripe payouts or bank NEFTs) and your accounting ledger (like QuickBooks). It automatically matches transactions, explains discrepancies using AI, and provides a clear, actionable dashboard for your finance team.

---

## 🚀 Key Features

*   **Multi-Pass Matching Engine:** A deterministic algorithm that handles exact matches, fuzzy matches (date/amount discrepancies), and complex bulk/many-to-one matches (e.g., multiple invoices paid in a single wire transfer).
*   **AI-Powered Reasoning:** Integrates with Google's Gemini AI to explain *why* transactions matched (or didn't) in plain English. For example, it can detect if a discrepancy is due to a Stripe fee or an FX conversion.
*   **QuickBooks Integration:** Seamless OAuth 2.0 integration to pull live invoice data directly from QuickBooks Online into the reconciliation engine.
*   **Beautiful, High-Performance UI:** Built with Next.js App Router and Tailwind CSS, featuring virtualized tables for large datasets, dark-mode glassmorphic aesthetics, and responsive design.
*   **Enterprise-Grade Database:** Backed by Amazon Aurora PostgreSQL via Drizzle ORM for robust, scalable data persistence.

---

## 🧠 The ReconFlow Pipeline

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
        P4 & Tags --> Gemini[Gemini AI Reasoner]
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
You have three data sources:
*   **File Upload** — user uploads bank CSV/Excel, QuickBooks CSV/Excel, or Tally Excel/CSV directly through the UI.
*   **QuickBooks API** — user has OAuth-connected their QBO account, so you pull live invoice and transaction data via the QBO REST API on demand.
*   **Stripe API** — user connects their Stripe account, you pull payout and fee data via Stripe's API. This is especially important for reconciling Stripe's processing fees which cause small amount discrepancies.

#### **Phase 2 — Data Cleaning**
Before anything else, you run all ingested data through a cleaning layer:
*   Remove exact duplicate rows (same amount, date, reference).
*   Handle missing values — flag rows where critical fields like amount or date are null.
*   Normalize formats — dates to ISO 8601, amounts to a standard decimal format, currency codes to ISO 4217.
*   Strip whitespace, special characters from vendor names and reference numbers.
*   Flag rows with obvious anomalies (negative amounts where unexpected, future dates, etc.) for review.

#### **Phase 3 — Universal Schema Mapper**
This is your normalization layer. Every source — QBO, Tally, Stripe, bank — has its own column names and terminology. Your mapper converts everything into one internal schema.

Your internal schema has fields like: `transaction_id`, `date`, `amount`, `currency`, `vendor_name`, `reference_number`, `transaction_type` (debit/credit), `source` (bank/ledger), `raw_source` (QBO/Tally/Stripe/CSV).

The mapper works with a config file per source type, something like: QBO calls it "TxnDate", Tally calls it "Voucher Date", your schema calls it "date" — the mapper handles that translation. For new or unknown sources, you either auto-detect via column name similarity or prompt the user to map columns manually once, then save that mapping for future uploads.

#### **Phase 4 — Matching Engine**
This is the core. You run a sequential multi-pass engine:
*   **Pass 1 — Exact Match:** Same amount (to the cent) and date within 1 day, plus reference number match if available. Auto-approved, high confidence score (95–100).
*   **Pass 2 — Bulk / Subset-Sum Match:** One bank transaction matches a combination of 2–5 ledger entries that sum to the same amount within a 5-day window. You use a subset-sum algorithm here. This handles things like multiple invoices paid in a single wire transfer.
*   **Pass 3 — Fuzzy Match:** For everything that didn't match in passes 1 and 2, you compute a composite confidence score:
    *   *Amount similarity* — small differences are acceptable. Within 0.5% is fine, within 5% is acceptable with a note, above 20% is rejected. The difference in amount is flagged for the AI layer to reason about (could be a fee, FX rate, partial payment).
    *   *Date proximity* — within 3 days is normal, up to 7 days is acceptable with lower score, beyond that gets penalized heavily.
    *   *Text similarity* — Jaccard similarity on vendor name tokens, plus exact match on any invoice/reference number substrings.
    *   *Currency handling* — if currencies differ, pull the exchange rate for that date and apply it before comparing amounts.
*   **Pass 4 — Exceptions:** Anything that scores below your minimum threshold (say, below 40) gets flagged as unmatched and goes to the AI layer and human review queue.

#### **Phase 5 — Discrepancy Classification**
Every match (fuzzy or bulk) gets tagged with one or more discrepancy categories:
*   **Timing difference** — the amount matches perfectly but the date is off by several days (e.g., cheque clearing delay).
*   **Partial payment** — bank received less than the invoice amount, no obvious fee explanation.
*   **Missing entry** — a bank transaction has no corresponding ledger entry at all (or vice versa).
*   **Typo** — reference number or vendor name is slightly off (e.g., "INV-1023" vs "INV-1032").
*   **Foreign exchange rate** — amount difference is proportional to an FX rate movement on that date.
*   **Hidden processing fee** — amount difference exactly or approximately matches a known fee percentage (Stripe's 2.9% + 30¢, PayPal's fee, bank wire charges).

#### **Phase 6 — AI Reasoning Layer**
Only transactions that are unmatched or have a low/medium confidence score get sent to Gemini. You don't want to waste tokens on exact matches.

You send Gemini the bank transaction, the closest candidate ledger entry or entries, the confidence score, the discrepancy type tag, and contextual info like whether Stripe is connected and what its fee rate is.

Gemini returns a plain-English explanation of the likely reason, a revised confidence assessment, and whether human review is needed.

Example output: *"This $487.50 bank deposit likely corresponds to invoice INV-2041 for $500. The $12.50 difference matches Stripe's standard processing fee of 2.5%. Recommend auto-approving with a Stripe fee tag."*

#### **Phase 7 — Human Review Queue**
Based on confidence score:
*   **High score (80–100)** — auto-approved, shown in dashboard as matched.
*   **Medium score (50–79)** — presented to the accountant for approval. They see both the bank transaction and the ledger match, the confidence score, the discrepancy type, and the AI's reasoning. One-click approve or reject.
*   **Low score or unmatched (below 50)** — full manual review required. Accountant sees the AI's best guess, all nearby candidates, and can manually link or create a new entry.

---

## 🛠️ Tech Stack

| Category | Technology |
| :--- | :--- |
| **Framework** | Next.js 15 (App Router) |
| **Language** | TypeScript |
| **Styling** | Tailwind CSS, ShadCN UI, Lucide Icons |
| **Database** | Amazon Aurora PostgreSQL (Serverless) |
| **ORM** | Drizzle ORM |
| **Authentication**| NextAuth.js (Auth.js v5) |
| **AI/ML** | `@google/genai` (Gemini 2.5 Flash) |
| **Integrations** | `intuit-oauth` (QuickBooks), Stripe SDK |

---

## 📁 Project Structure

```text
reconflow/
├── app/                          # Next.js App Router — pages & API routes
│   ├── api/
│   │   ├── auth/                 # Auth.js handlers
│   │   ├── matches/              # GET all matches, POST approve/reject
│   │   ├── qbo/                  # QuickBooks OAuth & Sync endpoints
│   │   ├── stripe/               # Stripe OAuth & Sync endpoints
│   │   ├── upload/               # Ingestion file upload & preview endpoint
│   │   └── recon/run/            # POST — executes the reconciliation engine
│   ├── connect/                  # Integration setup (Stripe, QBO, CSV)
│   ├── dashboard/                # Main reconciliation dashboard
│   ├── exceptions/               # Exceptions management page
│   ├── reports/                  # Analytics and health scores
│   ├── settings/                 # App settings
│   └── sign-in/                  # Authentication page
│
├── components/                   # UI components (presentation layer)
│   ├── app-shell.tsx             # Navigation sidebar + top bar
│   ├── evidence-panel/           # Side panel showing match evidence & AI reasoning
│   ├── skeletons/                # Loading skeleton components
│   └── ui/                       # ShadCN base components (buttons, dialogs, etc.)
│
├── core/                         # Database and engine core logic
│   ├── db/
│   │   ├── index.ts              # DB connection config
│   │   ├── org-helper.ts         # Multi-tenant context helpers
│   │   └── schema.ts             # Drizzle schema (organizations, connectors, canonicalTransactions, matches, templates)
│   └── matching/
│       └── engine.ts             # The 4-pass reconciliation algorithm
│
├── services/                     # Business logic & Data decoupling layer
│   ├── ingestion.service.ts      # Data ingestion manager
│   ├── cleaning.service.ts       # Normalization & sanitation layer
│   ├── recon.service.ts          # Reconciliation metrics & workflow runner
│   ├── parsers/                  # CSV & Excel parsing services
│   └── mapping/                  # Column heuristic detection & mapping template matcher
│
├── lib/                          # Utilities & Helpers
│   ├── ai-reason.ts              # Gemini prompt generation and JSON parsing
│   ├── data-context.tsx          # App-wide React context for demo vs live mode
│   └── utils.ts                  # Shared utility functions
│
├── scripts/
│   └── seed-stripe-test.ts       # Database fixture script for local testing
│
└── drizzle.config.ts             # Drizzle Kit config
```

*(Note: AI Agent specific files and configurations have been intentionally excluded from this tree).*

---

## 💻 Local Development Setup

### 1. Prerequisites
*   Node.js 18+
*   A PostgreSQL database instance (local, Docker, or managed like AWS Aurora/Neon)

### 2. Installation
```bash
git clone https://github.com/your-username/reconflow.git
cd reconflow
npm install
```

### 3. Environment Configuration
Create a `.env` file in the root directory:
```env
# Database
DATABASE_URL=postgres://user:password@host:5432/reconflow

# Authentication
AUTH_SECRET=generate-a-secure-random-string

# AI Integration
GEMINI_API_KEY=your-gemini-api-key

# QuickBooks Integration (Sandbox or Production)
QBO_CLIENT_ID=your-qbo-client-id
QBO_CLIENT_SECRET=your-qbo-client-secret
QBO_ENVIRONMENT=sandbox
```

### 4. Database Setup
Push the Drizzle schema to your database:
```bash
npx drizzle-kit push
```

*(Optional)* Seed the database with curated demo data to test the matching engine without connecting live accounts:
```bash
npx tsx scripts/seed-stripe-test.ts
```

### 5. Run the Application
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

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
