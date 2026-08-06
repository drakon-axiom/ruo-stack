# Dev/prod parity: edge proxy, origin nginx, PM2, and deploy

**Date:** 2026-08-05
**Status:** approved, not yet implemented
**Revised:** 2026-08-05 — split into edge/origin after learning nginx runs on a separate VPS.

## Goal

Stand up a dev environment that is structurally identical to production, reachable
over real hostnames with TLS. Dev serves built assets exactly as prod will — no Vite
dev server, no HMR, no special-cased paths. Anything that works in dev works in prod,
because the only difference between them is a set of substituted names and ports.

A prod nginx config already exists (`deploy/nginx/ruostack.conf`, commit 5e2ab92) but
was never deployed, assumes nginx runs beside the app, and has no dev counterpart. This
spec replaces it.

## Topology

Two machines, joined by Tailscale.

```
                    DNS -> VPS public IP
                            |
   ┌────────────────────────▼─────────────────────────┐
   │ EDGE — srv1153350  (100.99.76.10)                │
   │ nginx + certbot. TLS terminates here.            │
   │ Holds no application files.                      │
   └────────────────────────┬─────────────────────────┘
                            │ Tailscale (encrypted)
                            │ proxy_pass -> 100.99.76.119:<port>
   ┌────────────────────────▼─────────────────────────┐
   │ ORIGIN — acgserver02  (100.99.76.119)            │
   │ nginx: serves SPA dist, proxies /api to loopback │
   │ PM2: dev API :3901, prod API :3911 (loopback)    │
   │ /apps/dev/ruo-stack   /apps/prod/ruo-stack       │
   └──────────────────────────────────────────────────┘
```

The edge proxies whole hostnames; it stores no `dist` output, so deploys never copy
application files across the network. Only the rendered edge config is ever pushed to
the VPS.

### Origin port map

The edge maps hostname → origin port explicitly. Dedicated ports rather than
`server_name` vhosting on port 80, because this box already serves six unrelated sites
there and a `server_name` miss would fall through to their `default_server`.

| Public hostname | Origin port | Serves |
|---|---|---|
| `app.dev.ruostack.io` | `8901` | brand-web dev + `/api` → `127.0.0.1:3901` |
| `backend.dev.ruostack.io` | `8902` | admin-web dev + `/api` + `/auth` → `127.0.0.1:3901` |
| `app.ruostack.io` | `8911` | brand-web prod + `/api` → `127.0.0.1:3911` |
| `backend.ruostack.io` | `8912` | admin-web prod + `/api` + `/auth` → `127.0.0.1:3911` |
| `ruostack.com` + `www` | `8913` | static marketing site (prod only) |

All four ports verified free on `acgserver02` as of 2026-08-05.

## Constraints discovered

1. **`.env` location is fixed in code.** `apps/api/src/config.ts:10` loads the
   monorepo-root `.env` via a path resolved relative to its own source file. A single
   checkout can hold exactly one `.env`, and that file carries `DATABASE_URL`,
   `API_PORT`, and the Stripe keys. One directory therefore binds to one database.

2. **SPA build output is per-directory.** Both frontends bake `VITE_API_BASE_URL` in at
   build time and fall back to `${hostname}:3901` when it is unset
   (`apps/brand-web/src/lib/api.ts:9`, `apps/admin-web/src/lib/api.ts:7`). Dev and prod
   need different values, and both write to `apps/*/dist/`.

3. **The API trusts proxy headers.** `apps/api/src/app.ts:40` sets `trustProxy: true`.
   With two proxy hops, both must maintain the forwarded chain or audit logging and
   rate limiting attribute every request to a proxy.

4. **`X-Forwarded-Proto` cannot be derived from `$scheme` at the origin.** TLS
   terminates at the edge; the origin hop is plain HTTP over Tailscale, so `$scheme` is
   `http` there. The origin must pass the edge's value through. Getting this wrong
   makes the API believe every request is insecure — which breaks any secure-cookie or
   absolute-URL decision derived from it. A `map` supplies `$scheme` only as a fallback
   for requests that arrive without the header.

5. **DNS points at the VPS, not this box.** As of 2026-08-05 none of
   `app.dev.ruostack.io`, `backend.dev.ruostack.io`, `app.ruostack.io`, or
   `backend.ruostack.io` resolve. `ruostack.com` resolves to `72.61.65.76`, which is
   neither machine. Certbot runs on the VPS and cannot issue until A records point
   there. This blocks TLS only — the HTTP path can be installed and tested first.

