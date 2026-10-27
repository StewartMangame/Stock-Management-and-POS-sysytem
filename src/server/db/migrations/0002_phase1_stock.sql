-- ============================================================
-- Migration 0002: Phase 1 — Stock Management, Catalog, Purchasing, and Inventory Ledger
-- ============================================================

-- ── 1. Categories ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    code        TEXT NOT NULL UNIQUE,
    description TEXT,
    parent_id   UUID REFERENCES categories (id) ON DELETE SET NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ,
    created_by  UUID REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS categories_parent_idx ON categories (parent_id);

-- ── 2. Units of Measure ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS units_of_measure (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,
    code          TEXT NOT NULL UNIQUE,
    symbol        TEXT NOT NULL,
    allow_decimal BOOLEAN NOT NULL DEFAULT FALSE,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3. Products ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS products (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT NOT NULL,
    sku                 CITEXT NOT NULL UNIQUE,
    barcode             TEXT UNIQUE,
    description         TEXT,
    category_id         UUID REFERENCES categories (id) ON DELETE SET NULL,
    uom_id              UUID NOT NULL REFERENCES units_of_measure (id) ON DELETE RESTRICT,
    product_type        TEXT NOT NULL DEFAULT 'standard' CHECK (product_type IN ('standard', 'bundle', 'service')),
    avg_cost_minor      BIGINT NOT NULL DEFAULT 0,
    last_cost_minor     BIGINT NOT NULL DEFAULT 0,
    selling_price_minor BIGINT NOT NULL DEFAULT 0,
    tax_rate_id         UUID REFERENCES tax_rates (id) ON DELETE SET NULL,
    min_stock_alert     NUMERIC(14,3) DEFAULT 0,
    max_stock           NUMERIC(14,3),
    serial_tracking     BOOLEAN NOT NULL DEFAULT FALSE,
    warranty_months     INTEGER NOT NULL DEFAULT 0,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ,
    created_by          UUID REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS products_category_idx ON products (category_id);
CREATE INDEX IF NOT EXISTS products_type_idx ON products (product_type);
CREATE INDEX IF NOT EXISTS products_active_idx ON products (is_active);
CREATE INDEX IF NOT EXISTS products_name_trgm_idx ON products USING gin (name gin_trgm_ops);

-- ── 4. Product Bundles ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS product_bundles (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bundle_product_id    UUID NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    component_product_id UUID NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
    quantity             NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
    CONSTRAINT product_bundles_pair_idx UNIQUE (bundle_product_id, component_product_id)
);

-- ── 5. Stock Balances ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS stock_balances (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      UUID NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    location_id     UUID NOT NULL REFERENCES locations (id) ON DELETE CASCADE,
    on_hand         NUMERIC(14,3) NOT NULL DEFAULT 0,
    reserved        NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (reserved >= 0),
    available       NUMERIC(14,3) GENERATED ALWAYS AS (on_hand - reserved) STORED,
    last_counted_at TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ,
    CONSTRAINT stock_balances_reserved_lte_on_hand CHECK (reserved <= on_hand),
    CONSTRAINT stock_balances_product_location_idx UNIQUE (product_id, location_id)
);

-- ── 6. Stock Movements (Immutable Ledger) ─────────────────────

CREATE TABLE IF NOT EXISTS stock_movements (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seq              BIGINT GENERATED ALWAYS AS IDENTITY,
    product_id       UUID NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
    location_id      UUID NOT NULL REFERENCES locations (id) ON DELETE RESTRICT,
    movement_type    TEXT NOT NULL CHECK (movement_type IN (
        'opening', 'purchase_receipt', 'sale_delivery', 'customer_return',
        'supplier_return', 'adjustment', 'count_variance', 'transfer_in', 'transfer_out'
    )),
    quantity         NUMERIC(14,3) NOT NULL,
    unit_cost_minor  BIGINT NOT NULL DEFAULT 0,
    total_cost_minor BIGINT NOT NULL DEFAULT 0,
    reference_type   TEXT NOT NULL CHECK (reference_type IN (
        'goods_receipt', 'stock_adjustment', 'stock_count', 'opening_stock'
    )),
    reference_id     UUID,
    notes            TEXT,
    occurred_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by       UUID REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS stock_movements_prod_loc_occurred_idx ON stock_movements (product_id, location_id, occurred_at);
CREATE INDEX IF NOT EXISTS stock_movements_ref_idx ON stock_movements (reference_type, reference_id);
CREATE INDEX IF NOT EXISTS stock_movements_seq_idx ON stock_movements (seq);

-- Immutable Ledger Trigger (blocks UPDATE and DELETE)
CREATE OR REPLACE FUNCTION trg_prevent_stock_movement_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'stock_movements is an append-only ledger: UPDATE and DELETE are prohibited';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_movements_immutable ON stock_movements;
CREATE TRIGGER trg_stock_movements_immutable
BEFORE UPDATE OR DELETE ON stock_movements
FOR EACH ROW EXECUTE FUNCTION trg_prevent_stock_movement_mutation();

-- ── 7. Serial Numbers ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS serial_numbers (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id           UUID NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
    serial_number        TEXT NOT NULL,
    status               TEXT NOT NULL DEFAULT 'in_stock' CHECK (status IN (
        'in_stock', 'reserved', 'sold', 'returned', 'written_off', 'adjusted_out'
    )),
    location_id          UUID REFERENCES locations (id) ON DELETE SET NULL,
    goods_receipt_item_id UUID,
    last_movement_id     UUID REFERENCES stock_movements (id) ON DELETE SET NULL,
    warranty_start       DATE,
    warranty_end         DATE,
    customer_id          UUID, -- Unconstrained until Phase 2 customers table
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS serial_numbers_prod_lower_idx ON serial_numbers (product_id, lower(serial_number));
CREATE INDEX IF NOT EXISTS serial_numbers_status_idx ON serial_numbers (status);
CREATE INDEX IF NOT EXISTS serial_numbers_location_idx ON serial_numbers (location_id);

-- ── 8. Suppliers ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS suppliers (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code               TEXT NOT NULL UNIQUE,
    name               TEXT NOT NULL,
    contact_name       TEXT,
    email              CITEXT,
    phone              TEXT,
    address            TEXT,
    tax_number         TEXT,
    default_currency   CHAR(3) NOT NULL DEFAULT 'MWK',
    payment_terms_days INTEGER NOT NULL DEFAULT 30,
    is_active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ,
    created_by         UUID REFERENCES users (id) ON DELETE SET NULL
);

-- ── 9. Purchase Orders ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS purchase_orders (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_number               TEXT NOT NULL UNIQUE,
    supplier_id             UUID NOT NULL REFERENCES suppliers (id) ON DELETE RESTRICT,
    location_id             UUID NOT NULL REFERENCES locations (id) ON DELETE RESTRICT,
    status                  TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'partially_received', 'received', 'cancelled')),
    order_date              DATE NOT NULL,
    expected_delivery_date  DATE,
    currency                CHAR(3) NOT NULL DEFAULT 'MWK',
    exchange_rate           NUMERIC(18,6) NOT NULL DEFAULT 1.000000,
    total_minor             BIGINT NOT NULL DEFAULT 0,
    total_supplier_currency NUMERIC(18,4) NOT NULL DEFAULT 0,
    notes                   TEXT,
    approved_by             UUID REFERENCES users (id) ON DELETE SET NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ,
    created_by              UUID REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS purchase_orders_supplier_idx ON purchase_orders (supplier_id);
CREATE INDEX IF NOT EXISTS purchase_orders_status_idx ON purchase_orders (status);

CREATE TABLE IF NOT EXISTS purchase_order_items (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id    UUID NOT NULL REFERENCES purchase_orders (id) ON DELETE CASCADE,
    product_id           UUID NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
    ordered_qty          NUMERIC(14,3) NOT NULL CHECK (ordered_qty > 0),
    received_qty         NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
    unit_cost_supplier   NUMERIC(18,4) NOT NULL,
    line_total_supplier  NUMERIC(18,4) NOT NULL,
    unit_cost_mwk_minor  BIGINT NOT NULL
);

-- ── 10. Goods Receipts, Items & Landed Costs ───────────────────

CREATE TABLE IF NOT EXISTS goods_receipts (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grn_number              TEXT NOT NULL UNIQUE,
    purchase_order_id       UUID REFERENCES purchase_orders (id) ON DELETE SET NULL,
    supplier_id             UUID NOT NULL REFERENCES suppliers (id) ON DELETE RESTRICT,
    location_id             UUID NOT NULL REFERENCES locations (id) ON DELETE RESTRICT,
    status                  TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'void')),
    supplier_invoice_number TEXT,
    received_date           DATE NOT NULL,
    currency                CHAR(3) NOT NULL DEFAULT 'MWK',
    exchange_rate           NUMERIC(18,6) NOT NULL DEFAULT 1.000000,
    total_items_mwk_minor   BIGINT NOT NULL DEFAULT 0,
    total_landed_mwk_minor  BIGINT NOT NULL DEFAULT 0,
    notes                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by              UUID REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS goods_receipts_po_idx ON goods_receipts (purchase_order_id);
CREATE INDEX IF NOT EXISTS goods_receipts_supplier_idx ON goods_receipts (supplier_id);

CREATE TABLE IF NOT EXISTS landed_costs (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    goods_receipt_id UUID NOT NULL REFERENCES goods_receipts (id) ON DELETE CASCADE,
    cost_type        TEXT NOT NULL CHECK (cost_type IN ('freight', 'duty', 'clearing', 'other')),
    amount           NUMERIC(18,4) NOT NULL,
    currency         CHAR(3) NOT NULL DEFAULT 'MWK',
    exchange_rate    NUMERIC(18,6) NOT NULL DEFAULT 1.000000,
    amount_mwk_minor BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS landed_costs_grn_idx ON landed_costs (goods_receipt_id);

CREATE TABLE IF NOT EXISTS goods_receipt_items (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    goods_receipt_id        UUID NOT NULL REFERENCES goods_receipts (id) ON DELETE CASCADE,
    po_item_id              UUID REFERENCES purchase_order_items (id) ON DELETE SET NULL,
    product_id              UUID NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
    received_qty            NUMERIC(14,3) NOT NULL CHECK (received_qty > 0),
    unit_cost_supplier      NUMERIC(18,4) NOT NULL,
    unit_cost_mwk_minor     BIGINT NOT NULL,
    landed_cost_share_minor BIGINT NOT NULL DEFAULT 0,
    landed_unit_cost_minor  BIGINT NOT NULL,
    line_total_mwk_minor    BIGINT NOT NULL
);

-- Backfill FK from serial_numbers.goods_receipt_item_id
ALTER TABLE serial_numbers ADD CONSTRAINT serial_numbers_grn_item_fk
    FOREIGN KEY (goods_receipt_item_id) REFERENCES goods_receipt_items (id) ON DELETE SET NULL;

-- ── 11. Stock Adjustments ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS stock_adjustments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    adj_number  TEXT NOT NULL UNIQUE,
    location_id UUID NOT NULL REFERENCES locations (id) ON DELETE RESTRICT,
    type        TEXT NOT NULL CHECK (type IN ('in', 'out')),
    reason      TEXT NOT NULL CHECK (reason IN ('damaged', 'expired', 'internal_use', 'found', 'correction')),
    status      TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'void')),
    notes       TEXT,
    approved_by UUID REFERENCES users (id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by  UUID REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS stock_adjustment_items (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    adjustment_id  UUID NOT NULL REFERENCES stock_adjustments (id) ON DELETE CASCADE,
    product_id     UUID NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
    quantity       NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
    unit_cost_minor BIGINT NOT NULL,
    total_cost_minor BIGINT NOT NULL,
    serial_numbers TEXT[]
);

-- ── 12. Stock Counts ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS stock_counts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    count_number  TEXT NOT NULL UNIQUE,
    location_id   UUID NOT NULL REFERENCES locations (id) ON DELETE RESTRICT,
    status        TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'reconciled', 'cancelled')),
    counted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reconciled_at TIMESTAMPTZ,
    reconciled_by UUID REFERENCES users (id) ON DELETE SET NULL,
    notes         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by    UUID REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS stock_count_items (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    count_id             UUID NOT NULL REFERENCES stock_counts (id) ON DELETE CASCADE,
    product_id           UUID NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
    system_qty           NUMERIC(14,3) NOT NULL,
    counted_qty          NUMERIC(14,3) NOT NULL CHECK (counted_qty >= 0),
    variance_qty         NUMERIC(14,3) NOT NULL,
    unit_cost_minor      BIGINT NOT NULL,
    variance_value_minor BIGINT NOT NULL,
    missing_serial_ids   UUID[]
);
