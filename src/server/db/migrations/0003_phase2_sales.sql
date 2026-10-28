-- ============================================================
-- Migration 0003: Phase 2 — Customers, Quotations, Sales Documents,
-- Stock Reservations, Delivery Notes & Credit Notes
-- ============================================================

-- ── 1. Customers ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS customers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_number      TEXT NOT NULL UNIQUE,
    name                TEXT NOT NULL,
    customer_type       TEXT NOT NULL DEFAULT 'individual' CHECK (customer_type IN ('individual', 'business', 'walk_in')),
    is_walk_in          BOOLEAN NOT NULL DEFAULT FALSE,
    email               CITEXT,
    phone               TEXT,
    address             TEXT,
    tax_number          TEXT,
    credit_limit_minor  BIGINT NOT NULL DEFAULT 0 CHECK (credit_limit_minor >= 0),
    payment_terms_days  INTEGER NOT NULL DEFAULT 30 CHECK (payment_terms_days >= 0),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ,
    created_by          UUID REFERENCES users (id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS customers_walk_in_unique_idx
    ON customers (is_walk_in) WHERE is_walk_in = TRUE;

CREATE INDEX IF NOT EXISTS customers_name_idx ON customers (name);
CREATE INDEX IF NOT EXISTS customers_type_idx ON customers (customer_type);
CREATE INDEX IF NOT EXISTS customers_active_idx ON customers (is_active);

-- Seed protected Walk-in Customer
INSERT INTO customers (account_number, name, customer_type, is_walk_in, credit_limit_minor, payment_terms_days)
VALUES ('WALK-IN', 'Walk-in Customer', 'walk_in', TRUE, 0, 0)
ON CONFLICT (account_number) DO NOTHING;

-- Trigger: Protect Walk-in Customer from deletion and core mutation
CREATE OR REPLACE FUNCTION fn_prevent_walk_in_mutation()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' AND OLD.is_walk_in THEN
        RAISE EXCEPTION 'Walk-in customer cannot be deleted';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.is_walk_in AND (
        NEW.is_walk_in = FALSE OR
        NEW.customer_type != 'walk_in' OR
        NEW.account_number != 'WALK-IN'
    ) THEN
        RAISE EXCEPTION 'Walk-in customer core properties cannot be altered';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_walk_in_mutation ON customers;
CREATE TRIGGER trg_prevent_walk_in_mutation
    BEFORE UPDATE OR DELETE ON customers
    FOR EACH ROW EXECUTE FUNCTION fn_prevent_walk_in_mutation();

-- ── 2. Add customer foreign key to serial_numbers ────────────

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'serial_numbers_customer_id_fkey'
    ) THEN
        ALTER TABLE serial_numbers
            ADD CONSTRAINT serial_numbers_customer_id_fkey
            FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS serial_numbers_customer_idx ON serial_numbers (customer_id);

-- ── 3. Stock Reservations ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS stock_reservations (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id           UUID NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
    location_id          UUID NOT NULL REFERENCES locations (id) ON DELETE RESTRICT,
    source_document_type TEXT NOT NULL CHECK (source_document_type IN ('quotation', 'sales_document')),
    source_document_id   UUID NOT NULL,
    source_line_id       UUID NOT NULL,
    reserved_qty         NUMERIC(14,3) NOT NULL CHECK (reserved_qty >= 0),
    fulfilled_qty        NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (fulfilled_qty >= 0),
    status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released', 'fulfilled')),
    reserved_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS stock_reservations_prod_loc_idx ON stock_reservations (product_id, location_id);
CREATE INDEX IF NOT EXISTS stock_reservations_source_idx ON stock_reservations (source_document_type, source_document_id);
CREATE INDEX IF NOT EXISTS stock_reservations_status_idx ON stock_reservations (status);
CREATE INDEX IF NOT EXISTS stock_reservations_expires_idx ON stock_reservations (expires_at);

-- ── 4. Quotations & Quotation Lines ───────────────────────────

CREATE TABLE IF NOT EXISTS quotations (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quotation_number  TEXT UNIQUE,
    customer_id       UUID NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
    location_id       UUID NOT NULL REFERENCES locations (id) ON DELETE RESTRICT,
    status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'converted', 'expired', 'cancelled')),
    quotation_date    DATE NOT NULL,
    valid_until       DATE NOT NULL,
    currency          CHAR(3) NOT NULL DEFAULT 'MWK',
    exchange_rate     NUMERIC(18,6) NOT NULL DEFAULT 1.000000,
    subtotal_minor    BIGINT NOT NULL DEFAULT 0,
    discount_minor    BIGINT NOT NULL DEFAULT 0,
    tax_minor         BIGINT NOT NULL DEFAULT 0,
    total_minor       BIGINT NOT NULL DEFAULT 0,
    requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
    approval_reason   TEXT,
    approved_by       UUID REFERENCES users (id) ON DELETE SET NULL,
    approved_at       TIMESTAMPTZ,
    notes             TEXT,
    terms             TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ,
    created_by        UUID REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS quotations_customer_idx ON quotations (customer_id);
