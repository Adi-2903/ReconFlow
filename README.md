# ReconFlow

**AI-powered bank reconciliation for Indian startups and SMEs.**  
Built for the [AWS × Vercel Hackathon](https://vercel.com/) — full-stack Next.js deployed on Vercel, backed by Amazon Aurora PostgreSQL.

---

## What it does

ReconFlow automatically matches bank transactions against your accounting ledger entries using a multi-pass reconciliation engine:

- **Exact match** — amount + date within tolerance → auto-approved
- **Fuzzy match** — partial amount/date/text similarity → flagged for human review
- **Bulk match** — multiple ledger entries that sum to one bank transaction (e.g., payroll splits)
- **Exceptions** — unmatched transactions that need manual investigation

An **Evidence Panel** provides explainability for every match, and an **Audit Log** tracks every approve/reject action.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 (App Router), Tailwind CSS |
| Auth | Auth.js v5 (Credentials provider, JWT sessions) |
| Database | Amazon Aurora PostgreSQL / Neon PostgreSQL |
| ORM | Drizzle ORM + Drizzle Kit |
| UI Components | ShadCN UI |
| Deployment | Vercel |

---

## Project Structure

```
reconflow/
├── app/                          # Next.js App Router — pages & API routes
│   ├── api/
│   │   ├── auth/                 # Auth.js handlers
│   │   ├── matches/              # GET all matches, POST approve/reject/bulk-approve
│   │   └── recon/run/            # POST — run the reconciliation engine
│   ├── connect/                  # Integration setup wizard
│   ├── dashboard/                # Main reconciliation dashboard
│   ├── exceptions/               # Exceptions management page
│   ├── reports/                  # Reports & analytics
│   ├── settings/                 # Settings page
│   └── sign-in/                  # Authentication page
│
├── components/                   # UI components (presentation layer)
│   ├── app-shell.tsx             # Navigation sidebar + top bar
│   ├── virtual-match-table.tsx   # Virtualized match list (main dashboard table)
│   ├── evidence-panel/           # Side panel showing match evidence & reasoning
│   ├── new-run-modal/            # Multi-step modal to configure a reconciliation run
│   ├── skeletons/                # Loading skeleton components
│   ├── error-boundary/           # React error boundary
│   ├── Providers.tsx             # Session & toast providers
│   └── ui/                       # ShadCN base components (button, dialog, etc.)
│
├── core/                         # Business logic — decoupled from Next.js
│   ├── db/
│   │   ├── index.ts              # DB connection (Aurora / Neon auto-detect)
│   │   └── schema.ts             # Drizzle schema (users, transactions, matches, audit)
│   ├── matching/
│   │   └── engine.ts             # Reconciliation algorithm (exact, fuzzy, bulk)
│   └── adapters/                 # Future: Stripe, QuickBooks, Razorpay adapters
│
├── lib/                          # Frontend utilities
│   ├── data-context.tsx          # App-wide React context for match state
│   ├── data.ts                   # Fallback mock matches (used when DB is empty)
│   ├── constants.ts              # Shared constants (e.g., EXCEPTION_COUNT)
│   ├── toast.ts                  # Toast notification helper
│   └── utils.ts                  # ShadCN cn() utility
│
├── types/
│   └── match.ts                  # Canonical MatchData type (single source of truth)
│
├── scripts/
│   └── seed-stripe-test.ts       # Seeds DB with demo transactions & ledger entries
│
├── auth.config.ts                # Edge-compatible NextAuth config (for middleware)
├── auth.ts                       # Full NextAuth config (Node.js runtime, DB adapter)
├── middleware.ts                 # Route protection (Edge Runtime safe)
├── drizzle.config.ts             # Drizzle Kit config
└── .env.example                  # Environment variable reference
```

---

## Local Development

### Prerequisites
- Node.js 18+
- A PostgreSQL database (local, Docker, Neon, or Aurora)

### Setup

1. **Clone and install**
   ```bash
   git clone https://github.com/your-username/reconflow
   cd reconflow
   npm install
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your values:
   ```env
   DATABASE_URL=postgres://postgres:password@localhost:5432/reconflow
   AUTH_SECRET=your-random-secret-here
   GEMINI_API_KEY=your-gemini-key
   ```

3. **Push database schema**
   ```bash
   npx drizzle-kit push
   ```

4. **Seed demo data**
   ```bash
   npx tsx scripts/seed-stripe-test.ts
   ```

5. **Start the dev server**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000). Log in with `demo@example.com` and any password.

---

## Deploying to Vercel

1. Push the repo to GitHub.
2. Import the project in [Vercel](https://vercel.com).
3. Add environment variables in the Vercel dashboard:
   - `DATABASE_URL` — your Aurora/Neon connection string
   - `AUTH_SECRET` — a secure random string
   - `GEMINI_API_KEY` — your Gemini API key
   - `NEXTAUTH_URL` — your Vercel deployment URL
4. Deploy. Vercel handles the rest.
