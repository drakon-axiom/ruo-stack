# Deployment: edge proxy, origin nginx, PM2

Two machines, joined by Tailscale.

```
DNS -> edge VPS public IP
   EDGE   srv1153350   100.99.76.10   nginx + certbot, TLS terminates, no app files
     |  Tailscale
   ORIGIN acgserver02  100.99.76.119  nginx serves SPA dist + proxies /api to loopback
                                      PM2 runs the API; dev and prod both live here
```

## Port map

| Public hostname | Origin port | API (loopback) |
|---|---|---|
| `app.dev.ruostack.io` | `8901` | `3901` |
| `backend.dev.ruostack.io` | `8902` | `3901` |
| `app.ruostack.io` | `8911` | `3911` |
| `backend.ruostack.io` | `8912` | `3911` |
| `ruostack.com` + `www` | `8913` | — (static) |

Dedicated ports rather than `server_name` vhosting on port 80, because this box
already serves six unrelated sites there and a `server_name` miss would fall
through to their `default_server`.

## Checkouts

| | dev | prod |
|---|---|---|
| checkout | `/apps/dev/ruo-stack` | `/apps/prod/ruo-stack` |
| PM2 process | `ruostack-api-dev` | `ruostack-api-prod` |

Two directories rather than two env files because `apps/api/src/config.ts:10`
loads `.env` from the repo root relative to its own source file: one checkout
binds to one database. It also lets prod sit on a release tag while dev tracks
`main`.

## Files

The templates are the single source of truth. Never hand-edit a rendered file —
except certbot editing the deployed edge config, which is expected.

```
origin.conf.template          this box: SPA static + /api to loopback
edge.conf.template            VPS: public hostnames -> origin ports
landing.{origin,edge}.conf.template   ruostack.com, appended when LANDING=1
origin-shared.conf            the X-Forwarded-Proto map; installed once
env.dev / env.prod            names, ports, paths -- data only
render.sh <dev|prod>          -> out/{origin,edge}.<env>.conf   (gitignored)
test/run-tests.sh             renderer assertions + nginx -t on all renders
```

### Why `origin-shared.conf` is separate

TLS terminates at the edge, so the Tailscale hop is plain HTTP and `$scheme` is
`http` at the origin. Setting `X-Forwarded-Proto` from `$scheme` there would tell
the API (`trustProxy: true`, `apps/api/src/app.ts:40`) that every request is
insecure. A `map` passes the edge's value through instead. That map sits at
`http` context, and both `origin.dev.conf` and `origin.prod.conf` are enabled —
a copy in each would be a duplicate map and nginx would refuse to start. So it
ships once, into `conf.d/`.

## First-time setup

**1. DNS.** A/AAAA records for every hostname → the **edge VPS's public IP**
(not this box). Certbot runs on the VPS and cannot issue without this.

**2. On this box (origin):**

```bash
sudo mkdir -p /var/www/app.dev.ruostack.io/html /var/www/backend.dev.ruostack.io/html
sudo mkdir -p /var/log/ruostack-dev
sudo chown -R "$USER" /var/log/ruostack-dev
sudo cp deploy/nginx/origin-shared.conf /etc/nginx/conf.d/ruostack-shared.conf
```

**3. `.env`** in the checkout root — these cannot come from nginx or PM2:

```ini
API_HOST=127.0.0.1
API_PORT=3901
CORS_ORIGINS=https://app.dev.ruostack.io,https://backend.dev.ruostack.io
PUBLIC_API_BASE_URL=https://backend.dev.ruostack.io
```

Setting `API_HOST=127.0.0.1` ends Tailscale-IP access at
`100.99.76.119:3901/3902/3903`; the hostnames replace it.

`PUBLIC_API_BASE_URL` is where WooCommerce and ShipStation webhooks register.
Both portal hosts proxy `/api`, so either works; the admin host is used so the
customer-facing host can later be restricted or moved without breaking delivery.
**If you uncomment the `allow`/`deny` lines in the edge admin block, move this to
the brand host first** or webhook delivery is blocked.

Dev and prod must point at **different Supabase projects and Stripe accounts**,
or dev traffic will mutate production records.

**4. Render and install the origin config (this box):**