CREATE INDEX IF NOT EXISTS quotations_status_idx ON quotations (status);
CREATE INDEX IF NOT EXISTS quotations_date_idx ON quotations (quotation_date);

CREATE TABLE IF NOT EXISTS quotation_lines (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quotation_id          UUID NOT NULL REFERENCES quotations (id) ON DELETE CASCADE,
    product_id            UUID NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
    sku                   TEXT NOT NULL,
    description           TEXT,
    quantity              NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
    unit_price_minor      BIGINT NOT NULL CHECK (unit_price_minor >= 0),
    discount_minor        BIGINT NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
    tax_rate_id           UUID NOT NULL REFERENCES tax_rates (id) ON DELETE RESTRICT,
    tax_rate_basis_points INTEGER NOT NULL CHECK (tax_rate_basis_points >= 0),
    tax_minor             BIGINT NOT NULL DEFAULT 0,
    line_total_minor      BIGINT NOT NULL DEFAULT 0,
    notes                 TEXT
);

CREATE INDEX IF NOT EXISTS quotation_lines_quotation_idx ON quotation_lines (quotation_id);

-- ── 5. Sales Documents (Invoices & Credit Notes) ──────────────

CREATE TABLE IF NOT EXISTS sales_documents (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_type       TEXT NOT NULL CHECK (document_type IN ('invoice', 'credit_note')),
    document_number     TEXT UNIQUE,
    source_document_id  UUID REFERENCES sales_documents (id) ON DELETE RESTRICT,
    source_quotation_id UUID REFERENCES quotations (id) ON DELETE SET NULL,
    customer_id         UUID NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
    location_id         UUID NOT NULL REFERENCES locations (id) ON DELETE RESTRICT,
    status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'void')),
    delivery_status     TEXT NOT NULL DEFAULT 'not_delivered' CHECK (delivery_status IN ('not_delivered', 'partly_delivered', 'delivered')),
    payment_status      TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'partly_paid', 'paid')),
    issue_date          DATE NOT NULL,
    due_date            DATE NOT NULL,
    currency            CHAR(3) NOT NULL DEFAULT 'MWK',
    exchange_rate       NUMERIC(18,6) NOT NULL DEFAULT 1.000000,
    subtotal_minor      BIGINT NOT NULL DEFAULT 0,
    discount_minor      BIGINT NOT NULL DEFAULT 0,
    tax_minor           BIGINT NOT NULL DEFAULT 0,
    total_minor         BIGINT NOT NULL DEFAULT 0,
    credited_minor      BIGINT NOT NULL DEFAULT 0,
    paid_minor          BIGINT NOT NULL DEFAULT 0,
    balance_minor       BIGINT NOT NULL DEFAULT 0,
    is_immutable        BOOLEAN NOT NULL DEFAULT FALSE,
    voided_at           TIMESTAMPTZ,
    voided_by           UUID REFERENCES users (id) ON DELETE SET NULL,
    void_reason         TEXT,
    requires_approval   BOOLEAN NOT NULL DEFAULT FALSE,
    approval_reason     TEXT,
    approved_by         UUID REFERENCES users (id) ON DELETE SET NULL,
    approved_at         TIMESTAMPTZ,
    notes               TEXT,
    terms               TEXT,
    eis_status          TEXT NOT NULL DEFAULT 'not_required' CHECK (eis_status IN ('not_required', 'pending', 'accepted', 'rejected', 'failed')),
    eis_reference       TEXT,
    eis_qr_code         TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ,
    created_by          UUID REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS sales_docs_customer_idx ON sales_documents (customer_id);
