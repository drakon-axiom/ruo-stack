# RUOStack — Phase 0 (Foundations)

Two-sided white-label fulfillment platform on a **Supabase** backend. This repo
is the **Phase 0** slice: the security boundary, the audit spine, the catalog
master, and the processor seam — the foundation later phases bolt onto cleanly.

> Research-use-only (RUO) vertical. Compliance/RUO framing in the planning docs
> is intentional — do not strip it.

## Monorepo layout

```
/apps
  /api          Fastify (TS) — the ONLY consumer of the database (privileged role)
  /admin-web    React + Vite + Tailwind — admin realm (dark)
  /brand-web    React + Vite + Tailwind — brand realm (light auth / dark app, supabase-js)
/packages
  /db           Prisma schema (public schema only) + migrations
  /shared       shared types, NormalizedEvent, role-gate matrix, adapter interfaces
  /payments     PaymentsAdapter + StripeAdapter + HighRiskAcquirerAdapter (ONLY place Stripe is imported)
  /email        EmailAdapter + ConsoleEmailAdapter (admin/non-auth mail)
/supabase       migrations: custom_access_token_hook, audit append-only trigger, RLS policies
/scripts        check-stripe-imports.mjs (payments-isolation CI guard)
```

## The two realms (security boundary)

- **Brand** → Supabase Auth (`auth.users`). Realm + `brand_id` claims injected by a
  `public.custom_access_token_hook` reading the server-owned `BrandUserRole` table
  (never `user_metadata`). Brand-to-brand isolation enforced by RLS.
- **Admin** → kept **out of the customer pool** (option a): separate `AdminUser`
  table, own signing secret (`JWT_ADMIN_SECRET`), TOTP MFA. The admin backend
  connects to the one shared DB via the service role.

A token from one realm can never satisfy the other realm's route guard (tested).

## Setup

1. `pnpm install`
2. `cp .env.example .env` and fill in. To apply migrations you need the Supabase
   DB connection (`DATABASE_URL` on 6543 + `?pgbouncer=true`, `DIRECT_URL` on 5432)
   using a dedicated `prisma` role with `bypassrls`:
   ```sql
   create user "prisma" with password '…' bypassrls createdb;
   grant "prisma" to "postgres";
   grant usage, create on schema public to "prisma";
   grant all on all tables in schema public to "prisma";
   ```
3. `pnpm db:generate && pnpm db:deploy` — apply Prisma + SQL migrations.
4. Enable the access-token hook in Supabase → Auth → Hooks
   (`public.custom_access_token_hook`). Turn **off** the Data API (PostgREST).
5. `pnpm seed:superadmin` — create the first `super_admin` (forces TOTP on first login).
6. `pnpm dev:api`, `pnpm dev:admin`, `pnpm dev:brand`.

## Critical invariants

See `ruostack_phase0_build_prompt.md` §"Critical invariants". Enforced & tested:
realm isolation · append-only AuditLog (trigger, robust vs service role) ·
RLS deny-by-default on every public table · payments isolation (CI guard) ·
catalog mastership + SKU immutability · server-side authz · admin MFA ·
Prisma owns `public` only.

## Out of scope (Phase 0)

WooCommerce/ShipStation, wallet ledger mutations, order pipeline, claims,
reconciliation, announcements, provisioning wizard — built as honest, named
no-op seams (`TODO(Phase N)`) where unavoidable, never faked.
