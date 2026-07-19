# Nginx reverse proxy

`ruostack.conf` fronts three hosts on one box:

| Host | Serves | Proxies to API (`127.0.0.1:3901`) |
|------|--------|-----------------------------------|
| `ruostack.com` (+ `www`) | static landing / info site | — |
| `app.ruostack.io` | customer portal (`brand-web` SPA) | `/api/`, `/healthz` |
| `backend.ruostack.io` | admin portal (`admin-web` SPA) | `/api/`, `/auth/`, `/healthz` |

The Fastify API serves both realms and every webhook on a single port; everything
lives under `/api/*` except admin auth (`/auth/admin/*`) and `/healthz`. Proxying
`/api` (+ `/auth` on admin) on each portal host keeps the browser **same-origin**
— no CORS, no mixed content.

## Prerequisites (the config alone won't do these)

**1. Build each SPA with its API origin baked in** (required — the frontends fall
back to `hostname:3901` if `VITE_API_BASE_URL` is unset):

```bash
VITE_API_BASE_URL=https://app.ruostack.io pnpm --filter @ruostack/brand-web build
cp -r apps/brand-web/dist/* /var/www/app.ruostack.io/html/

VITE_API_BASE_URL=https://backend.ruostack.io pnpm --filter @ruostack/admin-web build
cp -r apps/admin-web/dist/* /var/www/backend.ruostack.io/html/
```
(Keep your existing `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` build vars.)

**2. API `.env`:**
- `API_HOST=127.0.0.1` — bind to loopback; reachable only via nginx (default is `0.0.0.0`).
- `CORS_ORIGINS=https://app.ruostack.io,https://backend.ruostack.io`
- `PUBLIC_API_BASE_URL=https://backend.ruostack.io` — used to register Woo/ShipStation
  webhooks. Either portal host works (both proxy `/api`); point ShipStation's Custom
  Store URL + any manual webhook setup at the same host.

**3. DNS** — A/AAAA records for all four names → this server's IP.

## Enable + TLS

```bash
sudo mkdir -p /var/www/certbot
sudo ln -s /etc/nginx/sites-available/ruostack.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d ruostack.com -d www.ruostack.com \
  -d app.ruostack.io -d backend.ruostack.io
```
`certbot --nginx` rewrites each server block in place (adds the `443 ssl` listener,
cert paths, and an HTTP→HTTPS redirect) and auto-renews.

## Notes
- `supabase-js` in the browser talks directly to your `*.supabase.co` project, so
  brand login needs no proxy rule here — only the API does.
- The Stripe webhook (`/api/payments/webhook`) needs the raw body for signature
  verification; nginx passes bodies through unmodified, so no special handling.
- The admin block has commented `allow`/`deny` lines to allowlist office/VPN IPs.
