-- Migration: 0007_phase5_integrations.sql
-- Description: Phase 5 - OneKhusa Mobile Money Integration, Forensic Attempts,
--              Webhook Inbox, Payment Links, Bank Reconciliation, and EIS Outbox.

-- 1. Extend payments table with provider and exception flagging columns
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS provider_status TEXT,
  ADD COLUMN IF NOT EXISTS provider_reference TEXT,
  ADD COLUMN IF NOT EXISTS provider_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_fee_minor BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider_net_minor BIGINT,
  ADD COLUMN IF NOT EXISTS flag_type TEXT,
  ADD COLUMN IF NOT EXISTS flag_reason TEXT,
  ADD COLUMN IF NOT EXISTS flagged_at TIMESTAMPTZ;

-- Add check constraint for flag_type
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_flag_type_check'
  ) THEN
    ALTER TABLE payments
      ADD CONSTRAINT payments_flag_type_check
      CHECK (flag_type IS NULL OR flag_type IN (
        'amount_mismatch',
        'currency_mismatch',
        'unknown_reference',
        'out_of_order',
        'duplicate_webhook',
        'excess_credit'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payments_provider_ref ON payments (provider, provider_reference);
CREATE INDEX IF NOT EXISTS idx_payments_provider_confirmed_at ON payments (provider_confirmed_at);
CREATE INDEX IF NOT EXISTS idx_payments_flagged ON payments (flag_type) WHERE flag_type IS NOT NULL;

-- 2. Forensic Payment Attempts (Append-Only Log)
CREATE TABLE IF NOT EXISTS payment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID REFERENCES payments(id) ON DELETE RESTRICT,
  attempt_type TEXT NOT NULL,
  idempotency_key TEXT,
  request_url TEXT,
  request_headers JSONB,
  request_body JSONB,
  response_status INTEGER,
  response_body JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_payment_id ON payment_attempts(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_created_at ON payment_attempts(created_at);

-- Trigger to make payment_attempts append-only
CREATE OR REPLACE FUNCTION fn_payment_attempts_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'payment_attempts is an append-only audit log and cannot be updated or deleted';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payment_attempts_append_only ON payment_attempts;
CREATE TRIGGER trg_payment_attempts_append_only
  BEFORE UPDATE OR DELETE ON payment_attempts
  FOR EACH ROW EXECUTE FUNCTION fn_payment_attempts_append_only();

-- 3. Webhook Inbox (Asynchronous Ingestion)
CREATE TABLE IF NOT EXISTS webhook_inbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  transaction_reference TEXT NOT NULL,
  raw_payload TEXT NOT NULL,
  headers JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  error_message TEXT,
  CONSTRAINT uq_webhook_inbox_ref_event UNIQUE (transaction_reference, event_type)
);

CREATE INDEX IF NOT EXISTS idx_webhook_inbox_status_received ON webhook_inbox (status, received_at);

-- 4. Payment Links
CREATE TABLE IF NOT EXISTS payment_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES sales_documents(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked', 'paid')),
  expires_at TIMESTAMPTZ NOT NULL,
  allow_partial BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_links_invoice_id ON payment_links (invoice_id);

-- 5. Payment Link Rate Limits (Persistent DB)
CREATE TABLE IF NOT EXISTS payment_link_rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT uq_payment_link_rate_limits UNIQUE (key, window_start)
);

CREATE INDEX IF NOT EXISTS idx_payment_link_rate_limits_key ON payment_link_rate_limits (key);

-- 6. Statement Mapping Profiles (Custom Bank Formats)
CREATE TABLE IF NOT EXISTS statement_mapping_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  column_mapping JSONB NOT NULL,
  date_format TEXT NOT NULL DEFAULT 'YYYY-MM-DD',
  amount_mode TEXT NOT NULL CHECK (amount_mode IN ('gross', 'net')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Statement Imports
CREATE TABLE IF NOT EXISTS statement_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_hash TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  total_amount_minor BIGINT NOT NULL,
  profile_id UUID REFERENCES statement_mapping_profiles(id) ON DELETE SET NULL,
  imported_by UUID REFERENCES users(id) ON DELETE SET NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Statement Lines
CREATE TABLE IF NOT EXISTS statement_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id UUID NOT NULL REFERENCES statement_imports(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL,
  transaction_date DATE NOT NULL,
  reference TEXT,
  description TEXT,
  amount_minor BIGINT NOT NULL,
  fee_minor BIGINT NOT NULL DEFAULT 0,
  raw_data JSONB,
  match_status TEXT NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('unmatched', 'matched', 'partially_matched', 'ignored')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_statement_lines_import_line ON statement_lines (import_id, line_number);
CREATE INDEX IF NOT EXISTS idx_statement_lines_match_status ON statement_lines (match_status);

-- 9. Reconciliation Matches
CREATE TABLE IF NOT EXISTS reconciliation_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_line_id UUID NOT NULL REFERENCES statement_lines(id) ON DELETE CASCADE,
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  matched_amount_minor BIGINT NOT NULL,
  matched_by UUID REFERENCES users(id) ON DELETE SET NULL,
  matched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  CONSTRAINT uq_reconciliation_matches_payment UNIQUE (payment_id)
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_matches_line ON reconciliation_matches (statement_line_id);

-- 10. EIS Submissions (Transactional Outbox)
CREATE TABLE IF NOT EXISTS eis_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES sales_documents(id) ON DELETE RESTRICT,
  document_type TEXT NOT NULL CHECK (document_type IN ('invoice', 'credit_note')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'accepted', 'rejected', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  payload JSONB NOT NULL,
  response_payload JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eis_submissions_status_next_retry ON eis_submissions (status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_eis_submissions_document_id ON eis_submissions (document_id);

