-- Docker Postgres initialisation script.
-- Creates the migration test database and the app runtime role.
-- Runs once when the container is first created.

-- Migration/throwaway test database (for schema reproducibility test)
CREATE DATABASE acemigrationtest OWNER aceowner;

-- Runtime application role (mirrors production setup; no hardcoded password needed locally)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ace_app_user') THEN
    CREATE ROLE ace_app_user LOGIN PASSWORD 'ace_app_user_local';
  END IF;
END $$;

-- Grant connect on both databases
GRANT CONNECT ON DATABASE acetest TO ace_app_user;
GRANT CONNECT ON DATABASE acemigrationtest TO ace_app_user;

