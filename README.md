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

## 🧠 How the Reconciliation Engine Works

ReconFlow uses a sequential 4-pass engine to maximize automation while minimizing false positives:

1.  **Exact Match:** Looks for identical amounts and identical (or $\le 1$ day) dates. Auto-approved.
2.  **Bulk Match (Subset-Sum):** Identifies when 2 to 4 ledger entries sum up perfectly to a single bank deposit (within a 5-day window).
3.  **Fuzzy Match:** Calculates a combined confidence score based on:
    *   *Amount Similarity:* Smooth decay curve (rejects if $>20\%$ difference).
    *   *Date Proximity:* Decaying score up to 3 days difference.
    *   *Text Similarity:* Jaccard index on word tokens and exact overlaps of invoice reference numbers.
4.  **Exceptions:** Anything that fails passes 1-3 is flagged for manual review.

Following the deterministic engine, an **AI Reasoning Pass (Gemini)** evaluates any non-exact match to provide plain English explanations and tag discrepancies (e.g., "Stripe fee deducted").

---

## 📊 System Architecture & Workflows

### High-Level Architecture

```mermaid
graph TD
    Client[Web Client (Next.js)] --> API[Next.js API Routes]
    
    subgraph Backend Services
        API --> Engine[Reconciliation Engine]
        API --> Auth[NextAuth.js]
        API --> DBClient[Drizzle ORM]
    end
    
    subgraph External Systems
        Engine --> Gemini[Google Gemini AI]
        API --> QBO[QuickBooks API]
        API --> Stripe[Stripe API / CSV]
    end
    
    DBClient --> DB[(AWS Aurora PostgreSQL)]
```

### Reconciliation Workflow

```mermaid
sequenceDiagram
    participant User
    participant App
    participant Engine
    participant Gemini
    participant DB
    
    User->>App: Click "Run Reconciliation"
    App->>DB: Fetch unmatched Bank & Ledger rows
    App->>Engine: matchTransactions(banks, ledgers)
    
    rect rgb(20, 30, 40)
        Note over Engine: Pass 1: Exact Matches
        Note over Engine: Pass 2: Bulk (Subset-Sum) Matches
        Note over Engine: Pass 3: Fuzzy Matches
        Note over Engine: Pass 4: Unmatched (Exceptions)
    end
    
    Engine-->>App: Match Results
    
    App->>Gemini: Request explanations for fuzzy/bulk matches
    Gemini-->>App: JSON Reasoning (Confidence, Reason, Flags)
    
    App->>DB: Save Matches & Update Transaction Statuses
    App-->>User: Display Dashboard with Results
```

### QuickBooks OAuth Integration Flow

```mermaid
sequenceDiagram
    participant User
    participant App
    participant Intuit as QuickBooks Auth
    participant DB
    
    User->>App: Click "Connect QuickBooks"
    App->>Intuit: Redirect to Intuit OAuth URL
    Intuit-->>User: Prompt Login & Consent
    User->>Intuit: Approve Access
    Intuit->>App: Redirect to /api/qbo/callback with Code
    App->>Intuit: Exchange Code for Access/Refresh Tokens
    Intuit-->>App: Token Payload
    App->>DB: Securely store Tokens against User ID
    App-->>User: Redirect to Connect Dashboard
```

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
| **Integrations** | `intuit-oauth` (QuickBooks) |

---

## 📁 Project Structure

```text
reconflow/
├── app/                          # Next.js App Router — pages & API routes
│   ├── api/
│   │   ├── auth/                 # Auth.js handlers
│   │   ├── matches/              # GET all matches, POST approve/reject
│   │   ├── qbo/                  # QuickBooks OAuth (auth, callback, sync, disconnect)
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
├── core/                         # Business logic
│   ├── db/
│   │   ├── index.ts              # DB connection config
│   │   └── schema.ts             # Drizzle schema (users, bankTransactions, ledgerEntries, matches)
│   └── matching/
│   │   └── engine.ts             # The 4-pass reconciliation algorithm
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
