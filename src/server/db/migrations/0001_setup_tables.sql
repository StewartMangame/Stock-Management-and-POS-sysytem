-- ============================================================
-- Migration 0001: Phase 0 — setup and security tables
-- ============================================================
-- Order matters: parents before children.
-- ============================================================

-- ── Locations ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS locations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT NOT NULL,
    code                TEXT NOT NULL,
    type                TEXT NOT NULL CHECK (type IN ('outlet', 'warehouse')),
    address             TEXT,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ,
    created_by          UUID   -- FK to users added below
);

CREATE UNIQUE INDEX locations_code_idx ON locations (code);

-- ── Roles ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS roles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    permissions     TEXT[] NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ,
    created_by      UUID
);

CREATE UNIQUE INDEX roles_name_idx ON roles (name);

-- ── Users ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                    TEXT NOT NULL,
    email                   CITEXT NOT NULL,
    password_hash           TEXT NOT NULL,
    role_id                 UUID REFERENCES roles (id) ON DELETE RESTRICT,
    default_location_id     UUID REFERENCES locations (id) ON DELETE SET NULL,
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    force_password_change   BOOLEAN NOT NULL DEFAULT FALSE,
    last_login_at           TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ,
    created_by              UUID REFERENCES users (id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX users_email_idx ON users (email);

-- Back-fill FK references from locations and roles to users
ALTER TABLE locations ADD CONSTRAINT locations_created_by_fk
    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL;

ALTER TABLE roles ADD CONSTRAINT roles_created_by_fk
    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL;

-- ── Settings ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS settings (
    key         TEXT PRIMARY KEY,
    value       JSONB NOT NULL,
    updated_at  TIMESTAMPTZ,
    updated_by  UUID REFERENCES users (id) ON DELETE SET NULL
);

-- ── Tax rates ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tax_rates (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT NOT NULL,
    rate_basis_points   INTEGER NOT NULL CHECK (rate_basis_points >= 0),
    is_default          BOOLEAN DEFAULT FALSE,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ,
    created_by          UUID REFERENCES users (id) ON DELETE SET NULL
);

-- Only one default tax rate at a time
CREATE UNIQUE INDEX tax_rates_default_idx ON tax_rates (is_default) WHERE is_default = TRUE;

-- ── Exchange rates ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS exchange_rates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    currency        CHAR(3) NOT NULL,
    rate_to_mwk     NUMERIC(18, 6) NOT NULL CHECK (rate_to_mwk > 0),
    effective_date  DATE NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by      UUID REFERENCES users (id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX exchange_rates_currency_date_idx ON exchange_rates (currency, effective_date);

-- ── Number sequences ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS number_sequences (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_type        TEXT NOT NULL,
    location_id     UUID REFERENCES locations (id) ON DELETE CASCADE,
    prefix          TEXT NOT NULL,
    next_number     BIGINT NOT NULL DEFAULT 1 CHECK (next_number >= 1),
    padding         INTEGER NOT NULL DEFAULT 4 CHECK (padding BETWEEN 1 AND 10),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ
);

CREATE UNIQUE INDEX number_sequences_doc_location_idx ON number_sequences (doc_type, location_id);

-- ── Audit log ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users (id) ON DELETE SET NULL,
    action      TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id   UUID,
    before      JSONB,
    after       JSONB,
    ip          INET,
    at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);
CREATE INDEX audit_log_at_idx     ON audit_log (at);
CREATE INDEX audit_log_user_idx   ON audit_log (user_id);

-- ── Attachments ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS attachments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL,
    entity_id   UUID NOT NULL,
    file_url    TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('slip_photo', 'supplier_invoice', 'signed_delivery_note', 'other')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by  UUID REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX attachments_entity_idx ON attachments (entity_type, entity_id);

-- ── Login attempts (rate limiting) ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS login_attempts (
    id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ip      TEXT NOT NULL,
    email   TEXT NOT NULL,
    success BOOLEAN NOT NULL,
    at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX login_attempts_ip_at_idx    ON login_attempts (ip,    at);
CREATE INDEX login_attempts_email_at_idx ON login_attempts (email, at);

-- Auto-purge login attempts older than 24 hours.
-- Run this as a scheduled job or include in the cleanup cron.
-- CREATE INDEX login_attempts_at_idx ON login_attempts (at);

COMMENT ON TABLE login_attempts IS
    'DB-backed login rate limiting. Rows older than 24h can be purged safely.';
