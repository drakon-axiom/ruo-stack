-- ════════════════════════════════════════════════════════════════════════════
-- CI ONLY — vanilla-Postgres stand-ins for the Supabase-managed objects the
-- migrations reference. Run ONCE against a throwaway database before
-- `prisma migrate deploy` so migrations can be verified off Supabase.
--
-- NEVER run this against a real Supabase project: there these roles and the
-- `auth` schema already exist, owned by Supabase, with real semantics.
--
-- What the migrations need that stock Postgres lacks:
--   • roles anon / authenticated / service_role   — RLS policy targets (`TO authenticated`)
--   • role supabase_auth_admin                    — access-token-hook grants + read policies
--   • auth.uid()                                  — tenant predicate in brand RLS policies
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Supabase's API roles. NOLOGIN: they are only ever policy/grant targets here.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
  -- The role Supabase Auth uses to mint tokens; the custom_access_token_hook is
  -- granted EXECUTE on it and reads brand_user_role / brand_member through it.
  -- Deliberately NOT bypassrls, mirroring Supabase — that is exactly why the
  -- migrations must also add permissive SELECT policies for it.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    CREATE ROLE supabase_auth_admin NOLOGIN NOINHERIT;
  END IF;
END
$$;

-- 2. The `auth` schema and a stand-in `auth.uid()`. On Supabase this reads the
--    verified JWT `sub` claim; the same request-local GUC shape works here, so
--    policies compile and evaluate identically (NULL when no claim is set).
CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role, supabase_auth_admin;

-- 3. Mirror the bootstrap's schema grants (see bootstrap_prisma_role.sql). CI runs
--    migrations as the owning superuser, so no separate `prisma` role is needed —
--    the API's runtime role and CI's migration role are the same connection.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, supabase_auth_admin;
