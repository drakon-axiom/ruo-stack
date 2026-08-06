# Dev/prod parity: nginx, PM2, and deploy

**Date:** 2026-08-05
**Status:** approved, not yet implemented

## Goal

Stand up a dev environment that is structurally identical to production, reachable
over real hostnames with TLS. Dev serves built assets exactly as prod will — no Vite
dev server, no HMR, no special-cased paths. Anything that works in dev works in prod,
because the only difference between them is a set of substituted names and ports.

A prod nginx config already exists (`deploy/nginx/ruostack.conf`, commit 5e2ab92) but
was never deployed and has no dev counterpart. This spec replaces it with a template
that renders both environments.

## Constraints discovered

1. **`.env` location is fixed in code.** `apps/api/src/config.ts:10` loads the
   monorepo-root `.env` via a path resolved relative to its own source file. A single
   checkout can hold exactly one `.env`, and that file carries `DATABASE_URL`,
   `API_PORT`, and the Stripe keys. One directory therefore binds to one database.

2. **SPA build output is per-directory.** Both frontends bake `VITE_API_BASE_URL` in at
   build time and fall back to `${hostname}:3901` when it is unset
   (`apps/brand-web/src/lib/api.ts:9`, `apps/admin-web/src/lib/api.ts:7`). Dev and prod
   need different values, and both write to `apps/*/dist/`.

3. **The API already trusts proxy headers.** `apps/api/src/app.ts:40` sets
   `trustProxy: true`, so nginx must set `X-Forwarded-For` / `X-Forwarded-Proto`
   correctly or audit logging and rate limiting will attribute every request to the
   proxy's own address.

4. **DNS is not ready.** As of 2026-08-05 none of `app.dev.ruostack.io`,
   `backend.dev.ruostack.io`, `app.ruostack.io`, or `backend.ruostack.io` resolve.
   `ruostack.com` resolves to `72.61.65.76`, which is not this host
   (`24.241.205.132`). Certbot's HTTP-01 challenge cannot succeed until A records point
   here. This blocks TLS only — the HTTP config can be installed and tested first.

## Environment layout

Dev and prod run side by side on one host, as **two checkouts of the same repository**.
This matches the convention already in use on this box (`/apps/dev/forgeform` ↔
`/apps/prod/forgeform`, `/apps/dev/btc_shipping` ↔ `/apps/prod/btc_shipping`).

|                | dev                          | prod                          |
|----------------|------------------------------|-------------------------------|
| checkout       | `/apps/dev/ruo-stack`        | `/apps/prod/ruo-stack`        |
| git ref        | tracks `main`                | pinned to a release tag       |
| `.env`         | own file, own Supabase project | own file, own Supabase project |
| API port       | `3901`                       | `3911`                        |
| PM2 process    | `ruostack-api-dev`           | `ruostack-api-prod`           |
| brand host     | `app.dev.ruostack.io`        | `app.ruostack.io`             |
| admin host     | `backend.dev.ruostack.io`    | `backend.ruostack.io`         |
| landing host   | —                            | `ruostack.com`, `www.ruostack.com` |
| brand webroot  | `/var/www/app.dev.ruostack.io/html` | `/var/www/app.ruostack.io/html` |
| admin webroot  | `/var/www/backend.dev.ruostack.io/html` | `/var/www/backend.ruostack.io/html` |
| logs           | `/var/log/ruostack-dev/`     | `/var/log/ruostack-prod/`     |

Two checkouts rather than one checkout with `.env.dev` / `.env.prod`, because of
constraints 1 and 2 above, and because prod must be able to sit on a stable commit
while dev tracks `main`. With a single directory, every `git pull` for dev would also
change what prod runs.

## Component 1 — nginx template and renderer

```
deploy/nginx/ruostack.conf.template   # single source of truth (both portal hosts)
deploy/nginx/landing.conf.template    # ruostack.com block, prod-only
deploy/nginx/env.dev                  # substitution values for dev
deploy/nginx/env.prod                 # substitution values for prod
deploy/nginx/render.sh <dev|prod>     # envsubst -> out/ruostack.<env>.conf
deploy/nginx/out/                     # rendered output (gitignored)
deploy/nginx/README.md                # install, TLS, and re-render steps
```