CREATE INDEX IF NOT EXISTS sales_docs_type_status_idx ON sales_documents (document_type, status);
CREATE INDEX IF NOT EXISTS sales_docs_issue_date_idx ON sales_documents (issue_date);
CREATE INDEX IF NOT EXISTS sales_docs_source_doc_idx ON sales_documents (source_document_id);
CREATE INDEX IF NOT EXISTS sales_docs_delivery_status_idx ON sales_documents (delivery_status);
CREATE INDEX IF NOT EXISTS sales_docs_payment_status_idx ON sales_documents (payment_status);

CREATE TABLE IF NOT EXISTS sales_document_lines (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id           UUID NOT NULL REFERENCES sales_documents (id) ON DELETE CASCADE,
    source_line_id        UUID REFERENCES sales_document_lines (id) ON DELETE RESTRICT,
    product_id            UUID NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
    sku                   TEXT NOT NULL,
    description           TEXT,
    quantity              NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
    unit_price_minor      BIGINT NOT NULL CHECK (unit_price_minor >= 0),
    discount_minor        BIGINT NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
    tax_rate_id           UUID NOT NULL REFERENCES tax_rates (id) ON DELETE RESTRICT,
    tax_rate_basis_points INTEGER NOT NULL CHECK (tax_rate_basis_points >= 0),
    tax_minor             BIGINT NOT NULL DEFAULT 0,
    line_total_minor      BIGINT NOT NULL DEFAULT 0,
    delivered_qty         NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (delivered_qty >= 0),
    credited_qty          NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (credited_qty >= 0),
    unit_cost_minor       BIGINT NOT NULL DEFAULT 0,
    return_goods          BOOLEAN NOT NULL DEFAULT FALSE,
    notes                 TEXT
);

CREATE INDEX IF NOT EXISTS sales_doc_lines_document_idx ON sales_document_lines (document_id);
CREATE INDEX IF NOT EXISTS sales_doc_lines_product_idx ON sales_document_lines (product_id);
CREATE INDEX IF NOT EXISTS sales_doc_lines_source_line_idx ON sales_document_lines (source_line_id);

-- ── 6. Immutability Triggers for Issued Documents ────────────

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

DROP TRIGGER IF EXISTS trg_sales_documents_immutability ON sales_documents;
CREATE TRIGGER trg_sales_documents_immutability
    BEFORE UPDATE ON sales_documents
    FOR EACH ROW EXECUTE FUNCTION fn_sales_documents_immutability();

CREATE OR REPLACE FUNCTION fn_sales_document_lines_immutability()
RETURNS TRIGGER AS $$
DECLARE
    doc_status TEXT;
    doc_immutable BOOLEAN;
BEGIN
    IF TG_OP = 'DELETE' THEN
        SELECT status, is_immutable INTO doc_status, doc_immutable
        FROM sales_documents WHERE id = OLD.document_id;
        IF doc_status = 'issued' OR doc_immutable = TRUE THEN
            RAISE EXCEPTION 'Lines cannot be deleted from an issued sales document';
        END IF;
        RETURN OLD;
    ELSIF TG_OP = 'INSERT' THEN
        SELECT status, is_immutable INTO doc_status, doc_immutable
        FROM sales_documents WHERE id = NEW.document_id;
        IF doc_status = 'issued' OR doc_immutable = TRUE THEN
            RAISE EXCEPTION 'Lines cannot be added to an issued sales document';
        END IF;
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        SELECT status, is_immutable INTO doc_status, doc_immutable
        FROM sales_documents WHERE id = OLD.document_id;
        IF doc_status = 'issued' OR doc_immutable = TRUE THEN
            IF (NEW.product_id != OLD.product_id OR
                NEW.sku != OLD.sku OR
                NEW.quantity != OLD.quantity OR
                NEW.unit_price_minor != OLD.unit_price_minor OR
                NEW.discount_minor != OLD.discount_minor OR
                NEW.tax_rate_id != OLD.tax_rate_id OR
                NEW.tax_rate_basis_points != OLD.tax_rate_basis_points OR
                NEW.tax_minor != OLD.tax_minor OR
                NEW.line_total_minor != OLD.line_total_minor OR
                NEW.source_line_id IS DISTINCT FROM OLD.source_line_id OR
                NEW.return_goods != OLD.return_goods) THEN
                RAISE EXCEPTION 'Issued sales document line pricing and quantity cannot be modified';
            END IF;
        END IF;
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sales_document_lines_immutability ON sales_document_lines;
CREATE TRIGGER trg_sales_document_lines_immutability
    BEFORE INSERT OR UPDATE OR DELETE ON sales_document_lines
    FOR EACH ROW EXECUTE FUNCTION fn_sales_document_lines_immutability();

