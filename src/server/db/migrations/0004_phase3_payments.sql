-- ============================================================================
-- Migration: 0004_phase3_payments.sql
-- Phase 3: Card Terminals, Payments, Payment Allocations, AR Invariants & Triggers
-- ============================================================================

-- ── 1. Role Permissions Updates ──────────────────────────────────────────────

-- Ensure admin has all new tokens
UPDATE roles
SET permissions = array_append(permissions, 'payments:reverse')
WHERE name = 'admin' AND NOT ('payments:reverse' = ANY(permissions));

UPDATE roles
SET permissions = array_append(permissions, 'payments:cheque_clear')
WHERE name = 'admin' AND NOT ('payments:cheque_clear' = ANY(permissions));

-- Manager gets reverse and cheque_clear
UPDATE roles
SET permissions = array_append(permissions, 'payments:reverse')
WHERE name = 'manager' AND NOT ('payments:reverse' = ANY(permissions));

UPDATE roles
SET permissions = array_append(permissions, 'payments:cheque_clear')
WHERE name = 'manager' AND NOT ('payments:cheque_clear' = ANY(permissions));

-- Cashier loses payments:record (POS shift flow handles POS in Phase 4)
UPDATE roles
SET permissions = array_remove(permissions, 'payments:record')
WHERE name = 'cashier';

-- ── 2. Sales Documents: Add 'credited' to payment_status Check Constraint ────

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'sales_documents'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%payment_status%'
    ) LOOP
        EXECUTE 'ALTER TABLE sales_documents DROP CONSTRAINT IF EXISTS ' || quote_ident(r.conname);
    END LOOP;
END $$;

ALTER TABLE sales_documents
    ADD CONSTRAINT sales_documents_payment_status_check
    CHECK (payment_status IN ('unpaid', 'partly_paid', 'paid', 'credited'));

-- ── 3. Card Terminals Table ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS card_terminals (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT NOT NULL,
    terminal_id  TEXT NOT NULL UNIQUE,
    location_id  UUID NOT NULL REFERENCES locations (id) ON DELETE RESTRICT,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by   UUID REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS card_terminals_location_idx ON card_terminals (location_id);

-- ── 4. Payments Table ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payments (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_number        TEXT NOT NULL UNIQUE,
    idempotency_key       TEXT NOT NULL UNIQUE,
    customer_id           UUID NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
    location_id           UUID NOT NULL REFERENCES locations (id) ON DELETE RESTRICT,
    shift_id              UUID,
    kind                  TEXT NOT NULL CHECK (kind IN ('receipt', 'refund')),
    method                TEXT NOT NULL CHECK (method IN ('cash', 'bank_transfer', 'cheque', 'card', 'airtel_money', 'mpamba')),
    currency              CHAR(3) NOT NULL DEFAULT 'MWK',
    amount_minor          BIGINT NOT NULL CHECK (amount_minor > 0),
    status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'failed', 'reversed')),
    reconciliation_status TEXT NOT NULL DEFAULT 'not_required' CHECK (reconciliation_status IN ('not_required', 'unreconciled', 'reconciled')),
    method_details        JSONB NOT NULL DEFAULT '{}'::jsonb,
    intended_allocations  JSONB,
    provider_reference    TEXT,
    reversed_at           TIMESTAMPTZ,
    reversed_by           UUID REFERENCES users (id) ON DELETE SET NULL,
    reversal_reason       TEXT,
    reconciled_at         TIMESTAMPTZ,
    reconciled_by         UUID REFERENCES users (id) ON DELETE SET NULL,
    reconciliation_note   TEXT,
    payment_date          DATE NOT NULL CHECK (payment_date <= CURRENT_DATE),
    notes                 TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ,
    created_by            UUID REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS payments_customer_idx ON payments (customer_id);
CREATE INDEX IF NOT EXISTS payments_status_idx ON payments (status);
CREATE INDEX IF NOT EXISTS payments_method_idx ON payments (method);
CREATE INDEX IF NOT EXISTS payments_date_idx ON payments (payment_date);
CREATE INDEX IF NOT EXISTS payments_recon_idx ON payments (reconciliation_status);
CREATE INDEX IF NOT EXISTS payments_location_idx ON payments (location_id);

