# Supabase setup (Phase 0)

The Fastify API is the **only** consumer of the database and connects via a
dedicated `prisma` role that **bypasses RLS**. RLS is enabled deny-by-default on
every `public` table as defense-in-depth. Prisma owns the `public` schema; do
**not** make schema changes in the dashboard SQL editor (Prisma would treat them
as drift and may try to reset).

## Order of operations (first deploy)

1. **Bootstrap the Prisma role** (once, as `postgres`): run
   [`bootstrap_prisma_role.sql`](./bootstrap_prisma_role.sql) in the SQL editor.
   Put the chosen password into `DATABASE_URL` (port `6543`, `?pgbouncer=true`)
   and `DIRECT_URL` (port `5432`) in `.env`.
2. **Apply migrations**: `pnpm db:deploy` (runs `prisma migrate deploy`). This
   creates all `public` tables, then the security migration (RLS policies, the
   audit append-only trigger, `custom_access_token_hook`, and the `brand-logos`
   storage bucket + path-scoped policies).
3. **Enable the access-token hook**: Supabase dashboard → **Auth → Hooks →
   Custom Access Token** → select `public.custom_access_token_hook`. (Local dev:
   already wired in `config.toml`.)
4. **Disable the Data API (PostgREST)**: dashboard → **Project Settings → API →
   Data API** → off. The API is the only DB path; `supabase-js` is used only for
   brand **Auth** and **Storage**.
5. **Seed the first super_admin**: `pnpm seed:superadmin` (forces TOTP enrollment
   on first login).

## Where the security SQL lives

All RLS / trigger / hook DDL is a **Prisma migration**
(`packages/db/prisma/migrations/00000000000001_security_rls_hook_audit/`) so
Prisma is the single source of truth and sees no drift. This file documents the
two things Prisma can't own: the bootstrap role (it connects *as* that role) and
the dashboard toggles (hook enablement, PostgREST off).
