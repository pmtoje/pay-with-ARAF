-- Provision AltMall's own schema inside a shared Pay with ARAF database (e.g. one Supabase project).
-- Run as an admin role (Supabase: `postgres` via the SQL editor). Replace the password placeholder
-- with a strong secret from the Bank's secrets manager, then put the same password in
-- ALTMALL_DATABASE_URL for the altmall_app role. Never commit the real password.
--
-- Idempotent: re-running keeps the existing role/password and only re-applies schema grants, so it is
-- safe after new tables are created by another role. If the role already exists and its password is
-- unknown, rotate it in Supabase (Settings → Database → Roles) instead of re-running with a new
-- placeholder.
--
-- Local Docker keeps a separate `altmall` database (infrastructure/docker/init-altmall.sql) and does
-- not need this file.

DO $$
DECLARE
  schema_name text := 'altmall';
  role_name text := 'altmall_app';
  role_password text := '<SET-A-STRONG-PASSWORD>';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
    IF role_password = '<SET-A-STRONG-PASSWORD>' THEN
      RAISE EXCEPTION 'Set a strong password for % before running this script', role_name;
    END IF;
    EXECUTE format(
      'CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
      role_name, role_password
    );
  END IF;

  -- Ensure the application role can connect (PUBLIC normally can, but Supabase hardens some roles).
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), role_name);

  EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', schema_name);
  EXECUTE format('REVOKE ALL ON SCHEMA %I FROM PUBLIC', schema_name);
  EXECUTE format('GRANT USAGE, CREATE ON SCHEMA %I TO %I', schema_name, role_name);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO %I', schema_name, role_name);
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO %I', schema_name, role_name);
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
    schema_name, role_name
  );
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO %I',
    schema_name, role_name
  );

  -- Default the role's search_path so the app is correct even through a transaction pooler that
  -- ignores per-connection startup options.
  EXECUTE format('ALTER ROLE %I IN DATABASE %I SET search_path = %I, public', role_name, current_database(), schema_name);
END
$$;