-- Partial unique indexes for mobile money & card terminal double-submission prevention
CREATE UNIQUE INDEX IF NOT EXISTS payments_airtel_txn_idx
    ON payments ((method_details->>'transaction_id'))
    WHERE method = 'airtel_money';

CREATE UNIQUE INDEX IF NOT EXISTS payments_mpamba_txn_idx
    ON payments ((method_details->>'transaction_id'))
    WHERE method = 'mpamba';

CREATE UNIQUE INDEX IF NOT EXISTS payments_card_unique_idx
    ON payments (
        (method_details->>'terminal_id'),
        (method_details->>'approval_code'),
        (method_details->>'slip_number')
    )
    WHERE method = 'card';

-- ── 5. Payment Allocations Table ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payment_allocations (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id   UUID NOT NULL REFERENCES payments (id) ON DELETE RESTRICT,
    invoice_id   UUID NOT NULL REFERENCES sales_documents (id) ON DELETE RESTRICT,
    amount_minor BIGINT NOT NULL,
    allocated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    allocated_by UUID REFERENCES users (id) ON DELETE SET NULL,
    notes        TEXT
);

CREATE INDEX IF NOT EXISTS payment_alloc_payment_idx ON payment_allocations (payment_id);
CREATE INDEX IF NOT EXISTS payment_alloc_invoice_idx ON payment_allocations (invoice_id);

-- ── 6. Number Sequences Seed for Payments ────────────────────────────────────

INSERT INTO number_sequences (doc_type, location_id, prefix, next_number, padding)
SELECT 'payment', id, code || '-PAY', 1, 4
FROM locations
ON CONFLICT (doc_type, location_id) DO NOTHING;

-- ── 7. Triggers ──────────────────────────────────────────────────────────────

-- 7.1 Payment State Machine and Immutability Trigger
CREATE OR REPLACE FUNCTION fn_payments_state_machine()
RETURNS TRIGGER AS $$
BEGIN
    -- Terminal states cannot transition to anything else
    IF OLD.status IN ('failed', 'reversed') THEN
        RAISE EXCEPTION 'Payments in status % are immutable', OLD.status;
    END IF;

    -- Validate status transitions
    IF NEW.status != OLD.status THEN
        IF NOT (
            (OLD.status = 'pending' AND NEW.status IN ('confirmed', 'failed')) OR
            (OLD.status = 'confirmed' AND NEW.status = 'reversed')
        ) THEN
            RAISE EXCEPTION 'Invalid payment status transition from % to %', OLD.status, NEW.status;
        END IF;
    END IF;

    -- Financial and method immutability once confirmed or when transitioning to confirmed/reversed
    IF OLD.status = 'confirmed' OR NEW.status = 'confirmed' OR NEW.status = 'reversed' THEN
        IF (NEW.amount_minor != OLD.amount_minor OR
            NEW.method != OLD.method OR
            NEW.customer_id != OLD.customer_id OR
            NEW.kind != OLD.kind OR
            NEW.idempotency_key != OLD.idempotency_key OR
            NEW.method_details::text != OLD.method_details::text OR
            NEW.payment_date != OLD.payment_date OR
            NEW.location_id != OLD.location_id OR
            NEW.currency != OLD.currency OR
            NEW.payment_number != OLD.payment_number OR
            COALESCE(NEW.provider_reference, '') != COALESCE(OLD.provider_reference, '')) THEN
            RAISE EXCEPTION 'Confirmed payment financial and identification fields cannot be modified';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payments_state_machine ON payments;
CREATE TRIGGER trg_payments_state_machine
    BEFORE UPDATE ON payments
    FOR EACH ROW EXECUTE FUNCTION fn_payments_state_machine();

-- 7.2 Payment Allocations Append-Only Trigger
CREATE OR REPLACE FUNCTION fn_payment_allocations_immutable()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'payment_allocations is append-only: UPDATE and DELETE are prohibited';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payment_allocations_immutable ON payment_allocations;
CREATE TRIGGER trg_payment_allocations_immutable
    BEFORE UPDATE OR DELETE ON payment_allocations
    FOR EACH ROW EXECUTE FUNCTION fn_payment_allocations_immutable();