-- ── 7. Delivery Notes & Lines ────────────────────────────────

CREATE TABLE IF NOT EXISTS delivery_notes (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_number      TEXT NOT NULL UNIQUE,
    sales_document_id    UUID NOT NULL REFERENCES sales_documents (id) ON DELETE RESTRICT,
    location_id          UUID NOT NULL REFERENCES locations (id) ON DELETE RESTRICT,
    customer_id          UUID NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
    delivery_date        DATE NOT NULL,
    status               TEXT NOT NULL DEFAULT 'dispatched' CHECK (status = 'dispatched'),
    notes                TEXT,
    received_by_customer TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ,
    created_by           UUID REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS delivery_notes_doc_idx ON delivery_notes (sales_document_id);
CREATE INDEX IF NOT EXISTS delivery_notes_customer_idx ON delivery_notes (customer_id);
CREATE INDEX IF NOT EXISTS delivery_notes_date_idx ON delivery_notes (delivery_date);

CREATE TABLE IF NOT EXISTS delivery_note_lines (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_note_id       UUID NOT NULL REFERENCES delivery_notes (id) ON DELETE CASCADE,
    sales_document_line_id UUID NOT NULL REFERENCES sales_document_lines (id) ON DELETE RESTRICT,
    product_id             UUID NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
    quantity               NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
    unit_cost_minor        BIGINT NOT NULL,
    total_cost_minor       BIGINT NOT NULL,
    is_bundle_component    BOOLEAN NOT NULL DEFAULT FALSE,
    bundle_product_id      UUID REFERENCES products (id) ON DELETE SET NULL,
    serial_numbers         TEXT[]
);

CREATE INDEX IF NOT EXISTS delivery_note_lines_note_idx ON delivery_note_lines (delivery_note_id);
CREATE INDEX IF NOT EXISTS delivery_note_lines_doc_line_idx ON delivery_note_lines (sales_document_line_id);
CREATE INDEX IF NOT EXISTS delivery_note_lines_product_idx ON delivery_note_lines (product_id);

-- ── 8. Settings & Number Sequences for Phase 2 ────────────────

INSERT INTO settings (key, value)
VALUES
    ('invoice_payment_instructions', '"Bank: National Bank of Malawi\nAccount: 1002345678\nBranch: Victoria Avenue, Blantyre"'::jsonb),
    ('reservation_hold_days', '14'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Ensure number sequence prefixes exist for all locations
DO $$
DECLARE
    loc RECORD;
BEGIN
    FOR loc IN SELECT id, code FROM locations LOOP
        INSERT INTO number_sequences (doc_type, location_id, prefix, next_number, padding)
        VALUES
            ('quotation', loc.id, loc.code || '-QT', 1, 4),
            ('invoice', loc.id, loc.code || '-INV', 1, 4),
            ('credit_note', loc.id, loc.code || '-CN', 1, 4),
            ('delivery_note', loc.id, loc.code || '-DN', 1, 4)
        ON CONFLICT (doc_type, location_id) DO NOTHING;
    END LOOP;
END $$;

-- Expand stock_movements.reference_type CHECK constraint to support 'delivery_note' and 'credit_note'
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_reference_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_reference_type_check CHECK (reference_type IN (
    'goods_receipt', 'stock_adjustment', 'stock_count', 'opening_stock', 'delivery_note', 'credit_note'
));

