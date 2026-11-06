-- Migration 0010: Create non-owner runtime database role for the application.
-- The runtime role (ace_app_user) has DML access on all tables EXCEPT:
--   - audit_log: append-only (cannot UPDATE, DELETE, TRUNCATE)
--   - journal_batches, journal_lines, journal_source_events: append-only (cannot UPDATE, DELETE, TRUNCATE)
-- The role cannot execute DDL, cannot drop triggers, and cannot TRUNCATE protected tables.

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ace_app_user') THEN
    CREATE ROLE ace_app_user LOGIN PASSWORD 'AceApp2026Secure!';
  END IF;
END $$;

-- Grant connection and schema access
DO $$ BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO ace_app_user', current_database());
END $$;
GRANT USAGE ON SCHEMA public TO ace_app_user;

-- Grant full DML on all current tables
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ace_app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ace_app_user;

-- Revoke dangerous privileges on protected tables
-- audit_log: append-only via writeAuditLog — runtime role can INSERT but NOT UPDATE/DELETE/TRUNCATE
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE audit_log FROM ace_app_user;

-- journal tables: append-only double-entry — runtime role can INSERT but NOT UPDATE/DELETE/TRUNCATE
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE journal_batches FROM ace_app_user;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE journal_lines FROM ace_app_user;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE journal_source_events FROM ace_app_user;

-- No DDL (cannot CREATE/DROP/ALTER tables, cannot drop triggers)
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM ace_app_user;

-- Set default privileges for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ace_app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO ace_app_user;

COMMENT ON ROLE ace_app_user IS 'Runtime application role. No DDL, no UPDATE/DELETE/TRUNCATE on audit and journal tables.';

