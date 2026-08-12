# Supabase dev/prod instance split — design

Date: 2026-08-10
Status: **live**. Prod instance provisioned and verified, guard and `with-env`
fix landed in `9cc3e14`, the API packaging bug fixed in `c0f743a`, and storage
policies correctly scoped as of 2026-08-11. All four hostnames serve over TLS.
Remaining: live Stripe and prod ShipStation credentials — prod still carries
test-mode Stripe keys, so any checkout runs in test mode.

## Problem

`/apps/dev/ruo-stack` and `/apps/prod/ruo-stack` shared a single Supabase project
(`kcgqabbiihtfxczhpyfs`, named "RUO Stack - Dev"). The two `.env` files were
byte-for-byte identical, so:

- There was no database-level separation between environments. The checkout guard
  in `deploy/deploy.sh` distinguishes *which host config* is deployed, not which
  database is written to.
- Dev and prod shared `JWT_ADMIN_SECRET`, `MFA_ENCRYPTION_KEY`, `STORE_CREDS_KEY`,
  and `SEED_SUPERADMIN_PASSWORD`. A dev-side leak would have been a prod
  compromise: same admin JWT signing key, same AES-256-GCM keys protecting TOTP
  seeds and stored store credentials at rest.
- Nothing was deployed yet — no webroots, no enabled nginx sites, no `ruostack_api_*`
  under pm2 — so this is a first production deploy, not a cutover. No production
  users exist to strand.

## Decision

Stand up a **new** Supabase project for prod and leave the existing project as dev.

Rejected: promoting the existing instance to prod and creating a new dev. It moves
the instance holding data into the production role, inherits dev test rows and dev
auth users as production records, and puts the risky steps on the instance that
matters. The chosen direction puts every risky step on an empty instance.

## End state

| | dev | prod |
|---|---|---|
| Supabase project | `kcgqabbiihtfxczhpyfs` ("RUO Stack - Dev") | `nanixtzbmorpojnyverq` ("RUO Stack - Prod") |
| Org | ACG - PROD (`ywnoqusyfuzcfepnwcob`) | ACG - PROD (`ywnoqusyfuzcfepnwcob`) |
| Region | us-west-2 | us-west-2 |
| Checkout | `/apps/dev/ruo-stack` | `/apps/prod/ruo-stack` |
| API port | 3901 | 3911 |
| Hosts | `app.dev.ruostack.io`, `backend.dev.ruostack.io` | `app.ruostack.io`, `backend.ruostack.io`, `ruostack.com` |

Dev's `.env` is not edited. All changes are confined to the prod checkout plus two
shared repo files (the guard, below).

## Provisioning

Follows `supabase/README.md`. Ordering matters in two places: the role bootstrap
must precede `migrate deploy` (migrations assume `prisma` owns `public`), and the
access-token hook must be enabled before any real brand login.

1. Create the project (`supabase projects create`, us-west-2, generated `postgres`
   password).
2. Run `supabase/bootstrap_prisma_role.sql` as `postgres` with a generated,
   URL-safe `prisma` password. Executed via the Management API SQL endpoint, which
   was verified to run as `postgres`.
3. Compose the prod `.env` (below).
4. `pnpm db:deploy` — applies all 29 migrations including the security migration
   (RLS deny-by-default, audit append-only trigger, `custom_access_token_hook` and
   its grant to `supabase_auth_admin`).
5. Create the `brand-logos` storage bucket via the Management API.
6. Enable the custom access-token hook (`PATCH /v1/projects/{ref}/config/auth`,
   `hook_custom_access_token_enabled` + `hook_custom_access_token_uri`).
7. Disable the Data API (`PATCH /v1/projects/{ref}/postgrest`, clearing `db_schema`).
8. `pnpm seed:superadmin` — creates `scott.hawks@axc.llc` as `super_admin` with MFA
   disabled, so first login forces TOTP enrollment.

### Manual residue

None on the database side. Every step above, including the storage policies, runs
through the Management API SQL endpoint as `postgres`. See "Storage policies"
below for the one statement that had to be removed to make that true.

