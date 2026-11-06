-- Migration 0011: Milestone 7 Accounting & General Ledger Invariants
-- Refines append-only trigger on journal_batches to ensure financial amounts and periods
-- are strictly immutable, while permitting export tracking metadata (status, exported_at, re_export_*).
-- Grants runtime role privileges for ace_app_user on accounting tables.

CREATE OR REPLACE FUNCTION prevent_journal_batch_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.batch_number IS DISTINCT FROM NEW.batch_number
     OR OLD.period_start IS DISTINCT FROM NEW.period_start
     OR OLD.period_end IS DISTINCT FROM NEW.period_end
     OR OLD.total_debit_minor IS DISTINCT FROM NEW.total_debit_minor
     OR OLD.total_credit_minor IS DISTINCT FROM NEW.total_credit_minor
     OR OLD.line_count IS DISTINCT FROM NEW.line_count THEN
    RAISE EXCEPTION 'journal batches financial totals and periods are append-only and immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS journal_batches_no_update_trg ON journal_batches;
CREATE TRIGGER journal_batches_no_update_trg
  BEFORE UPDATE ON journal_batches
  FOR EACH ROW EXECUTE FUNCTION prevent_journal_batch_mutation();

-- Ensure runtime role (ace_app_user) has appropriate privileges on accounting tables
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'ace_app_user') THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE account_mappings TO ace_app_user;
    GRANT SELECT, INSERT ON TABLE journal_source_events TO ace_app_user;
    GRANT SELECT, INSERT, UPDATE ON TABLE journal_batches TO ace_app_user;
    GRANT SELECT, INSERT ON TABLE journal_lines TO ace_app_user;

    -- Reinforce: runtime role CANNOT DELETE or TRUNCATE journal tables
    REVOKE DELETE, TRUNCATE ON TABLE journal_batches FROM ace_app_user;
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE journal_lines FROM ace_app_user;
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE journal_source_events FROM ace_app_user;
  END IF;
END $$;

