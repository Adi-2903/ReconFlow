
-- ReconFlow Production PostgreSQL Schema
-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- ENUMS
CREATE TYPE member_role AS ENUM ('owner','admin','accountant','viewer');
CREATE TYPE account_type AS ENUM ('bank','quickbooks','tally','stripe','xero','netsuite');
CREATE TYPE transaction_side AS ENUM ('money','books');
CREATE TYPE transaction_direction AS ENUM ('inflow','outflow');
CREATE TYPE transaction_status AS ENUM (
  'available','candidate','matched','approved','locked','archived'
);
CREATE TYPE match_status AS ENUM (
  'auto_matched','suggested','needs_review','rejected','approved'
);

-- ORGANIZATIONS
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  base_currency CHAR(3) NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- USERS
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE organization_members (
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role member_role NOT NULL,
  PRIMARY KEY (organization_id, user_id)
);

-- ACCOUNTS
CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_type account_type NOT NULL,
  name TEXT NOT NULL,
  base_currency CHAR(3) NOT NULL,
  external_id TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- CONNECTORS
CREATE TABLE connectors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  connector_type account_type NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  status TEXT,
  settings JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- IMPORTS
CREATE TABLE imports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id UUID REFERENCES accounts(id),
  source_type TEXT,
  filename TEXT,
  status TEXT,
  row_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RAW RECORDS
CREATE TABLE raw_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  import_id UUID NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  row_number INTEGER,
  raw_payload JSONB NOT NULL,
  source_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_raw_payload ON raw_records USING GIN(raw_payload);

-- MAPPING TEMPLATES
CREATE TABLE mapping_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  template_name TEXT,
  mapping JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RECON RUNS
CREATE TABLE reconciliation_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  status TEXT
);

-- CANONICAL TRANSACTIONS
CREATE TABLE canonical_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id),
  raw_record_id UUID REFERENCES raw_records(id),

  side transaction_side NOT NULL,
  direction transaction_direction NOT NULL,

  transaction_date DATE NOT NULL,
  amount_minor BIGINT NOT NULL,
  currency CHAR(3) NOT NULL,

  reference_number TEXT,
  counterparty_name TEXT,
  counterparty_normalized TEXT,

  description TEXT,
  transaction_type TEXT,

  source_transaction_id TEXT,
  status transaction_status NOT NULL DEFAULT 'available',

  locked_at TIMESTAMPTZ,
  locked_by_match_group UUID,
  active_run_id UUID REFERENCES reconciliation_runs(id),

  metadata JSONB,

  embedding VECTOR(384),

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_txn_org_date_status
ON canonical_transactions(organization_id, transaction_date, status);

CREATE INDEX idx_txn_matching
ON canonical_transactions(
 organization_id,
 amount_minor,
 transaction_date,
 direction
);

CREATE INDEX idx_txn_counterparty
ON canonical_transactions(
 organization_id,
 counterparty_normalized
);

CREATE INDEX idx_txn_embedding
ON canonical_transactions
USING hnsw (embedding vector_cosine_ops);

-- CLASSIFICATIONS
CREATE TABLE classifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT
);

-- MATCH GROUPS
CREATE TABLE match_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id UUID NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,

  status match_status NOT NULL,

  confidence_score NUMERIC(5,2),
  score_breakdown JSONB,

  total_money_amount BIGINT DEFAULT 0,
  total_books_amount BIGINT DEFAULT 0,

  residual_amount BIGINT DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT now()
);

-- MATCH ITEMS
CREATE TABLE match_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_group_id UUID NOT NULL REFERENCES match_groups(id) ON DELETE CASCADE,
  transaction_id UUID NOT NULL REFERENCES canonical_transactions(id),
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- MANY TO MANY CLASSIFICATIONS
CREATE TABLE match_group_classifications (
  match_group_id UUID REFERENCES match_groups(id) ON DELETE CASCADE,
  classification_id UUID REFERENCES classifications(id) ON DELETE CASCADE,
  confidence NUMERIC(5,2),
  PRIMARY KEY(match_group_id, classification_id)
);

-- CANDIDATE CACHE
CREATE TABLE transaction_candidates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_transaction_id UUID NOT NULL REFERENCES canonical_transactions(id),
  candidate_transaction_id UUID NOT NULL REFERENCES canonical_transactions(id),
  score NUMERIC(5,2),
  score_breakdown JSONB,
  generated_at TIMESTAMPTZ DEFAULT now()
);

-- REVIEW QUEUE
CREATE TABLE review_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_group_id UUID NOT NULL REFERENCES match_groups(id) ON DELETE CASCADE,
  priority_score INTEGER,
  assigned_to UUID REFERENCES users(id),
  status TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- AI EXPLANATIONS
CREATE TABLE ai_explanations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_group_id UUID REFERENCES match_groups(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  response TEXT NOT NULL,
  confidence NUMERIC(5,2),
  reasoning JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- AUDIT LOGS
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  entity_type TEXT,
  entity_id UUID,
  action TEXT,
  before_state JSONB,
  after_state JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- COUNTERPARTY PROFILES
CREATE TABLE counterparty_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  normalized_name TEXT NOT NULL,
  avg_processing_days NUMERIC,
  avg_fee_percentage NUMERIC,
  total_transactions INTEGER DEFAULT 0,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- LEARNED PATTERNS
CREATE TABLE learned_patterns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  counterparty_profile_id UUID REFERENCES counterparty_profiles(id),
  pattern_type TEXT,
  confidence NUMERIC(5,2),
  pattern_data JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- FX RATES
CREATE TABLE fx_rates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  base_currency CHAR(3) NOT NULL,
  quote_currency CHAR(3) NOT NULL,
  rate NUMERIC(18,8) NOT NULL,
  rate_date DATE NOT NULL
);

-- FEE RULES
CREATE TABLE fee_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  rule_name TEXT NOT NULL,
  fee_config JSONB NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now()
);
