-- ════════════════════════════════════════════════════════════════════════════
-- ONE-TIME bootstrap — run ONCE as the `postgres` superuser in the Supabase SQL
-- editor (or via psql on DIRECT_URL with the postgres password) BEFORE the first
-- Prisma migrate deploy. This creates the dedicated, RLS-bypassing role the API
-- uses. It is NOT a Prisma migration (Prisma connects *as* this role — chicken
-- and egg) and must not be re-run.
--
-- Per Supabase's Prisma guidance:
--   https://supabase.com/docs/guides/database/prisma
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Dedicated Prisma role: bypasses RLS (authz is enforced in app code) and can
--    run migrations. Replace the password and put it in DATABASE_URL/DIRECT_URL.
CREATE USER "prisma" WITH PASSWORD 'REPLACE_WITH_STRONG_PASSWORD' BYPASSRLS CREATEDB;

-- 2. Let postgres manage objects this role creates (and vice-versa).
GRANT "prisma" TO "postgres";

-- 3. Schema + object privileges on public (Prisma owns public).
GRANT USAGE, CREATE ON SCHEMA public TO "prisma";
GRANT ALL ON ALL TABLES IN SCHEMA public TO "prisma";
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO "prisma";
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO "prisma";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "prisma";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO "prisma";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "prisma";

-- The security migration also references storage.* (bucket + object policies);
-- allow this role to manage those objects during migrate deploy.
GRANT USAGE ON SCHEMA storage TO "prisma";
GRANT ALL ON ALL TABLES IN SCHEMA storage TO "prisma";
