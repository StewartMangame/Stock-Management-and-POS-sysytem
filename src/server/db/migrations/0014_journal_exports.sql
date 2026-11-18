-- Migration 0014: Journal Exports Table & Fully Append-Only Batches
-- Restores journal_batches to strict append-only (ZERO updates permitted).
-- All batch export events and re-export approvals are tracked in an insert-only journal_batch_exports table.

CREATE TABLE IF NOT EXISTS journal_batch_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES journal_batches(id) ON DELETE CASCADE,
  export_type TEXT NOT NULL DEFAULT 'initial',
  exported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  exported_by UUID REFERENCES users(id) ON DELETE SET NULL,
  re_export_approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  re_export_approved_at TIMESTAMPTZ,
  re_export_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS journal_batch_exports_batch_idx ON journal_batch_exports(batch_id);
CREATE INDEX IF NOT EXISTS journal_batch_exports_type_idx ON journal_batch_exports(export_type);

-- Trigger blocking UPDATE and DELETE on journal_batch_exports (insert-only)
CREATE OR REPLACE FUNCTION prevent_journal_batch_exports_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'journal_batch_exports is append-only: UPDATE and DELETE are prohibited';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS journal_batch_exports_no_update_trg ON journal_batch_exports;
CREATE TRIGGER journal_batch_exports_no_update_trg
  BEFORE UPDATE OR DELETE ON journal_batch_exports
  FOR EACH ROW EXECUTE FUNCTION prevent_journal_batch_exports_mutation();

-- Restore prevent_journal_batch_mutation() on journal_batches to block ALL updates unconditionally
CREATE OR REPLACE FUNCTION prevent_journal_batch_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'journal batches are append-only: UPDATE and DELETE are prohibited';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS journal_batches_no_update_trg ON journal_batches;
CREATE TRIGGER journal_batches_no_update_trg
  BEFORE UPDATE OR DELETE ON journal_batches
  FOR EACH ROW EXECUTE FUNCTION prevent_journal_batch_mutation();

-- Grants for ace_app_user: no UPDATE on journal_batches, SELECT and INSERT on journal_batch_exports
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'ace_app_user') THEN
    REVOKE UPDATE ON TABLE journal_batches FROM ace_app_user;
    GRANT SELECT, INSERT ON TABLE journal_batch_exports TO ace_app_user;
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE journal_batch_exports FROM ace_app_user;
  END IF;
END $$;