External inputs only: DNS (already in place), live Stripe credentials, and prod
ShipStation credentials.

## Storage policies — RESOLVED 2026-08-11

Prod `brand-logos` now carries exactly the two policies in
`supabase/storage_setup.sql`, both scoped per brand:

```
brand_logo_write_own_prefix  : INSERT : authenticated
brand_logo_update_own_prefix : UPDATE : authenticated
```

Verified: total 2, scoped-by-brand 2, **unscoped 0**, no wizard leftovers.

### What went wrong, so it is not repeated

The file could not be applied *anywhere* because it opened with
`SET ROLE supabase_storage_admin;`. `postgres` is not a member of that role, so
that one statement fails with `42501: permission denied to set role` from the
Management API, the dashboard SQL editor, and psql alike. The `SET ROLE` line has
been removed — `postgres` can `CREATE POLICY` on `storage.objects` directly,
which is all the file ever needed, and the whole file now applies through the
Management API SQL endpoint and is idempotent.

That was misdiagnosed at first: the `SET ROLE` failure was read as "policies
cannot be created programmatically at all", and the work was handed to the
dashboard. It should have been read as "this one statement is unnecessary".
A direct `CREATE POLICY` was never attempted until it worked first try.

The dashboard detour then made things worse. Storage → Policies has a **wizard**
that generates its own expression from a template and silently discards a pasted
one; it produced two policies whose entire expression was `bucket_id =
'brand-logos'`, i.e. every authenticated user could write to every brand's
folder, plus a stray SELECT policy. Policies named with a trailing `_0` / `_1`
suffix come from that wizard; the "For full customization" editor is the one that
takes a raw expression.

Ruled out early, by direct check, and worth not re-checking: `authenticated`
*can* execute `public.current_user_brand_ids()`, and the expression compiles
(created against a throwaway table in a transaction, then rolled back).

### Verifying

Assert on the *expression*, not the policy count — counting is how the broken
first attempt was mistakenly accepted:

```sql
with p as (
  select coalesce(qual,'') || coalesce(with_check,'') as expr
  from pg_policies where schemaname='storage' and tablename='objects'
)
select (select count(*) from p) as total,
       (select count(*) from p where expr like '%current_user_brand_ids%') as scoped,
       (select count(*) from p where expr not like '%current_user_brand_ids%') as unscoped;
```

`unscoped` must be 0. No SELECT policy is needed; the bucket is `public: true`.

### Related drift: dev's storage policies

Dev (`kcgqabbiihtfxczhpyfs`) carries four policies referencing a **`brand-assets`**
bucket that does not exist there — dev's only bucket is `brand-logos` — scoped by
`auth.uid()` rather than by brand. They are inert, and `storage_setup.sql` appears
never to have been applied to dev either. Cleaning them up is unrelated to the
instance split and was left alone.

Live Stripe credentials and prod ShipStation credentials are external inputs, not
repo work.

DNS is already in place: all six hostnames — `app`/`backend` for both prod and
dev, plus `ruostack.com` and `www` — resolve to `72.61.65.76`, the edge VPS's
public IP. Note that this is *not* `EDGE_IP` in `env.<name>`; that is the edge's
Tailscale address `100.99.76.10`, used for the private origin hop. The public IP
appears in no config file, only in DNS.

## Prod `.env` composition

Derived from the existing file so non-secret operational values (warehouse address,
shipping tunables, TTLs) carry over unchanged. Replaced:

- **Connection**: `DATABASE_URL` (role `prisma`, port 6543, `?pgbouncer=true`),
  `DIRECT_URL` (role `postgres`, port 5432 session pooler). The role split is
  required: RLS policies reference `auth.uid()`, and only privileged roles have
  USAGE on the `auth` schema.
- **Supabase**: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- **Fresh secrets**: `JWT_ADMIN_SECRET` (64 chars), `MFA_ENCRYPTION_KEY` and
  `STORE_CREDS_KEY` (each base64 of exactly 32 bytes, distinct — enforced by
  `apps/api/src/config.ts`), `SEED_SUPERADMIN_PASSWORD`.