```bash
deploy/nginx/test/run-tests.sh          # syntax-checks before anything touches /etc
deploy/nginx/render.sh dev
sudo cp deploy/nginx/out/origin.dev.conf /etc/nginx/sites-available/ruostack-origin.dev.conf
sudo ln -sf /etc/nginx/sites-available/ruostack-origin.dev.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

**5. Deploy, then verify the origin before involving the edge:**

```bash
deploy/deploy.sh dev
curl -H 'Host: app.dev.ruostack.io' http://100.99.76.119:8901/healthz
```

**6. Install the edge config (on the VPS):**

```bash
scp deploy/nginx/out/edge.dev.conf srv1153350:/tmp/
# then, on the VPS:
sudo mkdir -p /var/www/certbot
sudo mv /tmp/edge.dev.conf /etc/nginx/sites-available/ruostack-edge.dev.conf
sudo ln -sf /etc/nginx/sites-available/ruostack-edge.dev.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

**7. TLS (on the VPS):**

```bash
sudo certbot --nginx -d app.dev.ruostack.io -d backend.dev.ruostack.io
```

## Re-rendering after a template change

`certbot --nginx` writes its TLS edits into the **deployed edge file** on the
VPS, not the template — so a fresh render is always HTTP-only and re-copying it
drops the 443 blocks. `render.sh` prints this reminder every time.

```bash
deploy/nginx/render.sh dev
scp deploy/nginx/out/edge.dev.conf srv1153350:/tmp/
# on the VPS:
sudo mv /tmp/edge.dev.conf /etc/nginx/sites-available/ruostack-edge.dev.conf
sudo certbot --nginx -d app.dev.ruostack.io -d backend.dev.ruostack.io   # re-adds TLS
sudo nginx -t && sudo systemctl reload nginx
```

Certbot reuses the existing certificate — no re-issue, no rate-limit cost.

Origin-only changes never touch the VPS: render, copy locally, `nginx -t`, reload.

## Verifying

```bash
# origin alone, bypassing the edge
curl -H 'Host: app.dev.ruostack.io' http://100.99.76.119:8901/healthz

# end to end
curl -sS https://app.dev.ruostack.io/healthz
curl -sI https://app.dev.ruostack.io/orders | head -1          # 200 + SPA shell, not 404
curl -sI https://app.dev.ruostack.io/index.html | grep -i cache-control   # no-store
curl -sI http://app.dev.ruostack.io/ | head -1                 # 301 -> https

# the API must NOT be reachable off-box
curl -sS --max-time 5 http://100.99.76.119:3901/healthz        # MUST fail
pm2 describe ruostack-api-dev
```

Then confirm in the API audit log that an entry records the **real client IP**,
not a Tailscale address — that proves the forwarded chain survives both hops.
Confirm too that the API sees requests as HTTPS despite the plaintext origin
hop; if it does not, `X-Forwarded-Proto` passthrough is broken.

## Troubleshooting

| Symptom | Cause |
|---|---|
| nginx won't start: `duplicate "map" directive` | `origin-shared.conf` content leaked into a rendered config, or it is installed twice. |
| API sees every request as insecure | Origin is setting `X-Forwarded-Proto` from `$scheme`. It must use `$ruostack_forwarded_proto`. |
| Audit log shows a Tailscale IP | A hop dropped `X-Forwarded-For`. Both must set `$proxy_add_x_forwarded_for`. |
| 403 from the origin | The edge's Tailscale IP is not in the origin's `allow` list — check `EDGE_IP`. |
| Deploy succeeded, browser shows old build | A cached `index.html`. It should be `no-store`; verify the header. |
| Certbot fails HTTP-01 | DNS points at this box instead of the VPS, or `/var/www/certbot` is missing on the VPS. |

## Notes

- `supabase-js` talks to `*.supabase.co` directly from the browser, so brand
  login needs no proxy rule — only the API does.
- `/api/payments/webhook` needs a byte-exact body for Stripe signature
  verification. nginx passes bodies through unmodified at both hops; never add
  a body-rewriting directive to either.
- The API is a single PM2 instance by design: four background workers start
  unconditionally in `apps/api/src/server.ts`, so a second instance would
  double every sweep.
- Logs: nginx `/var/log/nginx/ruostack-<env>-*` on both machines, API
  `/var/log/ruostack-<env>/`, rotated by the `pm2-logrotate` module.