-- 7.3 Allocation Limits Check Trigger
CREATE OR REPLACE FUNCTION fn_check_allocation_limits()
RETURNS TRIGGER AS $$
DECLARE
    v_payment_amount BIGINT;
    v_payment_status TEXT;
    v_payment_kind TEXT;
    v_payment_net_alloc BIGINT;
    v_invoice_status TEXT;
    v_invoice_type TEXT;
    v_invoice_total BIGINT;
    v_invoice_credited BIGINT;
    v_invoice_net_alloc BIGINT;
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

    -- Calculate net allocated for this payment including this new row
    SELECT COALESCE(SUM(amount_minor), 0) INTO v_payment_net_alloc
    FROM payment_allocations WHERE payment_id = NEW.payment_id;

    v_payment_net_alloc := v_payment_net_alloc + NEW.amount_minor;

    IF v_payment_net_alloc > v_payment_amount THEN
        RAISE EXCEPTION 'Allocation exceeds remaining payment amount (net allocated % > payment amount %)', v_payment_net_alloc, v_payment_amount;
    END IF;

    IF v_payment_net_alloc < 0 THEN
        RAISE EXCEPTION 'Negative allocation cannot exceed prior allocated amount (net allocated % < 0)', v_payment_net_alloc;
    END IF;

    -- Check invoice exists and is valid
    SELECT document_type, status, total_minor, credited_minor
    INTO v_invoice_type, v_invoice_status, v_invoice_total, v_invoice_credited
    FROM sales_documents WHERE id = NEW.invoice_id;

    IF v_invoice_type != 'invoice' THEN
        RAISE EXCEPTION 'Allocations can only be made to invoices (document type: %)', v_invoice_type;
    END IF;

    IF v_invoice_status != 'issued' THEN
        RAISE EXCEPTION 'Allocations can only be made to issued invoices (invoice status: %)', v_invoice_status;
    END IF;

    -- Calculate net allocated for this invoice including this new row
    SELECT COALESCE(SUM(amount_minor), 0) INTO v_invoice_net_alloc
    FROM payment_allocations WHERE invoice_id = NEW.invoice_id;

    v_invoice_net_alloc := v_invoice_net_alloc + NEW.amount_minor;

    IF v_invoice_net_alloc > (v_invoice_total - v_invoice_credited) THEN
        RAISE EXCEPTION 'Allocation exceeds remaining invoice balance (net allocated % > invoice net total %)', v_invoice_net_alloc, (v_invoice_total - v_invoice_credited);
    END IF;

    IF v_invoice_net_alloc < 0 THEN
        RAISE EXCEPTION 'Negative allocation cannot exceed prior allocated amount on invoice (net allocated % < 0)', v_invoice_net_alloc;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_allocation_limits ON payment_allocations;
CREATE TRIGGER trg_check_allocation_limits
    BEFORE INSERT ON payment_allocations
    FOR EACH ROW EXECUTE FUNCTION fn_check_allocation_limits();

-- 7.4 Re-affirm Sales Document Immutability
-- Allows updates to system fields: paid_minor, balance_minor, payment_status, credited_minor, delivery_status, eis_*
CREATE OR REPLACE FUNCTION fn_sales_documents_immutability()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status = 'issued' OR OLD.is_immutable = TRUE THEN
        -- Block changes to critical financial and identification fields
        IF (NEW.document_type != OLD.document_type OR
            NEW.document_number != OLD.document_number OR
            NEW.customer_id != OLD.customer_id OR
            NEW.location_id != OLD.location_id OR
            NEW.issue_date != OLD.issue_date OR
            NEW.due_date != OLD.due_date OR
            NEW.currency != OLD.currency OR
            NEW.exchange_rate != OLD.exchange_rate OR
            NEW.subtotal_minor != OLD.subtotal_minor OR
            NEW.discount_minor != OLD.discount_minor OR
            NEW.tax_minor != OLD.tax_minor OR
            NEW.total_minor != OLD.total_minor) THEN
            RAISE EXCEPTION 'Issued sales document financial fields cannot be modified';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