6. **The repo is not on the VPS.** The edge config is rendered here and copied over;
   `nginx -t`, certbot, and reloads all happen on the VPS.

## Environment layout

Dev and prod both run on `acgserver02`, as **two checkouts of the same repository**.
This matches the convention already in use on this box (`/apps/dev/forgeform` ↔
`/apps/prod/forgeform`, `/apps/dev/btc_shipping` ↔ `/apps/prod/btc_shipping`).

|                | dev                          | prod                          |
|----------------|------------------------------|-------------------------------|
| checkout       | `/apps/dev/ruo-stack`        | `/apps/prod/ruo-stack`        |
| git ref        | tracks `main`                | pinned to a release tag       |
| `.env`         | own file, own Supabase project | own file, own Supabase project |
| API port (loopback) | `3901`                  | `3911`                        |
| PM2 process    | `ruostack-api-dev`           | `ruostack-api-prod`           |
| origin ports   | `8901` brand, `8902` admin   | `8911` brand, `8912` admin, `8913` landing |
| brand host     | `app.dev.ruostack.io`        | `app.ruostack.io`             |
| admin host     | `backend.dev.ruostack.io`    | `backend.ruostack.io`         |
| landing host   | —                            | `ruostack.com`, `www.ruostack.com` |
| webroots       | `/var/www/<hostname>/html`   | same pattern                  |
| logs           | `/var/log/ruostack-dev/`     | `/var/log/ruostack-prod/`     |

Two checkouts rather than one checkout with `.env.dev` / `.env.prod`, because of
constraints 1 and 2, and because prod must be able to sit on a stable commit while dev
tracks `main`. With a single directory, every `git pull` for dev would also change what
prod runs.

## Component 1 — config templates and renderer

```
deploy/nginx/edge.conf.template        # VPS: TLS + proxy to origin over Tailscale
deploy/nginx/origin.conf.template      # this box: SPA static + /api to loopback
deploy/nginx/landing.origin.conf.template   # ruostack.com static block, prod-only
deploy/nginx/landing.edge.conf.template     # ruostack.com public host, prod-only
deploy/nginx/origin-shared.conf        # the X-Forwarded-Proto map; installed once
deploy/nginx/env.dev, env.prod         # substitution values
deploy/nginx/render.sh <dev|prod>      # -> out/edge.<env>.conf, out/origin.<env>.conf
deploy/nginx/test/                     # renderer assertions + nginx -t harness
deploy/nginx/README.md                 # install, TLS, re-render, troubleshooting
deploy/systemd/nginx-tailscale-ordering.conf  # orders nginx after tailscaled
```

`render.sh` sources the chosen env file and pipes each template through `envsubst`,
restricted to an explicit variable allowlist so nginx's own `$host` / `$remote_addr` /
`$uri` survive untouched. It fails loudly if any required variable is unset — necessary
because `envsubst` renders an unset variable as the empty string, producing a
broken-but-plausible `root ;` rather than an error.

Rendered files are gitignored: they are derived, and after certbot runs the deployed
edge config legitimately diverges from the render.

### Substituted values

`BRAND_HOST`, `ADMIN_HOST`, `ORIGIN_IP`, `EDGE_IP`, `BRAND_ORIGIN_PORT`,
`ADMIN_ORIGIN_PORT`, `API_PORT`, `API_UPSTREAM`, `BRAND_ROOT`, `ADMIN_ROOT`,
`LOG_PREFIX`, and — prod only — `LANDING_HOST`, `LANDING_ROOT`, `LANDING_ORIGIN_PORT`.

The API upstream is named per environment (`ruostack_api_dev` / `ruostack_api_prod`) so
both origin configs can be enabled simultaneously without a name collision.

The `ruostack.com` block is prod-only, and `envsubst` has no conditionals — so it lives
in separate `landing.origin.conf.template` and `landing.edge.conf.template` files,
appended by `render.sh` to the respective outputs when the env file sets `LANDING=1`. It
needs a block on each machine because it is an origin site with its own port, which
keeps the VPS a pure proxy. Its content is out of scope.

### Edge behaviour (VPS)

Per public hostname:

- `listen 80` + ACME challenge location; certbot adds the 443 listener, cert paths, and
  the HTTP→HTTPS redirect.
