-- Migration 0005: Phase 4 Counter POS Schema
-- Adds pos_shifts, cash_movements, held_sales, sales_documents POS columns, payments FK, users PIN fields

-- 1. Create pos_shifts
CREATE TABLE IF NOT EXISTS pos_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_number TEXT NOT NULL UNIQUE,
  cashier_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'reviewed')),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  review_note TEXT,
  opening_float_minor BIGINT NOT NULL DEFAULT 0,
  counted_cash_minor BIGINT,
  card_terminal_totals JSONB,
  expected_cash_minor BIGINT,
  cash_variance_minor BIGINT,
  denomination_count JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS pos_shifts_one_open_per_cashier_idx
  ON pos_shifts (cashier_id) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS pos_shifts_location_idx ON pos_shifts (location_id);
CREATE INDEX IF NOT EXISTS pos_shifts_status_idx ON pos_shifts (status);
CREATE INDEX IF NOT EXISTS pos_shifts_opened_at_idx ON pos_shifts (opened_at);

-- Trigger: protect closed shift financial figures and enforce open -> closed -> reviewed
CREATE OR REPLACE FUNCTION trg_pos_shifts_status_guard()
RETURNS TRIGGER AS $$
BEGIN
  -- Status transitions must be open -> closed -> reviewed
  IF OLD.status = 'open' AND NEW.status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'Invalid shift status transition from open to %', NEW.status;
  END IF;

  IF OLD.status = 'closed' AND NEW.status NOT IN ('closed', 'reviewed') THEN
    RAISE EXCEPTION 'Invalid shift status transition from closed to %', NEW.status;
  END IF;

  IF OLD.status = 'reviewed' AND NEW.status != 'reviewed' THEN
    RAISE EXCEPTION 'Reviewed shift cannot change status';
  END IF;

  -- Once closed or reviewed, protect financial figures
  IF OLD.status IN ('closed', 'reviewed') THEN
    IF NEW.opening_float_minor != OLD.opening_float_minor THEN
      RAISE EXCEPTION 'Cannot modify opening_float_minor of a closed shift';
    END IF;
    IF NEW.counted_cash_minor IS DISTINCT FROM OLD.counted_cash_minor THEN
      RAISE EXCEPTION 'Cannot modify counted_cash_minor of a closed shift';
    END IF;
    IF NEW.expected_cash_minor IS DISTINCT FROM OLD.expected_cash_minor THEN
      RAISE EXCEPTION 'Cannot modify expected_cash_minor of a closed shift';
    END IF;
    IF NEW.cash_variance_minor IS DISTINCT FROM OLD.cash_variance_minor THEN
      RAISE EXCEPTION 'Cannot modify cash_variance_minor of a closed shift';
    END IF;
    IF NEW.card_terminal_totals IS DISTINCT FROM OLD.card_terminal_totals THEN
      RAISE EXCEPTION 'Cannot modify card_terminal_totals of a closed shift';
    END IF;
    IF NEW.cashier_id != OLD.cashier_id THEN
      RAISE EXCEPTION 'Cannot modify cashier_id of a closed shift';
    END IF;
    IF NEW.location_id != OLD.location_id THEN
      RAISE EXCEPTION 'Cannot modify location_id of a closed shift';
    END IF;
  END IF;

  -- If reviewing, require review note when there is variance
  IF NEW.status = 'reviewed' AND OLD.status = 'closed' THEN
    IF COALESCE(OLD.cash_variance_minor, 0) != 0 AND (NEW.review_note IS NULL OR length(trim(NEW.review_note)) = 0) THEN
      RAISE EXCEPTION 'A review note is required when there is cash variance';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pos_shifts_status_guard ON pos_shifts;
CREATE TRIGGER pos_shifts_status_guard
  BEFORE UPDATE ON pos_shifts
  FOR EACH ROW
  EXECUTE FUNCTION trg_pos_shifts_status_guard();

-- 2. Create cash_movements
CREATE TABLE IF NOT EXISTS cash_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id UUID NOT NULL REFERENCES pos_shifts(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('paid_in', 'paid_out')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  reason TEXT NOT NULL,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  requires_override BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS cash_movements_shift_idx ON cash_movements (shift_id);

-- Trigger: cash_movements append-only and only allowed on an open shift
CREATE OR REPLACE FUNCTION trg_cash_movements_append_only()
RETURNS TRIGGER AS $$
DECLARE
  v_shift_status TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO v_shift_status FROM pos_shifts WHERE id = NEW.shift_id;
    IF v_shift_status IS NULL THEN
      RAISE EXCEPTION 'Shift % not found', NEW.shift_id;
    END IF;
    IF v_shift_status != 'open' THEN
      RAISE EXCEPTION 'Cash movements are only permitted on an open shift (current status: %)', v_shift_status;
    END IF;
    RETURN NEW;
  ELSIF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'cash_movements is append-only. Modifying or deleting records is prohibited.';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cash_movements_append_only ON cash_movements;
CREATE TRIGGER cash_movements_append_only
  BEFORE INSERT OR UPDATE OR DELETE ON cash_movements
  FOR EACH ROW
  EXECUTE FUNCTION trg_cash_movements_append_only();

-- 3. Create held_sales
CREATE TABLE IF NOT EXISTS held_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id UUID NOT NULL REFERENCES pos_shifts(id) ON DELETE CASCADE,
  hold_reference TEXT NOT NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  cart_payload JSONB NOT NULL,
  held_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  held_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS held_sales_shift_idx ON held_sales (shift_id);

-- 4. Alter sales_documents
ALTER TABLE sales_documents ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'office' CHECK (channel IN ('office', 'counter'));
ALTER TABLE sales_documents ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES pos_shifts(id) ON DELETE RESTRICT;
ALTER TABLE sales_documents ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE;
ALTER TABLE sales_documents ADD COLUMN IF NOT EXISTS client_created_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS sales_docs_shift_idx ON sales_documents (shift_id);

-- 5. Foreign key from payments.shift_id to pos_shifts.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_shift_id_fkey'
  ) THEN
    ALTER TABLE payments ADD CONSTRAINT payments_shift_id_fkey
      FOREIGN KEY (shift_id) REFERENCES pos_shifts(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- 6. Add PIN fields to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_failed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMPTZ;

-- 7. Grant pos:override and pos:reprint_any to admin and manager
UPDATE roles
SET permissions = array_cat(
  permissions,
  ARRAY['pos:override', 'pos:reprint_any']::TEXT[]
)
WHERE name IN ('admin', 'manager')
  AND NOT ('pos:override' = ANY(permissions));
