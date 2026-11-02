-- ============================================================================
-- Migration: 0006_phase3_hotfix.sql
-- Phase 3 Hotfix: confirmed_at, state-machine trigger protection,
-- awaiting_sale status, and allocation invariants.
-- ============================================================================

-- ── 1. Add confirmed_at to payments ──────────────────────────────────────────

ALTER TABLE payments ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS payments_confirmed_at_idx ON payments (confirmed_at);

-- ── 2. Backfill confirmed_at ─────────────────────────────────────────────────
-- Non-cheque confirmed payments backfill from created_at
UPDATE payments
SET confirmed_at = created_at
WHERE status = 'confirmed' AND confirmed_at IS NULL AND method != 'cheque';

-- Cheque confirmed payments backfill from audit_log clearing entry, fallback to created_at
UPDATE payments p
SET confirmed_at = COALESCE(
  (
    SELECT a.at
    FROM audit_log a
    WHERE a.action IN ('payment.cheque_clear', 'payment_cheque_cleared')
      AND a.entity_id = p.id
    ORDER BY a.at DESC
    LIMIT 1
  ),
  p.created_at
)
WHERE p.status = 'confirmed' AND p.confirmed_at IS NULL AND p.method = 'cheque';

-- ── 3. Update Status Check Constraint ────────────────────────────────────────

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check
  CHECK (status IN ('pending', 'awaiting_sale', 'confirmed', 'failed', 'reversed'));

-- ── 4. State Machine Trigger ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_payments_state_machine()
RETURNS TRIGGER AS $$
BEGIN
  -- ── ON INSERT ──────────────────────────────────────────────────────────────
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'awaiting_sale' THEN
      RAISE EXCEPTION 'Payments cannot be inserted with initial status awaiting_sale';
    END IF;

    IF NEW.status IN ('reversed', 'failed') THEN
      RAISE EXCEPTION 'Payments cannot be inserted with terminal status %', NEW.status;
    END IF;

    IF NEW.status = 'confirmed' THEN
      NEW.confirmed_at := COALESCE(NEW.confirmed_at, NOW());
    ELSIF NEW.status = 'pending' THEN
      NEW.confirmed_at := NULL;
    ELSE
      RAISE EXCEPTION 'Invalid initial payment status %', NEW.status;
    END IF;

    RETURN NEW;
  END IF;

  -- ── ON UPDATE ──────────────────────────────────────────────────────────────
  -- Terminal states are completely immutable
  IF OLD.status IN ('failed', 'reversed') THEN
    RAISE EXCEPTION 'Payments in status % are immutable', OLD.status;
  END IF;

  -- Validate status transitions
  IF NEW.status != OLD.status THEN
    IF OLD.status = 'pending' THEN
      IF NOT (NEW.status IN ('confirmed', 'awaiting_sale', 'failed')) THEN
        RAISE EXCEPTION 'Invalid payment status transition from % to %', OLD.status, NEW.status;
      END IF;
    ELSIF OLD.status = 'awaiting_sale' THEN
      IF NEW.status = 'confirmed' THEN
        -- Consumed by sale or converted to customer deposit
        NULL;
      ELSIF NEW.status = 'reversed' THEN
        -- Awaiting sale reversal requires reason and refund reference
        IF NEW.reversal_reason IS NULL OR length(trim(NEW.reversal_reason)) = 0 THEN
          RAISE EXCEPTION 'Reversal of awaiting_sale payment requires a reversal reason';
        END IF;
        IF (NEW.method_details->>'refund_reference' IS NULL OR length(trim(NEW.method_details->>'refund_reference')) = 0)
           AND (NEW.method_details->>'reference' IS NULL OR length(trim(NEW.method_details->>'reference')) = 0)
           AND (NEW.reversal_reason NOT ILIKE '%refund%') THEN
          RAISE EXCEPTION 'Reversal of awaiting_sale payment requires a refund reference';
        END IF;
      ELSIF NEW.status = 'failed' THEN
        -- Timeout / declined
        NULL;
      ELSE
        RAISE EXCEPTION 'Invalid payment status transition from % to %', OLD.status, NEW.status;
      END IF;
    ELSIF OLD.status = 'confirmed' THEN
      IF NEW.status = 'reversed' THEN
        IF NEW.reversal_reason IS NULL OR length(trim(NEW.reversal_reason)) = 0 THEN
          RAISE EXCEPTION 'Reversal of confirmed payment requires a reversal reason';
        END IF;
      ELSE
        RAISE EXCEPTION 'Invalid payment status transition from % to %', OLD.status, NEW.status;
      END IF;
    ELSE
      RAISE EXCEPTION 'Invalid payment status transition from % to %', OLD.status, NEW.status;
    END IF;

    -- Timestamp maintenance
    IF NEW.status = 'confirmed' AND OLD.status != 'confirmed' THEN
      NEW.confirmed_at := COALESCE(NEW.confirmed_at, NOW());
    ELSIF NEW.status = 'reversed' AND OLD.status != 'reversed' THEN
      NEW.reversed_at := COALESCE(NEW.reversed_at, NOW());
    END IF;
  END IF;

  -- intended_allocations can only be modified while payment is pending
  IF OLD.status != 'pending' AND (NEW.intended_allocations::text IS DISTINCT FROM OLD.intended_allocations::text) THEN
    RAISE EXCEPTION 'intended_allocations can only be modified while payment is pending';
  END IF;

  -- Full immutable list whenever OLD.status is confirmed or awaiting_sale
  IF OLD.status IN ('confirmed', 'awaiting_sale') THEN
    IF (NEW.amount_minor != OLD.amount_minor OR
        NEW.method != OLD.method OR
        NEW.customer_id != OLD.customer_id OR
        NEW.kind != OLD.kind OR
        NEW.idempotency_key != OLD.idempotency_key OR
        NEW.payment_date != OLD.payment_date OR
        NEW.location_id != OLD.location_id OR
        NEW.currency != OLD.currency OR
        NEW.payment_number != OLD.payment_number OR
        (OLD.provider_reference IS NOT NULL AND NEW.provider_reference != OLD.provider_reference) OR
        (OLD.confirmed_at IS NOT NULL AND NEW.confirmed_at != OLD.confirmed_at)) THEN
      RAISE EXCEPTION 'Confirmed or awaiting_sale payment financial and identification fields cannot be modified';
    END IF;

    -- method_details is immutable except allowing refund_reference on reversal
    IF NEW.method_details::text != OLD.method_details::text THEN
      IF NOT (OLD.status = 'awaiting_sale' AND NEW.status = 'reversed') THEN
        RAISE EXCEPTION 'method_details cannot be modified on confirmed or awaiting_sale payments';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payments_state_machine ON payments;