- `proxy_pass http://${ORIGIN_IP}:<port>` — the whole host, no path splitting.
- Sets `Host $host`, `X-Real-IP $remote_addr`,
  `X-Forwarded-For $proxy_add_x_forwarded_for`, `X-Forwarded-Proto $scheme`. This is
  the hop where `$scheme` is meaningful (constraint 4).
- `client_max_body_size 2m`, `proxy_read_timeout 60s`.
- Per-host access and error logs.

Compression and cache headers are deliberately **not** set at the edge — the origin
owns them, so there is one place to change them.

### Origin behaviour (this box)

Per site, listening on `${ORIGIN_IP}:<port>` — bound to the Tailscale interface
specifically, so these ports are not exposed on the public interface:

- `allow ${EDGE_IP}; allow ${ORIGIN_IP}; allow 127.0.0.1; deny all;` — only the edge
  may connect. `${ORIGIN_IP}` is in the list because a self-check from this box to
  its own Tailscale address arrives with *that* address as the source, not
  `127.0.0.1`; without it the runbook's own origin-verification `curl` gets a 403.
- Serves the SPA from its webroot; `try_files $uri $uri/ /index.html`.
- Proxies `/api/` and `/healthz` to `127.0.0.1:${API_PORT}`; the admin site also
  proxies `/auth/`.
- Re-sends the forwarded chain: `X-Forwarded-For $proxy_add_x_forwarded_for` (appends
  the edge, preserving the client), and `X-Forwarded-Proto $ruostack_forwarded_proto`
  from a `map` that passes the edge's value through and falls back to `$scheme`
  (constraint 4). The map is distinctly named to avoid colliding with the other configs
  on this box.
- gzip on text/css/js/json/svg above 1 KB.
- Hashed `/assets/` immutable for 1 year; `index.html` `no-store`, so a deploy is
  picked up on the next page load rather than pinned behind a stale shell.
- Admin site adds `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: same-origin`.

The API keeps binding `127.0.0.1` — only origin nginx reaches it, so nothing about the
split weakens that.

The Stripe webhook at `/api/payments/webhook` needs a byte-exact body for signature
verification. nginx passes bodies through unmodified at both hops, so no special
handling is required — but no body-rewriting directive may be added to either.

### TLS

`certbot --nginx` on the VPS rewrites the deployed edge config in place, adding the
`443` listener, cert paths, and the redirect. Renewal is automatic.

```bash
sudo certbot --nginx -d app.dev.ruostack.io -d backend.dev.ruostack.io
```

**Consequence to document:** those edits live in the VPS's
`/etc/nginx/sites-available/`, not in the template. Re-rendering and re-copying
produces an HTTP-only file again. The recovery is to re-run the same
`certbot --nginx` command — it reuses the existing certificate rather than re-issuing,
and re-adds the TLS blocks. `render.sh` cannot check for the certificate (wrong
machine), so the reminder is printed unconditionally whenever an edge config is
rendered.

## Component 2 — PM2 (origin only)

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
- `env` sets `NODE_ENV=production`, `API_HOST=127.0.0.1`, and the per-environment
  `API_PORT`. PM2 exports these before spawn and dotenv runs with `override:false`, so
  they win over `.env`.
- Fork mode, one instance, `autorestart`, `max_memory_restart: 500M`.
- Logs to `/var/log/ruostack-<env>/{out,error}.log`, rotated by the `pm2-logrotate`
  module already installed here.

Single instance is required, not merely simplest: the rate-quote sweeper,
reconciliation, subscription-lapse, and dunning workers all start unconditionally in
`apps/api/src/server.ts`, so a second instance would double every sweep.

## Component 3 — deploy script

`deploy/deploy.sh <dev|prod>`, run from within the matching checkout on this box:

1. Guard: refuse if the argument does not match the checkout path, so a prod deploy
   cannot be fired from the dev directory.
2. `pnpm install --frozen-lockfile`
3. `pnpm --filter @ruostack/db run deploy` (Prisma migrations)
4. `pnpm --filter @ruostack/api build`
5. Build each SPA with its own API origin baked in (constraint 2):
   ```bash
   VITE_API_BASE_URL=https://$BRAND_HOST pnpm --filter @ruostack/brand-web build
   VITE_API_BASE_URL=https://$ADMIN_HOST pnpm --filter @ruostack/admin-web build
   ```
   Sequential, since both read the same root `.env` and differ only in the inline
   override.