`render.sh` sources the chosen env file and pipes the template through `envsubst`,
restricted to an explicit variable allowlist so nginx's own `$host` / `$remote_addr` /
`$uri` variables survive untouched. It fails loudly if any placeholder is unset, and
writes to `deploy/nginx/out/ruostack.<env>.conf`.

Rendered files are gitignored: they are derived artifacts, and after certbot runs the
deployed copy diverges from the render by design (see TLS below).

### Substituted values

`BRAND_HOST`, `ADMIN_HOST`, `API_PORT`, `API_UPSTREAM` (e.g. `ruostack_api_dev`),
`BRAND_ROOT`, `ADMIN_ROOT`, `LOG_PREFIX`, plus `LANDING_HOST` and `LANDING_ROOT` used
only by the landing template.

The upstream block is named per environment so both rendered files can be enabled in
`sites-enabled/` simultaneously without an `upstream` name collision.

The `ruostack.com` block is prod-only, and `envsubst` has no conditionals — so it lives
in a separate `landing.conf.template` rather than behind a flag. `render.sh` appends it
to the output only when the env file sets `LANDING=1`, which `env.prod` does and
`env.dev` does not. Dev has no landing-site counterpart.

### Server block behaviour

Both portal hosts:

- Serve the built SPA from their webroot; `try_files $uri $uri/ /index.html` for the
  client-side router.
- Proxy `/api/` and `/healthz` to `127.0.0.1:$API_PORT`, keeping the browser
  same-origin — no CORS preflight, no mixed content.
- Set `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto` (constraint 3).
- `proxy_http_version 1.1` with `Connection ""` for upstream keepalive.
- `client_max_body_size 2m` — base64 logo upload is ~1 MB, plus headroom.
- gzip on text/css/js/json/svg above 1 KB.
- Hashed `/assets/` immutable for 1 year; `index.html` `no-store`, so a deploy is
  picked up on the next page load rather than being pinned by a stale shell.
- Per-host access and error logs under `/var/log/nginx/`.
- `/.well-known/acme-challenge/` served from `/var/www/certbot`.

The admin host additionally proxies `/auth/` (admin login, refresh, MFA) and sets
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: same-origin`. It carries commented `allow`/`deny` lines for
IP-allowlisting the operator surface later.

The Stripe webhook at `/api/payments/webhook` needs a byte-exact body for signature
verification. nginx passes request bodies through unmodified, so no special handling is
required — but no body-rewriting directive may be added to these blocks.

### TLS

`certbot --nginx` rewrites the deployed file in place, adding the `443` listener, cert
paths, and an HTTP→HTTPS redirect. Renewal is automatic.

```bash
sudo certbot --nginx -d app.dev.ruostack.io -d backend.dev.ruostack.io
```

**Consequence to document:** those edits live in `/etc/nginx/sites-available/`, not in
the template. Re-rendering and re-installing produces an HTTP-only file again. The
recovery is to re-run the same `certbot --nginx` command — it reuses the existing
certificate rather than re-issuing, and re-adds the TLS blocks. `render.sh` checks
`/etc/letsencrypt/live/` for the target hostnames and prints this reminder when a cert
already exists.

## Component 2 — PM2

A single `ecosystem.config.cjs` at the repo root, present in both checkouts, reading
`RUOSTACK_ENV` (default `dev`) to derive its process name, port, and log paths.

```bash
pm2 start ecosystem.config.cjs                      # dev checkout
RUOSTACK_ENV=prod pm2 start ecosystem.config.cjs    # prod checkout
pm2 save
```

- Runs the **compiled** `apps/api/dist/server.js` — not `tsx watch`. Dev and prod
  execute the same artifact produced by the same build.
- `cwd` pinned to `__dirname` so `.env` resolution does not depend on where PM2 was
  invoked from.
- `env` block sets `NODE_ENV=production`, `API_HOST=127.0.0.1`, and the per-environment
  `API_PORT`. Loopback binding means the API is reachable only through nginx; PM2's
  `env` wins over `.env` because dotenv runs with `override:false`.
- Fork mode, one instance, `autorestart`, `max_memory_restart: 500M`.
- Logs to `/var/log/ruostack-<env>/{out,error}.log`, rotated by the `pm2-logrotate`
  module already installed on this host.

Single instance is required for now: the rate-quote sweeper, reconciliation,
subscription-lapse, and dunning workers all start unconditionally in
`apps/api/src/server.ts`, so a second instance would double every sweep.

## Component 3 — deploy script

`deploy/deploy.sh <dev|prod>`, run from within the matching checkout:

1. Guard: refuse to run if the argument does not match the checkout path, so a prod
   deploy cannot be fired from the dev directory.
2. `pnpm install --frozen-lockfile`
3. `pnpm --filter @ruostack/db run deploy` (Prisma migrations)
4. `pnpm --filter @ruostack/api build`
5. Build each SPA with its own API origin baked in (constraint 2):
   ```bash
   VITE_API_BASE_URL=https://$BRAND_HOST pnpm --filter @ruostack/brand-web build
   VITE_API_BASE_URL=https://$ADMIN_HOST pnpm --filter @ruostack/admin-web build
   ```
6. `rsync -a --delete` each `dist/` into its webroot.
7. `pm2 reload ruostack-api-<env>`

Sequential SPA builds, since both read the same root `.env` and differ only in the
inline override.

## Required `.env` values per environment

Neither the nginx config nor PM2 can set these — they are read by the API and by the
SPA builds:

| var | dev | prod |
|---|---|---|
| `API_HOST` | `127.0.0.1` | `127.0.0.1` |
| `API_PORT` | `3901` | `3911` |
| `CORS_ORIGINS` | `https://app.dev.ruostack.io,https://backend.dev.ruostack.io` | `https://app.ruostack.io,https://backend.ruostack.io` |
| `PUBLIC_API_BASE_URL` | `https://backend.dev.ruostack.io` | `https://backend.ruostack.io` |