- **Environment identity**: `NODE_ENV=production`, `API_PORT=3911`,
  `CORS_ORIGINS=https://app.ruostack.io,https://backend.ruostack.io`.

Database passwords are generated from `[A-Za-z0-9]` only. They are embedded in
connection URLs, where `@ : / ? # %` break parsing — `bootstrap_prisma_role.sql`
calls for a URL-safe password for this reason.

Carried over as **placeholders**, to be replaced before go-live: `STRIPE_SECRET_KEY`
and `STRIPE_WEBHOOK_SECRET` (currently test-mode), `STRIPE_PRO_PRICE_ID`,
`STRIPE_VOLUME_PRICE_ID`, and the `SHIPSTATION_*` credentials.

## Ref-pinning guard — implemented as `deploy/check-env-ref.sh`

The failure this prevents: a prod deploy silently migrating dev, or a half-edited
`.env` where `SUPABASE_URL` was swapped but `DIRECT_URL` was not. Care does not
prevent that; a check does. Today `deploy.sh` has no database-level guard at all.

The project ref is embedded in all three values — `prisma.<ref>`, `postgres.<ref>`,
and `https://<ref>.supabase.co` — so a three-way agreement check is cheap.

- `deploy/nginx/env.dev` gains `SUPABASE_REF=kcgqabbiihtfxczhpyfs`.
- `deploy/nginx/env.prod` gains `SUPABASE_REF=nanixtzbmorpojnyverq`.
- `deploy.sh` extracts the ref from `DATABASE_URL`, `DIRECT_URL`, and `SUPABASE_URL`
  in the root `.env`, and aborts unless all three agree with each other *and* with
  `SUPABASE_REF` for the environment being deployed.

The guard reads the refs by pattern-matching the file, never by sourcing it, so it
does not inherit the evaluation hazard described below. It runs beside the existing
`[[ -f "$ROOT/.env" ]]` preflight — before `pnpm install --frozen-lockfile`, per the
script's own "Guard first, before any build" convention.

## `with-env` hardening — implemented as `packages/db/with-env.sh`

`packages/db/package.json` currently has:

```
"with-env": "set -a; [ -n \"$DIRECT_URL\" ] || { [ -f ../../.env ] && . ../../.env; }; set +a; exec"
```

Two defects, both reproduced against the merged script:

1. **Sourcing evaluates secrets as bash.** Double-quoted values still undergo
   parameter expansion and command substitution. A `$$` in a rotated DB password
   silently expanded to a PID; a backticked value executed and spliced its output
   into the URL. Both exit 0, so the corruption is invisible.
2. **`set -a` exports the entire root `.env`** into the Prisma child, not just the
   two URLs — `STRIPE_SECRET_KEY` and `JWT_SECRET` were both confirmed present in
   the child environment. This reaches `prisma studio`, which serves a web UI. It
   also directly contradicts `deploy/deploy.sh`, which explains at length why it is
   "Deliberately NOT `set -a`" for a *committed config* file — the same reasoning
   applies with more force to a secrets file.

Additionally the ambient-env probe checks only `DIRECT_URL`, making precedence
asymmetric: an exported `DIRECT_URL` wins over `.env`, while an exported
`DATABASE_URL` loses to it. Both directions verified.

Preferred fix: stop shell-parsing secrets. Run the Prisma CLI with cwd at the repo
root so it loads `.env` natively. Note `prisma` resolves only from
`packages/db/node_modules/.bin`, so the invocation must reference that path.

## Verification

- All 29 migrations present in `_prisma_migrations`.
- RLS enabled and forced on every `public` table.
- `custom_access_token_hook` exists and the hook is enabled in auth config.
- Data API reports disabled.
- Runtime `prisma` role can read tables created by migrations that ran as
  `postgres` (the grants in bootstrap step 5 exist precisely to prevent
  "permission denied" here).
- Seeded superadmin exists with `mfaEnabled = false`.

## Out of scope for this pass

nginx rendering, webroot creation, pm2 process start, and DNS cutover. Nothing
becomes publicly reachable until a separate, explicitly approved go-live pass.