6. `rsync -a --delete` each `dist/` into its webroot — local, since the origin serves
   the files.
7. `pm2 reload ruostack-api-<env>`

The deploy script never touches the VPS. Edge config changes are a separate, rarer
operation with its own documented steps.

## Required `.env` values per environment

Read by the API and by the SPA builds; neither nginx nor PM2 can supply them:

| var | dev | prod |
|---|---|---|
| `API_HOST` | `127.0.0.1` | `127.0.0.1` |
| `API_PORT` | `3901` | `3911` |
| `CORS_ORIGINS` | `https://app.dev.ruostack.io,https://backend.dev.ruostack.io` | `https://app.ruostack.io,https://backend.ruostack.io` |
| `PUBLIC_API_BASE_URL` | `https://backend.dev.ruostack.io` | `https://backend.ruostack.io` |

Setting `API_HOST=127.0.0.1` ends the current Tailscale-IP access at
`100.99.76.119:3901/3902/3903`; the hostnames replace it.

`CORS_ORIGINS` is belt-and-braces — same-origin proxying means the browser sends no
cross-origin requests — but it must be correct so a misconfigured proxy fails closed
rather than silently allowing the old `localhost` origins.

`PUBLIC_API_BASE_URL` is where WooCommerce and ShipStation webhooks get registered.
Both portal hosts proxy `/api`, so either works; the admin host is chosen so the
customer-facing host can later be restricted or moved without breaking delivery. Dev
and prod must point at different Supabase projects and Stripe accounts, or dev traffic
will mutate production records.

## Prerequisites and ordering

1. A records for `app.dev.ruostack.io` and `backend.dev.ruostack.io` → the edge VPS's
   **public** IP (`srv1153350`; its Tailscale address is `100.99.76.10`, which is
   `EDGE_IP`).
2. On this box: create webroots and `/var/log/ruostack-dev`; set the `.env` values
   above.
3. Render, install the origin config here, `nginx -t`, reload.
4. Deploy (builds + PM2). Verify over Tailscale directly:
   `curl -H 'Host: app.dev.ruostack.io' http://100.99.76.119:8901/healthz`.
5. Copy the rendered edge config to the VPS, install, `nginx -t`, reload. Verify over
   plain HTTP.
6. Certbot on the VPS, once DNS resolves.

Prod repeats all six steps against `/apps/prod/ruo-stack` with `env.prod`.

## Testing

No unit tests — this is deployment configuration. Verification is by observation:

- `nginx -t` passes on both machines before every reload.
- The origin answers over Tailscale with an explicit Host header (step 5 above),
  proving the origin works before the edge is involved.
- The origin refuses a connection from a non-edge Tailscale peer, proving
  `allow`/`deny`.
- `curl -sS https://$BRAND_HOST/healthz` returns the API's health payload, proving both
  hops end to end.
- A deep link such as `https://$BRAND_HOST/orders` returns 200 with the SPA shell,
  proving the `try_files` fallback rather than a 404.
- `curl -sI https://$BRAND_HOST/assets/<hashed>.js` shows
  `Cache-Control: public, max-age=31536000, immutable` (exactly one such header);
  `/index.html` shows `no-store`.
- An API audit-log entry records the real client IP, not a Tailscale address — proving
  the forwarded chain survives both hops against `trustProxy`.
- The API reports the request as HTTPS despite the plaintext origin hop, proving the
  `X-Forwarded-Proto` passthrough (constraint 4).
- `pm2 describe ruostack-api-dev` shows `online`, and the API is unreachable at
  `http://100.99.76.119:3901/healthz` from another Tailscale peer, proving loopback
  binding.
- After `pm2 restart`, the same checks still pass — proving `pm2 save` persistence.

## Out of scope

- The `ruostack.com` marketing site content. The config serves a static root; the
  content is not this project's concern.
- HTTP/3, nginx-layer rate limiting, and a WAF. The API rate-limits itself
  (`@fastify/rate-limit`).
- Automating edge-config deployment to the VPS. Rendered here, copied by hand — it
  changes rarely, and automating it means holding VPS credentials in this repo.
- Zero-downtime deploys beyond `pm2 reload`. Single instance means a brief restart gap
  is accepted.
- Standing up the prod checkout. This spec defines it so dev is built correctly against
  it; creating `/apps/prod/ruo-stack` is a separate step taken when prod is ready.