`CORS_ORIGINS` is belt-and-braces — same-origin proxying means the browser sends no
cross-origin requests — but it must be correct so that a misconfigured proxy fails
closed rather than silently allowing the old `localhost` origins.

`PUBLIC_API_BASE_URL` is used to register WooCommerce and ShipStation webhooks. Both
portal hosts proxy `/api`, so either works; the admin host is chosen so that the
customer-facing host can later be IP-restricted or moved without breaking webhook
delivery. Dev and prod must point at different Supabase projects and Stripe accounts,
or dev traffic will mutate production records.

## Prerequisites and ordering

1. A records for `app.dev.ruostack.io` and `backend.dev.ruostack.io` → `24.241.205.132`.
2. `sudo mkdir -p /var/www/certbot /var/www/{app,backend}.dev.ruostack.io/html`
   and `/var/log/ruostack-dev`.
3. Render, install, symlink into `sites-enabled/`, `nginx -t`, reload.
4. Deploy (builds + PM2) — verify over plain HTTP.
5. Certbot, once DNS resolves.

Prod repeats steps 1–5 against `/apps/prod/ruo-stack` with `env.prod`.

## Testing

No unit tests — this is deployment configuration. Verification is by observation:

- `nginx -t` passes before every reload.
- `curl -sS https://$BRAND_HOST/healthz` returns the API's health payload, proving the
  proxy path end to end.
- A deep link such as `https://$BRAND_HOST/orders` returns 200 with the SPA shell,
  proving the `try_files` fallback rather than a 404.
- `curl -sI https://$BRAND_HOST/assets/<hashed>.js` shows
  `Cache-Control: public, immutable`; `/index.html` shows `no-store`.
- An API audit-log entry records the real client IP, not `127.0.0.1` — proving the
  forwarded-header chain against `trustProxy`.
- `pm2 describe ruostack-api-dev` shows `online` with the expected port, and the API is
  **not** reachable at `http://24.241.205.132:3901` from outside, proving loopback
  binding.
- After a `pm2 restart`, the same checks still pass — proving `pm2 save` persistence.

## Out of scope

- The `ruostack.com` marketing site itself. The prod config serves a static root; the
  content is not this project's concern.
- HTTP/3, rate limiting at the nginx layer, and a WAF. The API does its own rate
  limiting (`@fastify/rate-limit`).
- Zero-downtime deploys beyond `pm2 reload`. Single instance means a brief restart gap
  is accepted.
- Standing up the prod checkout. This spec defines it so dev is built correctly against
  it; actually creating `/apps/prod/ruo-stack` is a separate step, taken when prod is
  ready to launch.
