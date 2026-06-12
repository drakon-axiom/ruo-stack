# Supabase setup (Phase 0)

The Fastify API is the **only** runtime consumer of the database and connects via
a dedicated `prisma` role that **bypasses RLS**. RLS is enabled deny-by-default on
every `public` table as defense-in-depth. The `prisma` role **owns** the `public`
schema. Do **not** make schema changes in the dashboard SQL editor (Prisma would
treat them as drift).

## Two roles, two connection strings

| Var | Role | Port | Used for | Why |
|---|---|---|---|---|
| `DATABASE_URL` | `prisma` (bypassrls) | 6543 `?pgbouncer=true` | **runtime** app queries | least-privilege app role; authz in app code |
| `DIRECT_URL` | `postgres` (privileged) | 5432 (session pooler) | **migrations** | RLS policies reference `auth.uid()`; only privileged roles have `auth`-schema usage (a custom role can't be granted it). `postgres` is a member of `prisma`, so it can create policies on prisma-owned tables. |

> The **direct** host (`db.<ref>.supabase.co`) is IPv6-only on newer projects; use
> the **session pooler** host (`aws-1-<region>.pooler.supabase.com:5432`) for
> `DIRECT_URL` if your network is IPv4-only.

## Order of operations (first deploy)

1. **Bootstrap the roles** (once, as `postgres`): run
   [`bootstrap_prisma_role.sql`](./bootstrap_prisma_role.sql). Put the `prisma`
   password into `DATABASE_URL` (6543, `?pgbouncer=true`); put the `postgres`
   password into `DIRECT_URL` (5432).
2. **Apply migrations**: `pnpm db:deploy` (`prisma migrate deploy`, via `DIRECT_URL`
   = `postgres`). Creates all `public` tables, then the security migration (RLS
   policies, the audit append-only trigger, and `custom_access_token_hook` + its
   grant to `supabase_auth_admin`).
3. **Storage**: create the `brand-logos` bucket via the Storage API
   (`supabase.storage.createBucket('brand-logos', { public: true })`). The
   path-scoped write policies live in [`storage_setup.sql`](./storage_setup.sql)
   and must be applied via the dashboard **Storage → Policies** UI (only
   `supabase_storage_admin` can create policies on `storage.objects`). This only
   matters once the Branding upload screen ships (later phase).
4. **Enable the access-token hook**: dashboard → **Auth → Hooks → Custom Access
   Token** → select `public.custom_access_token_hook`. Until this is on, brand
   JWTs carry no `realm`/`brand_id` claims. (Local dev: wired in `config.toml`.)
5. **Disable the Data API (PostgREST)**: dashboard → **Project Settings → API →
   Data API** → off. The API is the only DB path; `supabase-js` is used only for
   brand **Auth** and **Storage**.
6. **Seed the first super_admin**: `pnpm seed:superadmin` (forces TOTP enrollment
   on first login).

## Where the security SQL lives

All `public` RLS / trigger / hook DDL is a **Prisma migration**
(`packages/db/prisma/migrations/00000000000001_security_rls_hook_audit/`) so
Prisma is the single source of truth and sees no drift. What Prisma can't own:
the bootstrap roles (it connects *as* `prisma`), the storage-object policies
(owned by `supabase_storage_admin`), and the dashboard toggles (hook enablement,
PostgREST off).
