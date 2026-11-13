-- Migration 0013: Cron heartbeat table and runtime role future privileges
-- 1. Create cron_runs table for heartbeat and worker alive checks
CREATE TABLE IF NOT EXISTS cron_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  error_message TEXT,
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS cron_runs_job_name_idx ON cron_runs (job_name);
CREATE INDEX IF NOT EXISTS cron_runs_started_at_idx ON cron_runs (started_at);
CREATE INDEX IF NOT EXISTS cron_runs_job_status_idx ON cron_runs (job_name, status, completed_at);

-- 2. Grant permissions to runtime role ace_app_user if it exists
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'ace_app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON cron_runs TO ace_app_user;
    
    -- Ensure future tables and sequences inherit privileges for runtime role
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ace_app_user;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO ace_app_user;
  END IF;
END $$;

