-- ============================================================
-- Migration 0000: PostgreSQL extensions
-- ============================================================
-- pgcrypto    → gen_random_uuid()
-- citext      → case-insensitive text for emails
-- pg_trgm     → trigram indexes for product name search (Phase 1)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
