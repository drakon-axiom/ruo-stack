-- ════════════════════════════════════════════════════════════════════════════
-- ONE-TIME bootstrap — run ONCE as the `postgres` role (Supabase dashboard SQL
-- editor, or psql on the session pooler) BEFORE the first `prisma migrate deploy`.
-- Creates the dedicated, RLS-bypassing app role and makes it own `public`.
--
-- Role split (see supabase/README.md):
--   • DATABASE_URL  → `prisma` role  (bypassrls)  — RUNTIME app connection (6543).
--   • DIRECT_URL    → `postgres` role (privileged) — MIGRATIONS (5432). Required
--     because the RLS policies reference auth.uid(); only privileged roles have
--     USAGE on the `auth` schema, which a custom role cannot be granted (the
--     `auth` schema is owned by supabase_auth_admin). `postgres` is a member of
--     `prisma`, so it can create policies on prisma-owned tables.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Dedicated app role: bypasses RLS (authz is enforced in app code).
--    `postgres` has BYPASSRLS + CREATEROLE, so it can mint a bypassrls role
--    without being a superuser. Replace the password and put it in DATABASE_URL.
CREATE ROLE prisma WITH LOGIN PASSWORD 'REPLACE_WITH_STRONG_URL_SAFE_PASSWORD' BYPASSRLS CREATEDB NOSUPERUSER;

-- 2. Let postgres manage objects this role owns (and reassign ownership below).
GRANT prisma TO postgres;

-- 3. Make `prisma` own the public schema so the migration's access-token-hook
--    grants (GRANT … TO supabase_auth_admin) and policy creation succeed.
ALTER SCHEMA public OWNER TO prisma;
GRANT USAGE, CREATE ON SCHEMA public TO prisma;

-- 4. Supabase API roles: usage + default privileges on objects `prisma` creates
--    (RLS gates the rows; broad grants mirror Supabase conventions).
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE prisma IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE prisma IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE prisma IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

-- NOTE: the `init` migration intentionally omits `CREATE SCHEMA public` (it
-- already exists on Supabase, and CREATE SCHEMA needs CREATE-on-database which
-- the app role does not hold).