CREATE TRIGGER trg_payments_state_machine
  BEFORE INSERT OR UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION fn_payments_state_machine();

-- ── 5. Update Allocation Limits Trigger ──────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_check_allocation_limits()
RETURNS TRIGGER AS $$
DECLARE
    v_payment_amount BIGINT;
    v_payment_status TEXT;
    v_payment_kind TEXT;
    v_payment_net_alloc BIGINT;
    v_pair_net_alloc BIGINT;
    v_invoice_net_alloc BIGINT;
    v_invoice_status TEXT;
    v_invoice_type TEXT;
    v_invoice_total BIGINT;
    v_invoice_credited BIGINT;
BEGIN
    -- Check payment exists and is valid
    SELECT amount_minor, status, kind INTO v_payment_amount, v_payment_status, v_payment_kind
    FROM payments WHERE id = NEW.payment_id;

    IF v_payment_status != 'confirmed' THEN
        RAISE EXCEPTION 'Allocations can only be made to confirmed payments (payment status: %)', v_payment_status;
    END IF;

    IF v_payment_kind != 'receipt' THEN
        RAISE EXCEPTION 'Allocations can only be made for receipt payments (payment kind: %)', v_payment_kind;
    END IF;

    -- 1. Net allocated across all invoices for this payment
    SELECT COALESCE(SUM(amount_minor), 0) INTO v_payment_net_alloc
    FROM payment_allocations WHERE payment_id = NEW.payment_id;

    v_payment_net_alloc := v_payment_net_alloc + NEW.amount_minor;

    IF v_payment_net_alloc > v_payment_amount THEN
        RAISE EXCEPTION 'Allocation exceeds remaining payment amount (net allocated % > payment amount %)', v_payment_net_alloc, v_payment_amount;
    END IF;

    IF v_payment_net_alloc < 0 THEN
        RAISE EXCEPTION 'Negative allocation cannot exceed prior allocated amount (net allocated % < 0)', v_payment_net_alloc;
    END IF;

    -- 2. Net allocated for this specific (payment_id, invoice_id) pair cannot drop below zero
    SELECT COALESCE(SUM(amount_minor), 0) INTO v_pair_net_alloc
    FROM payment_allocations
    WHERE payment_id = NEW.payment_id AND invoice_id = NEW.invoice_id;

    v_pair_net_alloc := v_pair_net_alloc + NEW.amount_minor;

    IF v_pair_net_alloc < 0 THEN
        RAISE EXCEPTION 'Net allocation for payment % and invoice % cannot be negative (would be %)', NEW.payment_id, NEW.invoice_id, v_pair_net_alloc;
    END IF;

    -- 3. Check invoice exists and is valid
    SELECT document_type, status, total_minor, credited_minor
    INTO v_invoice_type, v_invoice_status, v_invoice_total, v_invoice_credited
    FROM sales_documents WHERE id = NEW.invoice_id;

    IF v_invoice_type != 'invoice' THEN
        RAISE EXCEPTION 'Allocations can only be made to invoices (document type: %)', v_invoice_type;
    END IF;

    IF v_invoice_status != 'issued' THEN
        RAISE EXCEPTION 'Allocations can only be made to issued invoices (invoice status: %)', v_invoice_status;
    END IF;

    -- 4. Net allocated across all payments for this invoice
    SELECT COALESCE(SUM(amount_minor), 0) INTO v_invoice_net_alloc
    FROM payment_allocations WHERE invoice_id = NEW.invoice_id;

    v_invoice_net_alloc := v_invoice_net_alloc + NEW.amount_minor;

    IF v_invoice_net_alloc < 0 THEN
        RAISE EXCEPTION 'Net allocation for invoice % cannot be negative (would be %)', NEW.invoice_id, v_invoice_net_alloc;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

