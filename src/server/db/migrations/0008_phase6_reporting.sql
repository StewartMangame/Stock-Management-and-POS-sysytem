-- Migration: 0008_phase6_reporting.sql
-- Phase 6: Stock Snapshots, Accounting Journals, System Checks History,
--          Improved Indexes, Audit Log Immutability Enforcement.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Update stock_movements index: (product_id, location_id, occurred_at, seq)
-- ════════════════════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS stock_movements_prod_loc_occurred_idx;
CREATE INDEX IF NOT EXISTS stock_movements_prod_loc_occ_seq_idx
  ON stock_movements (product_id, location_id, occurred_at, seq);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Payments and allocations: add missing confirmed_at / allocated_at indexes
-- ════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS payments_confirmed_at_idx2
  ON payments (confirmed_at)
  WHERE confirmed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS payment_alloc_allocated_at_idx
  ON payment_allocations (allocated_at);

CREATE INDEX IF NOT EXISTS delivery_note_lines_sdl_idx
  ON delivery_note_lines (sales_document_line_id, delivery_note_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Audit log: composite indexes for keyset pagination and entity history
-- ════════════════════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS audit_log_at_idx;
CREATE INDEX IF NOT EXISTS audit_log_at_id_idx
  ON audit_log (at DESC, id);

DROP INDEX IF EXISTS audit_log_entity_idx;
CREATE INDEX IF NOT EXISTS audit_log_entity_at_idx
  ON audit_log (entity_type, entity_id, at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Audit log immutability: trigger prevents UPDATE, DELETE, TRUNCATE
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: UPDATE and DELETE are not permitted';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_update_trg ON audit_log;
CREATE TRIGGER audit_log_no_update_trg
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

DROP TRIGGER IF EXISTS audit_log_no_delete_trg ON audit_log;
CREATE TRIGGER audit_log_no_delete_trg
  BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

CREATE OR REPLACE FUNCTION prevent_audit_log_truncate()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: TRUNCATE is not permitted';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_truncate_trg ON audit_log;
CREATE TRIGGER audit_log_no_truncate_trg
  BEFORE TRUNCATE ON audit_log
  EXECUTE FUNCTION prevent_audit_log_truncate();

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Stock daily snapshots table
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS stock_daily_snapshots (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date   DATE        NOT NULL,
  product_id      UUID        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  location_id     UUID        NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  on_hand         NUMERIC(14,3) NOT NULL DEFAULT 0,
  average_cost_minor BIGINT  NOT NULL DEFAULT 0,
  valuation_minor BIGINT      NOT NULL DEFAULT 0,
  is_stale        BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_snapshots_date_prod_loc_uniq'
  ) THEN
    ALTER TABLE stock_daily_snapshots
      ADD CONSTRAINT stock_snapshots_date_prod_loc_uniq
      UNIQUE (snapshot_date, product_id, location_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS stock_snapshots_date_idx
  ON stock_daily_snapshots (snapshot_date);
CREATE INDEX IF NOT EXISTS stock_snapshots_stale_idx
  ON stock_daily_snapshots (is_stale) WHERE is_stale = TRUE;

-- Trigger: mark snapshots stale when a backdated movement is inserted
CREATE OR REPLACE FUNCTION mark_snapshots_stale_on_backdated_movement()
RETURNS TRIGGER AS $$
DECLARE
  v_occurred_date DATE;
BEGIN
  -- Convert occurred_at to Africa/Blantyre date
  v_occurred_date := (NEW.occurred_at AT TIME ZONE 'Africa/Blantyre')::DATE;

  -- If the movement is for a date earlier than today (backdated), mark all
  -- snapshots for this product+location on or after the movement date as stale
  IF v_occurred_date < (NOW() AT TIME ZONE 'Africa/Blantyre')::DATE THEN
    UPDATE stock_daily_snapshots
       SET is_stale = TRUE, updated_at = NOW()
     WHERE product_id  = NEW.product_id
       AND location_id = NEW.location_id
       AND snapshot_date >= v_occurred_date
       AND is_stale = FALSE;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stock_movements_backdate_trg ON stock_movements;
CREATE TRIGGER stock_movements_backdate_trg
  AFTER INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION mark_snapshots_stale_on_backdated_movement();

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Journal source events (deduplication; each source event in one batch)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS journal_source_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  TEXT        NOT NULL,
  source_id   UUID        NOT NULL,
  batch_id    UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'journal_source_events_type_source_uniq'
  ) THEN
    ALTER TABLE journal_source_events
      ADD CONSTRAINT journal_source_events_type_source_uniq
      UNIQUE (event_type, source_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS journal_source_events_batch_idx
  ON journal_source_events (batch_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 7. Account mappings (configurable chart of accounts)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS account_mappings (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      TEXT        NOT NULL,
  role            TEXT        NOT NULL,
  account_code    TEXT        NOT NULL,
  account_name    TEXT        NOT NULL,
  description     TEXT,
  is_placeholder  BOOLEAN     NOT NULL DEFAULT TRUE,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by      UUID        REFERENCES users(id) ON DELETE SET NULL
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'account_mappings_event_role_uniq'
  ) THEN
    ALTER TABLE account_mappings
      ADD CONSTRAINT account_mappings_event_role_uniq
      UNIQUE (event_type, role);
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 8. Journal batches (append-only)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS journal_batches (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_number            TEXT        NOT NULL UNIQUE,
  period_start            TIMESTAMPTZ NOT NULL,
  period_end              TIMESTAMPTZ NOT NULL,
  exported_at             TIMESTAMPTZ,
  exported_by             UUID        REFERENCES users(id) ON DELETE SET NULL,
  re_export_approved_by   UUID        REFERENCES users(id) ON DELETE SET NULL,
  re_export_approved_at   TIMESTAMPTZ,
  re_export_reason        TEXT,
  is_draft                BOOLEAN     NOT NULL DEFAULT TRUE,
  status                  TEXT        NOT NULL DEFAULT 'unexported',
  total_debit_minor       BIGINT      NOT NULL DEFAULT 0,
  total_credit_minor      BIGINT      NOT NULL DEFAULT 0,
  line_count              BIGINT      NOT NULL DEFAULT 0,
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS journal_batches_period_idx
  ON journal_batches (period_start, period_end);
CREATE INDEX IF NOT EXISTS journal_batches_status_idx
  ON journal_batches (status);

-- Append-only: prevent UPDATE, DELETE, TRUNCATE on journal_batches
CREATE OR REPLACE FUNCTION prevent_journal_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'journal tables are append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS journal_batches_no_update_trg ON journal_batches;
CREATE TRIGGER journal_batches_no_update_trg
  BEFORE UPDATE ON journal_batches
  FOR EACH ROW EXECUTE FUNCTION prevent_journal_mutation();

DROP TRIGGER IF EXISTS journal_batches_no_delete_trg ON journal_batches;
CREATE TRIGGER journal_batches_no_delete_trg
  BEFORE DELETE ON journal_batches
  FOR EACH ROW EXECUTE FUNCTION prevent_journal_mutation();

DROP TRIGGER IF EXISTS journal_batches_no_truncate_trg ON journal_batches;
CREATE TRIGGER journal_batches_no_truncate_trg
  BEFORE TRUNCATE ON journal_batches
  EXECUTE FUNCTION prevent_journal_mutation();

-- ════════════════════════════════════════════════════════════════════════════
-- 9. Journal lines (append-only double-entry rows)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS journal_lines (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id            UUID        NOT NULL REFERENCES journal_batches(id) ON DELETE CASCADE,
  entry_number        TEXT        NOT NULL,
  entry_date          TIMESTAMPTZ NOT NULL,
  event_type          TEXT        NOT NULL,
  source_entity_type  TEXT        NOT NULL,
  source_entity_id    UUID        NOT NULL,
  account_code        TEXT        NOT NULL,
  account_name        TEXT        NOT NULL,
  debit_minor         BIGINT      NOT NULL DEFAULT 0,
  credit_minor        BIGINT      NOT NULL DEFAULT 0,
  description         TEXT,
  location_id         UUID        REFERENCES locations(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT journal_lines_debit_or_credit_check
    CHECK (
      (debit_minor > 0 AND credit_minor = 0)
      OR (credit_minor > 0 AND debit_minor = 0)
    )
);

CREATE INDEX IF NOT EXISTS journal_lines_batch_idx
  ON journal_lines (batch_id);
CREATE INDEX IF NOT EXISTS journal_lines_entry_idx
  ON journal_lines (entry_number);
CREATE INDEX IF NOT EXISTS journal_lines_date_idx
  ON journal_lines (entry_date);
CREATE INDEX IF NOT EXISTS journal_lines_source_idx
  ON journal_lines (source_entity_type, source_entity_id);

-- Append-only journal lines
DROP TRIGGER IF EXISTS journal_lines_no_update_trg ON journal_lines;
CREATE TRIGGER journal_lines_no_update_trg
  BEFORE UPDATE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION prevent_journal_mutation();

DROP TRIGGER IF EXISTS journal_lines_no_delete_trg ON journal_lines;
CREATE TRIGGER journal_lines_no_delete_trg
  BEFORE DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION prevent_journal_mutation();

DROP TRIGGER IF EXISTS journal_lines_no_truncate_trg ON journal_lines;
CREATE TRIGGER journal_lines_no_truncate_trg
  BEFORE TRUNCATE ON journal_lines
  EXECUTE FUNCTION prevent_journal_mutation();

-- ════════════════════════════════════════════════════════════════════════════
-- 10. System checks history
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS system_checks_history (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  executed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  executed_by   UUID        REFERENCES users(id) ON DELETE SET NULL,
  status        TEXT        NOT NULL,
  total_checks  BIGINT      NOT NULL DEFAULT 0,
  passed_count  BIGINT      NOT NULL DEFAULT 0,
  warning_count BIGINT      NOT NULL DEFAULT 0,
  failed_count  BIGINT      NOT NULL DEFAULT 0,
  duration_ms   BIGINT      NOT NULL DEFAULT 0,
  details       JSONB       NOT NULL DEFAULT '[]'::JSONB
);

CREATE INDEX IF NOT EXISTS system_checks_at_idx
  ON system_checks_history (executed_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- 11. Seed placeholder account mappings (DRAFT watermarked until confirmed)
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO account_mappings (event_type, role, account_code, account_name, description, is_placeholder)
VALUES
  ('invoice_issued',   'debit',     '1100', 'Accounts Receivable [PLACEHOLDER]',          'Dr AR when invoice issued',                  TRUE),
  ('invoice_issued',   'credit',    '4000', 'Sales Revenue [PLACEHOLDER]',                 'Cr Revenue (net of tax) when invoice issued', TRUE),
  ('invoice_issued',   'tax',       '2200', 'Output VAT Payable [PLACEHOLDER]',            'Cr VAT liability when invoice issued',        TRUE),
  ('invoice_void',     'debit',     '4000', 'Sales Revenue [PLACEHOLDER]',                 'Dr Revenue to reverse voided invoice',        TRUE),
  ('invoice_void',     'tax_debit', '2200', 'Output VAT Payable [PLACEHOLDER]',            'Dr VAT to reverse voided invoice',            TRUE),
  ('invoice_void',     'credit',    '1100', 'Accounts Receivable [PLACEHOLDER]',           'Cr AR to reverse voided invoice',             TRUE),
  ('delivery_issued',  'debit',     '5000', 'Cost of Goods Sold [PLACEHOLDER]',            'Dr COGS at delivery',                         TRUE),
  ('delivery_issued',  'credit',    '1300', 'Inventory [PLACEHOLDER]',                     'Cr Inventory at delivery unit cost',          TRUE),
  ('goods_received',   'debit',     '1300', 'Inventory [PLACEHOLDER]',                     'Dr Inventory on GRN',                         TRUE),
  ('goods_received',   'credit',    '2100', 'Goods Received Not Invoiced [PLACEHOLDER]',   'Cr GRNI on GRN',                              TRUE),
  ('payment_received', 'debit',     '1000', 'Cash / Bank / Clearing [PLACEHOLDER]',        'Dr by payment method',                        TRUE),
  ('payment_received', 'credit',    '1100', 'Accounts Receivable [PLACEHOLDER]',           'Cr AR on payment receipt',                    TRUE),
  ('payment_reversal', 'debit',     '1100', 'Accounts Receivable [PLACEHOLDER]',           'Dr AR to reverse payment',                    TRUE),
  ('payment_reversal', 'credit',    '1000', 'Cash / Bank / Clearing [PLACEHOLDER]',        'Cr clearing on reversal',                     TRUE),
  ('cheque_bounced',   'debit',     '1100', 'Accounts Receivable [PLACEHOLDER]',           'Dr AR when cheque bounces',                   TRUE),
  ('cheque_bounced',   'credit',    '1010', 'Cheque Clearing [PLACEHOLDER]',               'Cr Cheque Clearing on bounce',                TRUE),
  ('credit_note',      'debit',     '4000', 'Sales Revenue [PLACEHOLDER]',                 'Dr Revenue for credit note',                  TRUE),
  ('credit_note',      'tax_debit', '2200', 'Output VAT Payable [PLACEHOLDER]',            'Dr VAT for credit note',                      TRUE),
  ('credit_note',      'credit',    '1100', 'Accounts Receivable [PLACEHOLDER]',           'Cr AR for credit note',                       TRUE),
  ('return_issued',    'debit',     '1300', 'Inventory [PLACEHOLDER]',                     'Dr Inventory at original cost on return',     TRUE),
  ('return_issued',    'credit',    '5000', 'Cost of Goods Sold [PLACEHOLDER]',            'Cr COGS at original cost on return',          TRUE),
  ('refund_issued',    'debit',     '1100', 'Accounts Receivable [PLACEHOLDER]',           'Dr Customer Credit Liability / AR',           TRUE),
  ('refund_issued',    'credit',    '1000', 'Cash / Bank [PLACEHOLDER]',                   'Cr Cash or Bank on refund',                   TRUE),
  ('deposit_received', 'debit',     '1000', 'Cash / Bank [PLACEHOLDER]',                   'Dr Cash when deposit received',               TRUE),
  ('deposit_received', 'credit',    '2300', 'Customer Credit Liability [PLACEHOLDER]',     'Cr Customer Credit Liability on deposit',     TRUE),
  ('awaiting_sale',    'debit',     '1000', 'Cash / Mobile Clearing [PLACEHOLDER]',        'Dr Cash / Clearing for awaiting_sale payment',TRUE),
  ('awaiting_sale',    'credit',    '2400', 'Awaiting Sale Suspense [PLACEHOLDER]',        'Cr Suspense until invoice matched',           TRUE),
  ('onekhusa_fee',     'debit',     '6100', 'Mobile Money Fee Expense [PLACEHOLDER]',      'Dr Expense for OneKhusa transaction fee',     TRUE),
  ('onekhusa_fee',     'credit',    '1020', 'Mobile Money Clearing [PLACEHOLDER]',         'Cr Clearing for provider fee deduction',      TRUE),
  ('clearing_settlement','debit',   '1001', 'Bank Account [PLACEHOLDER]',                  'Dr Bank on settlement receipt',               TRUE),
  ('clearing_settlement','credit',  '1020', 'Mobile Money / Card Clearing [PLACEHOLDER]', 'Cr Clearing account on settlement',           TRUE),
  ('stock_adjustment', 'debit',     '1300', 'Inventory [PLACEHOLDER]',                     'Dr Inventory on positive adjustment',         TRUE),
  ('stock_adjustment', 'credit',    '6200', 'Stock Variance Expense [PLACEHOLDER]',        'Cr Variance Expense on adjustment',           TRUE)
ON CONFLICT (event_type, role) DO NOTHING;

