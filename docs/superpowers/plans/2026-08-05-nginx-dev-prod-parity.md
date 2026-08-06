# Dev/Prod Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the RUOStack dev instance over real hostnames with TLS, from a config that renders production from the same template.

**Architecture:** Two machines. A VPS (`srv1153350`, Tailscale `100.99.76.10`) runs nginx + certbot as the **edge**: TLS terminates there and whole hostnames are proxied over Tailscale. This box (`acgserver02`, `100.99.76.119`) is the **origin**: its own nginx serves the built SPAs and proxies `/api` to a loopback-bound API under PM2. Dev and prod both run here as two checkouts, separated by port. One template set renders both environments and both roles.

**Tech Stack:** nginx 1.24, certbot 2.9 (`--nginx` plugin), PM2 7.0.1 (`pm2-logrotate` installed), GNU `envsubst` 0.21, Tailscale, Node 22, pnpm 11.3, bash.

**Spec:** `docs/superpowers/specs/2026-08-05-nginx-dev-prod-parity-design.md`

## Global Constraints

- **Two checkouts, never two env files.** `apps/api/src/config.ts:10` resolves `.env` from the repo root relative to its own source file. One directory binds to one database.
- **The API binds `127.0.0.1` only.** Only origin nginx reaches it. The edge talks to origin nginx, never to the API.
- **API ports (loopback):** dev `3901`, prod `3911`. PM2 names: `ruostack-api-dev`, `ruostack-api-prod`.
- **Origin ports (Tailscale interface):** dev brand `8901`, dev admin `8902`; prod brand `8911`, prod admin `8912`, prod landing `8913`. All five verified free on this box as of 2026-08-05.
- **Hostnames:** dev `app.dev.ruostack.io` / `backend.dev.ruostack.io`; prod `app.ruostack.io` / `backend.ruostack.io` / `ruostack.com` + `www.ruostack.com`.
- **Webroots:** `/var/www/<hostname>/html`. **Logs:** nginx `/var/log/nginx/ruostack-<env>-*`, API `/var/log/ruostack-<env>/`.
- **The API sets `trustProxy: true`** (`apps/api/src/app.ts:40`). Both hops must maintain the forwarded chain or audit logging and rate limiting key off a proxy address.
- **`X-Forwarded-Proto` must be passed through at the origin, never derived from `$scheme`.** TLS terminates at the edge, so `$scheme` is `http` at the origin. A `map` passes the edge's value through and falls back to `$scheme` only when the header is absent.
- **The `map` lives in a shared file, not in the rendered configs.** It sits at `http` context; with both `origin.dev.conf` and `origin.prod.conf` enabled, a per-environment copy would be a duplicate-map error and nginx would refuse to start.
- **Never add a body-rewriting directive** at either hop. `/api/payments/webhook` needs a byte-exact body for Stripe signature verification.
- **`envsubst` must be called with an explicit variable allowlist.** A bare call would eat nginx's own `$host`, `$uri`, `$remote_addr`. Verified: allowlisting preserves them.
- **`envsubst` renders unset variables as the empty string**, producing a broken-but-plausible `root ;`. `render.sh` must validate required variables itself.
- **Rendered output is gitignored.** After certbot runs, the deployed edge config legitimately diverges from the render.
- **DNS points at the edge VPS's public IP, not this box.** As of 2026-08-05 no ruostack.io name resolves, and `ruostack.com` points to `72.61.65.76`, which is neither machine. Tasks 1–7 are completable and testable without DNS. Task 8 is blocked on it.
- **The repo is not on the VPS.** Edge configs are rendered here and copied over by hand.

---

## File Structure

| File | Responsibility |
|---|---|
| `deploy/nginx/origin.conf.template` | This box: brand + admin sites — SPA static, `/api` to loopback, edge-only access. |
| `deploy/nginx/edge.conf.template` | VPS: brand + admin public hostnames proxied to origin ports over Tailscale. |
| `deploy/nginx/landing.origin.conf.template` | `ruostack.com` static block on the origin. Prod only. |
| `deploy/nginx/landing.edge.conf.template` | `ruostack.com` public hostname on the edge. Prod only. |
| `deploy/nginx/origin-shared.conf` | The `X-Forwarded-Proto` map. Not templated; installed once into `conf.d/`. |
| `deploy/nginx/env.dev`, `env.prod` | Per-environment substitution values. Data only. |
| `deploy/nginx/render.sh` | Validates variables, renders origin + edge, appends landing when enabled. |
| `deploy/nginx/test/harness.conf` | Minimal `http{}` wrapper letting `nginx -t` run as a non-root user. |
| `deploy/nginx/test/run-tests.sh` | Renderer assertions + `nginx -t` on all four rendered configs. |
| `deploy/nginx/README.md` | Install, TLS, re-render, troubleshooting. |
| `ecosystem.config.cjs` | PM2 process definition, keyed on `RUOSTACK_ENV`. |
| `deploy/deploy.sh` | Build, publish to local webroots, reload PM2. Never touches the VPS. |
| `deploy/test-ecosystem.sh` | Assertions for the PM2 config and the deploy script's guards. |
| `deploy/nginx/ruostack.conf` | **Deleted** in Task 7 — superseded. |

**Testing approach.** This is deployment configuration, so the tests are a bash assertion runner rather than a unit-test framework. They catch unset variables, eaten nginx variables, missing forwarded headers, a `$scheme`-derived `X-Forwarded-Proto`, duplicate maps, upstream collisions, and syntax errors. The `nginx -t` harness rewrites `listen` directives to a loopback high port and redirects log paths into a temp dir, so it runs without root — verified working against representative edge and origin blocks (valid exits 0, broken exits 1).

---

### Task 1: Renderer and test harness

**Files:**
- Create: `deploy/nginx/env.dev`, `deploy/nginx/env.prod`, `deploy/nginx/render.sh`
- Create: `deploy/nginx/origin-shared.conf`
- Create: `deploy/nginx/test/harness.conf`, `deploy/nginx/test/run-tests.sh`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: `deploy/nginx/render.sh <dev|prod>` writes `out/origin.<env>.conf` and `out/edge.<env>.conf`, exiting non-zero on any missing required variable. Env files define `BRAND_HOST`, `ADMIN_HOST`, `ORIGIN_IP`, `EDGE_IP`, `BRAND_ORIGIN_PORT`, `ADMIN_ORIGIN_PORT`, `API_PORT`, `API_UPSTREAM`, `BRAND_ROOT`, `ADMIN_ROOT`, `LOG_PREFIX`, `LANDING`, and prod-only `LANDING_HOST`, `LANDING_ROOT`, `LANDING_ORIGIN_PORT`. Tasks 2–4 write the templates; Task 6 sources the same env files.

- [ ] **Step 1: Write the failing test**

Create `deploy/nginx/test/run-tests.sh`:

```bash
#!/usr/bin/env bash
# Tests for the nginx config renderer. Run: deploy/nginx/test/run-tests.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NGINX_DIR="$(dirname "$HERE")"
RENDER="$NGINX_DIR/render.sh"
PASS=0; FAIL=0

ok()  { printf '  ok   %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; FAIL=$((FAIL+1)); }

assert_contains() { # <file> <literal> <description>
  if grep -qF -- "$2" "$1" 2>/dev/null; then ok "$3"; else bad "$3" "missing: $2"; fi
}
assert_absent() { # <file> <literal> <description>
  if grep -qF -- "$2" "$1" 2>/dev/null; then bad "$3" "unexpectedly present: $2"; else ok "$3"; fi
}

echo "== renderer =="

for env in dev prod; do
  if "$RENDER" "$env" >/dev/null 2>&1; then ok "render.sh $env succeeds"
  else bad "render.sh $env succeeds" "non-zero exit"; fi
done

O_DEV="$NGINX_DIR/out/origin.dev.conf";  E_DEV="$NGINX_DIR/out/edge.dev.conf"
O_PRD="$NGINX_DIR/out/origin.prod.conf"; E_PRD="$NGINX_DIR/out/edge.prod.conf"

for f in "$O_DEV" "$E_DEV" "$O_PRD" "$E_PRD"; do
  [[ -f "$f" ]] && ok "rendered $(basename "$f")" || bad "rendered $(basename "$f")" "not created"
done

if "$RENDER" nope >/dev/null 2>&1; then bad "unknown environment exits non-zero" "exited 0"
else ok "unknown environment exits non-zero"; fi

if "$RENDER" >/dev/null 2>&1; then bad "missing argument exits non-zero" "exited 0"
else ok "missing argument exits non-zero"; fi

# envsubst turns an unset variable into the empty string, silently producing
# `root ;`. render.sh must reject that instead of emitting it.
TMP_ENV="$NGINX_DIR/env.tmptest"
grep -v '^BRAND_ROOT=' "$NGINX_DIR/env.dev" > "$TMP_ENV"
if "$RENDER" tmptest >/dev/null 2>&1; then bad "missing required var fails" "rendered anyway"
else ok "missing required var fails"; fi
rm -f "$TMP_ENV" "$NGINX_DIR/out/origin.tmptest.conf" "$NGINX_DIR/out/edge.tmptest.conf"

echo "== substitution =="

assert_contains "$E_DEV" "server_name app.dev.ruostack.io;"     "dev edge brand server_name"
assert_contains "$E_DEV" "server_name backend.dev.ruostack.io;" "dev edge admin server_name"
assert_contains "$E_PRD" "server_name app.ruostack.io;"         "prod edge brand server_name"

for f in "$O_DEV" "$E_DEV" "$O_PRD" "$E_PRD"; do
  assert_absent "$f" '${' "no unsubstituted placeholders in $(basename "$f")"
done

for f in "$O_DEV" "$E_DEV"; do
  assert_contains "$f" '$remote_addr'               "\$remote_addr survives in $(basename "$f")"
  assert_contains "$f" '$proxy_add_x_forwarded_for' "\$proxy_add_x_forwarded_for survives in $(basename "$f")"
done
assert_contains "$O_DEV" 'try_files $uri $uri/ /index.html' "\$uri survives in origin.dev.conf"

echo "== edge -> origin routing =="

assert_contains "$E_DEV" "http://100.99.76.119:8901" "dev edge brand -> origin :8901"
assert_contains "$E_DEV" "http://100.99.76.119:8902" "dev edge admin -> origin :8902"
assert_contains "$E_PRD" "http://100.99.76.119:8911" "prod edge brand -> origin :8911"
assert_contains "$E_PRD" "http://100.99.76.119:8912" "prod edge admin -> origin :8912"

# The edge must never reach the API directly -- only origin nginx may.
for f in "$E_DEV" "$E_PRD"; do
  assert_absent "$f" ":3901" "edge does not address the API port in $(basename "$f")"
  assert_absent "$f" ":3911" "edge does not address the prod API port in $(basename "$f")"
done

echo "== origin =="

assert_contains "$O_DEV" "listen 100.99.76.119:8901;" "origin binds the tailscale iface, not 0.0.0.0"
assert_contains "$O_DEV" "server 127.0.0.1:3901;"     "dev origin API upstream is loopback"
assert_contains "$O_PRD" "server 127.0.0.1:3911;"     "prod origin API upstream is loopback"
assert_contains "$O_DEV" "allow 100.99.76.10;"        "origin allows the edge"
assert_contains "$O_DEV" "deny  all;"                 "origin denies everyone else"

# Upstream names must differ, or both origin configs cannot be enabled at once.
assert_contains "$O_DEV" "upstream ruostack_api_dev"  "dev upstream name"
assert_contains "$O_PRD" "upstream ruostack_api_prod" "prod upstream name"

echo "== forwarded headers (apps/api/src/app.ts:40) =="

# The edge is the hop where $scheme is meaningful.
assert_contains "$E_DEV" 'proxy_set_header   X-Forwarded-Proto $scheme;' "edge sets X-Forwarded-Proto from \$scheme"

# The origin must NOT: TLS terminated at the edge, so $scheme is http here.
if grep -E 'X-Forwarded-Proto[[:space:]]+\$scheme' "$O_DEV" >/dev/null 2>&1; then
  bad "origin does not derive X-Forwarded-Proto from \$scheme" "found \$scheme"
else
  ok "origin does not derive X-Forwarded-Proto from \$scheme"
fi
assert_contains "$O_DEV" '$ruostack_forwarded_proto' "origin uses the passthrough map variable"

# The map is http-context: a per-environment copy would be a duplicate.
for f in "$O_DEV" "$O_PRD"; do
  assert_absent "$f" "map \$http_x_forwarded_proto" "map not duplicated in $(basename "$f")"
done
assert_contains "$NGINX_DIR/origin-shared.conf" 'map $http_x_forwarded_proto $ruostack_forwarded_proto' \
  "map lives in origin-shared.conf"

# `grep -c` prints 0 and exits 1 when there is no match; the script runs
# without `set -e`, so capture the count directly. Adding `|| echo 0` here
# would append a SECOND line and break the arithmetic below.
for f in "$O_DEV" "$E_DEV"; do
  n=$(grep -c 'proxy_set_header   X-Forwarded-For' "$f")
  [[ "$n" -ge 2 ]] && ok "X-Forwarded-For in both blocks of $(basename "$f")" \
                   || bad "X-Forwarded-For in both blocks of $(basename "$f")" "found $n, want >= 2"
done

echo "== admin-only surface =="

a=$(grep -c 'location /auth/' "$O_DEV")
[[ "$a" -eq 1 ]] && ok "/auth/ proxied exactly once (admin site only)" \
                 || bad "/auth/ proxied exactly once (admin site only)" "found $a"

echo "== landing is prod-only =="

assert_contains "$E_PRD" "server_name ruostack.com www.ruostack.com;" "prod edge has landing"
assert_contains "$O_PRD" "listen 100.99.76.119:8913;"                 "prod origin has landing"
assert_absent   "$E_DEV" "ruostack.com"                               "dev edge has no landing"
assert_absent   "$O_DEV" "ruostack.com"                               "dev origin has no landing"

echo "== nginx syntax =="

# nginx -t binds listeners and opens log files, so rewrite listen directives to a
# loopback high port and redirect logs into the scratch dir to run as non-root.
for f in "$O_DEV" "$E_DEV" "$O_PRD" "$E_PRD"; do
  work="$(mktemp -d)"; mkdir -p "$work/logs" "$work/tmp"
  sed -E -e '/^[[:space:]]*listen[[:space:]]+\[::\]/d' \
         -e 's|^([[:space:]]*)listen[^;]*;|\1listen 127.0.0.1:8801;|' \
         -e 's|/var/log/nginx/|logs/|' \
         "$f" > "$work/server.conf"
  cp "$NGINX_DIR/origin-shared.conf" "$work/shared.conf"
  cp "$HERE/harness.conf" "$work/nginx.conf"
  if nginx -t -p "$work" -c "$work/nginx.conf" -e "$work/logs/error.log" >"$work/out" 2>&1; then
    ok "nginx -t passes for $(basename "$f")"
  else
    bad "nginx -t passes for $(basename "$f")" "$(tail -3 "$work/out")"
  fi
  rm -rf "$work"
done

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
```

Create `deploy/nginx/test/harness.conf`:

```nginx
# Minimal nginx.conf wrapper so `nginx -t` can syntax-check a rendered config as
# a non-root user. Writable paths are relative to the -p prefix.
events {}
pid tmp/nginx.pid;
http {
    client_body_temp_path tmp;
    proxy_temp_path       tmp;
    fastcgi_temp_path     tmp;
    uwsgi_temp_path       tmp;
    scgi_temp_path        tmp;
    access_log            logs/access.log;
    include               shared.conf;
    include               server.conf;
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
chmod +x deploy/nginx/test/run-tests.sh
deploy/nginx/test/run-tests.sh
```

Expected: FAIL — `render.sh` does not exist, so nothing renders and the script exits non-zero.

- [ ] **Step 3: Write the env files, shared map, and renderer**

Create `deploy/nginx/env.dev`:

```bash
# Substitution values for the dev environment. Data only -- sourced by render.sh.
BRAND_HOST=app.dev.ruostack.io
ADMIN_HOST=backend.dev.ruostack.io

# ORIGIN_IP: acgserver02, this box. EDGE_IP: srv1153350, the reverse-proxy VPS.
ORIGIN_IP=100.99.76.119
EDGE_IP=100.99.76.10

# Origin listens on these; the edge maps hostname -> port.
BRAND_ORIGIN_PORT=8901
ADMIN_ORIGIN_PORT=8902

# Loopback only -- reachable solely by origin nginx.
API_PORT=3901
API_UPSTREAM=ruostack_api_dev

BRAND_ROOT=/var/www/app.dev.ruostack.io/html
ADMIN_ROOT=/var/www/backend.dev.ruostack.io/html
LOG_PREFIX=ruostack-dev

# The marketing site is production-only.
LANDING=0
```

Create `deploy/nginx/env.prod`:

```bash
# Substitution values for the production environment.
BRAND_HOST=app.ruostack.io
ADMIN_HOST=backend.ruostack.io

ORIGIN_IP=100.99.76.119
EDGE_IP=100.99.76.10

BRAND_ORIGIN_PORT=8911
ADMIN_ORIGIN_PORT=8912

API_PORT=3911
API_UPSTREAM=ruostack_api_prod

BRAND_ROOT=/var/www/app.ruostack.io/html
ADMIN_ROOT=/var/www/backend.ruostack.io/html
LOG_PREFIX=ruostack-prod

LANDING=1
LANDING_HOST=ruostack.com
LANDING_ROOT=/var/www/ruostack.com/html
LANDING_ORIGIN_PORT=8913
```

Create `deploy/nginx/origin-shared.conf`:

```nginx
# Installed ONCE on the origin box as /etc/nginx/conf.d/ruostack-shared.conf.
#
# TLS terminates at the edge VPS and the Tailscale hop is plain HTTP, so
# $scheme is "http" here and must NOT be used to set X-Forwarded-Proto -- the
# API (trustProxy:true, apps/api/src/app.ts:40) would conclude every request
# was insecure. Pass the edge's value through instead, falling back to $scheme
# only for a request that arrives without the header (i.e. direct, not via the
# edge).
#
# This map sits at http context. It lives here rather than in the rendered
# per-environment configs because origin.dev.conf and origin.prod.conf are both
# enabled -- a copy in each would be a duplicate map and nginx would refuse to
# start.
map $http_x_forwarded_proto $ruostack_forwarded_proto {
    default $http_x_forwarded_proto;
    ''      $scheme;
}
```

Create `deploy/nginx/render.sh`:

```bash
#!/usr/bin/env bash
# Render the nginx configs for one environment.
#
#   deploy/nginx/render.sh dev   -> out/origin.dev.conf,  out/edge.dev.conf
#   deploy/nginx/render.sh prod  -> out/origin.prod.conf, out/edge.prod.conf
#
# origin.* installs on this box (serves SPA static, proxies /api to loopback).
# edge.*   installs on the reverse-proxy VPS (terminates TLS, proxies over
#          Tailscale). The templates are the single source of truth; env.<name>
#          supplies only names, ports, and paths.
set -euo pipefail

ENV_NAME="${1:-}"
if [[ -z "$ENV_NAME" ]]; then
  echo "usage: render.sh <dev|prod>" >&2
  exit 2
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$HERE/env.$ENV_NAME"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "render: no such env file: $ENV_FILE" >&2
  exit 2
fi

set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

# envsubst renders an unset variable as the empty string, which would silently
# produce a broken-but-plausible `root ;`. Validate explicitly instead.
REQUIRED=(BRAND_HOST ADMIN_HOST ORIGIN_IP EDGE_IP BRAND_ORIGIN_PORT
          ADMIN_ORIGIN_PORT API_PORT API_UPSTREAM BRAND_ROOT ADMIN_ROOT LOG_PREFIX)
missing=()
for var in "${REQUIRED[@]}"; do
  [[ -n "${!var:-}" ]] || missing+=("$var")
done
if (( ${#missing[@]} > 0 )); then
  echo "render: env.$ENV_NAME is missing required variable(s): ${missing[*]}" >&2
  exit 1
fi

# Explicit allowlist -- a bare envsubst would also eat nginx's own $host, $uri,
# and $remote_addr.
SUBST='${BRAND_HOST} ${ADMIN_HOST} ${ORIGIN_IP} ${EDGE_IP} ${BRAND_ORIGIN_PORT}'
SUBST+=' ${ADMIN_ORIGIN_PORT} ${API_PORT} ${API_UPSTREAM} ${BRAND_ROOT}'
SUBST+=' ${ADMIN_ROOT} ${LOG_PREFIX} ${LANDING_HOST} ${LANDING_ROOT} ${LANDING_ORIGIN_PORT}'

mkdir -p "$HERE/out"
ORIGIN_OUT="$HERE/out/origin.$ENV_NAME.conf"
EDGE_OUT="$HERE/out/edge.$ENV_NAME.conf"

envsubst "$SUBST" < "$HERE/origin.conf.template" > "$ORIGIN_OUT"
envsubst "$SUBST" < "$HERE/edge.conf.template"   > "$EDGE_OUT"

if [[ "${LANDING:-0}" == "1" ]]; then
  for var in LANDING_HOST LANDING_ROOT LANDING_ORIGIN_PORT; do
    if [[ -z "${!var:-}" ]]; then
      echo "render: LANDING=1 requires $var in env.$ENV_NAME" >&2
      exit 1
    fi
  done
  envsubst "$SUBST" < "$HERE/landing.origin.conf.template" >> "$ORIGIN_OUT"
  envsubst "$SUBST" < "$HERE/landing.edge.conf.template"   >> "$EDGE_OUT"
fi

echo "render: wrote $ORIGIN_OUT"
echo "render: wrote $EDGE_OUT"

# certbot --nginx edits the DEPLOYED edge config on the VPS, not this template,
# so every fresh render is HTTP-only. render.sh cannot detect an existing
# certificate (wrong machine), so this warning is unconditional.
cat >&2 <<WARN

render: NOTE -- edge.$ENV_NAME.conf is HTTP-only by construction.
  If certificates already exist on the VPS, copying this file over drops the
  443 blocks until you re-run:
    sudo certbot --nginx -d $BRAND_HOST -d $ADMIN_HOST
  certbot reuses the existing certificate (no re-issue, no rate-limit cost)
  and re-adds the TLS blocks and the HTTP->HTTPS redirect.
WARN
```

Add to `.gitignore`:

```
# rendered nginx configs (derived; certbot edits the deployed edge copy)
deploy/nginx/out/
```

- [ ] **Step 4: Run the test — renderer assertions pass, template-dependent ones fail**

```bash
chmod +x deploy/nginx/render.sh
deploy/nginx/test/run-tests.sh
```

Expected: FAIL. The argument-handling, missing-variable, and `map lives in origin-shared.conf` assertions now pass; everything needing a template still fails. This confirms the renderer works independently of the templates.

- [ ] **Step 5: Commit**

```bash
git add deploy/nginx/env.dev deploy/nginx/env.prod deploy/nginx/render.sh \
        deploy/nginx/origin-shared.conf deploy/nginx/test/ .gitignore
git commit -m "Add nginx config renderer, shared map, and test harness

envsubst renders unset variables as empty strings, which would yield a
broken-but-plausible 'root ;', so render.sh validates required variables
itself. The X-Forwarded-Proto map is http-context and both origin
configs are enabled at once, so it ships as a separate shared file
rather than being duplicated per environment."
```

---

### Task 2: Origin server blocks

**Files:**
- Create: `deploy/nginx/origin.conf.template`
- Test: `deploy/nginx/test/run-tests.sh` (written in Task 1)

**Interfaces:**
- Consumes: env variables from Task 1; the `$ruostack_forwarded_proto` map from `origin-shared.conf`.
- Produces: an upstream named `${API_UPSTREAM}` and two server blocks listening on `${ORIGIN_IP}:${BRAND_ORIGIN_PORT}` and `${ORIGIN_IP}:${ADMIN_ORIGIN_PORT}`. Task 3's edge template proxies to exactly those ports; Task 6's deploy script writes into `${BRAND_ROOT}` / `${ADMIN_ROOT}`.

- [ ] **Step 1: Confirm the test currently fails**

```bash
deploy/nginx/test/run-tests.sh 2>&1 | grep -E "origin|forwarded"
```

Expected: FAIL on the origin, forwarded-header, and syntax assertions.

- [ ] **Step 2: Write the origin template**

Create `deploy/nginx/origin.conf.template`:

```nginx
# RENDERED FILE -- do not edit in place.
# Source: deploy/nginx/origin.conf.template
# Render: deploy/nginx/render.sh <dev|prod>
# Installs on the ORIGIN box (acgserver02) as
#   /etc/nginx/sites-available/ruostack-origin.<env>.conf
#
# Serves the built SPAs and proxies /api to the loopback-bound API. Reachable
# only from the edge VPS over Tailscale. Requires the $ruostack_forwarded_proto
# map from origin-shared.conf, installed once into conf.d/.

upstream ${API_UPSTREAM} {
    server 127.0.0.1:${API_PORT};
    keepalive 32;
}

# ─────────────────────────────────────────────────────────────────────────────
# Customer portal origin -- ${BRAND_HOST} (brand-web + brand API + webhooks)
# ─────────────────────────────────────────────────────────────────────────────
server {
    # Bound to the Tailscale interface specifically, so this port is never
    # exposed on the public interface.
    listen ${ORIGIN_IP}:${BRAND_ORIGIN_PORT};
    server_name ${BRAND_HOST};

    # Only the edge may connect. 127.0.0.1 stays open for local curl checks.
    allow ${EDGE_IP};
    allow 127.0.0.1;
    deny  all;

    root ${BRAND_ROOT};
    index index.html;

    access_log /var/log/nginx/${LOG_PREFIX}-brand-access.log;
    error_log  /var/log/nginx/${LOG_PREFIX}-brand-error.log;

    # Base64 logo upload is ~1 MB; this leaves headroom.
    client_max_body_size 2m;

    gzip             on;
    gzip_min_length  1024;
    gzip_proxied     any;
    gzip_vary        on;
    gzip_types       text/plain text/css application/json application/javascript
                     text/xml application/xml image/svg+xml;

    # The API runs trustProxy:true (apps/api/src/app.ts:40). X-Forwarded-Proto
    # comes from the map, NOT $scheme -- TLS terminated at the edge, so $scheme
    # is "http" here and using it would mark every request insecure.
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $ruostack_forwarded_proto;
    proxy_set_header   Connection        "";
    proxy_read_timeout 60s;

    # Brand API + WooCommerce/ShipStation webhooks. Bodies pass through
    # unmodified, which /api/payments/webhook needs for Stripe signature
    # verification -- do not add any body-rewriting directive here.
    location /api/      { proxy_pass http://${API_UPSTREAM}; }
    location = /healthz { proxy_pass http://${API_UPSTREAM}; }

    # Hashed assets are immutable; the HTML shell must never be cached, or a
    # deploy stays invisible behind a stale index.html.
    location /assets/ {
        try_files $uri =404;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
    location = /index.html { add_header Cache-Control "no-store"; }

    location / { try_files $uri $uri/ /index.html; }
}

# ─────────────────────────────────────────────────────────────────────────────
# Admin portal origin -- ${ADMIN_HOST} (admin-web + admin API + admin auth)
# ─────────────────────────────────────────────────────────────────────────────
server {
    listen ${ORIGIN_IP}:${ADMIN_ORIGIN_PORT};
    server_name ${ADMIN_HOST};

    allow ${EDGE_IP};
    allow 127.0.0.1;
    deny  all;

    root ${ADMIN_ROOT};
    index index.html;

    access_log /var/log/nginx/${LOG_PREFIX}-admin-access.log;
    error_log  /var/log/nginx/${LOG_PREFIX}-admin-error.log;

    client_max_body_size 2m;

    gzip             on;
    gzip_min_length  1024;
    gzip_proxied     any;
    gzip_vary        on;
    gzip_types       text/plain text/css application/json application/javascript
                     text/xml application/xml image/svg+xml;

    add_header X-Frame-Options        DENY         always;
    add_header X-Content-Type-Options nosniff      always;
    add_header Referrer-Policy        same-origin  always;

    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $ruostack_forwarded_proto;
    proxy_set_header   Connection        "";
    proxy_read_timeout 60s;

    location /api/      { proxy_pass http://${API_UPSTREAM}; }
    location /auth/     { proxy_pass http://${API_UPSTREAM}; }   # admin login / refresh / mfa
    location = /healthz { proxy_pass http://${API_UPSTREAM}; }

    location /assets/ {
        try_files $uri =404;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
    location = /index.html { add_header Cache-Control "no-store"; }

    location / { try_files $uri $uri/ /index.html; }
}
```

- [ ] **Step 3: Run the tests**

```bash
deploy/nginx/test/run-tests.sh
```

Expected: origin, forwarded-header, admin-surface, and origin `nginx -t` assertions pass. Edge and landing assertions still fail.

- [ ] **Step 4: Inspect the rendered dev origin by eye**

```bash
deploy/nginx/render.sh dev && cat deploy/nginx/out/origin.dev.conf
```

Confirm: no `${` anywhere; `$host` / `$uri` / `$remote_addr` intact; `listen 100.99.76.119:8901`; upstream `127.0.0.1:3901`; `X-Forwarded-Proto` uses the map variable.

- [ ] **Step 5: Commit**

```bash
git add deploy/nginx/origin.conf.template
git commit -m "Add origin server blocks

Binds the tailscale interface and allows only the edge. X-Forwarded-Proto
comes from the shared map rather than \$scheme: TLS terminates at the
edge, so \$scheme is http here and would mark every request insecure."
```

---

### Task 3: Edge server blocks

**Files:**
- Create: `deploy/nginx/edge.conf.template`
- Test: `deploy/nginx/test/run-tests.sh`

**Interfaces:**
- Consumes: `BRAND_HOST`, `ADMIN_HOST`, `ORIGIN_IP`, `BRAND_ORIGIN_PORT`, `ADMIN_ORIGIN_PORT`, `LOG_PREFIX`.
- Produces: the file copied to the VPS. Certbot rewrites it there.

- [ ] **Step 1: Confirm the failing assertions**

```bash
deploy/nginx/test/run-tests.sh 2>&1 | grep -E "edge"
```

Expected: FAIL on the edge routing and edge syntax assertions.

- [ ] **Step 2: Write the edge template**

Create `deploy/nginx/edge.conf.template`:

```nginx
# RENDERED FILE -- do not edit in place, EXCEPT via certbot (see below).
# Source: deploy/nginx/edge.conf.template
# Render: deploy/nginx/render.sh <dev|prod>   (on the app box, then copy over)
# Installs on the EDGE VPS (srv1153350) as
#   /etc/nginx/sites-available/ruostack-edge.<env>.conf
#
# Terminates TLS and forwards whole hostnames to the origin box over Tailscale.
# Holds no application files -- deploys never touch this machine.
#
# Compression and cache headers are deliberately set at the ORIGIN, not here,
# so there is exactly one place to change them.

# ─────────────────────────────────────────────────────────────────────────────
# ${BRAND_HOST} -> origin :${BRAND_ORIGIN_PORT}
# ─────────────────────────────────────────────────────────────────────────────
server {
    listen 80;
    listen [::]:80;
    server_name ${BRAND_HOST};

    # certbot --nginx adds the 443 listener, cert paths, and the HTTP->HTTPS
    # redirect here. Those edits live in this deployed file, not the template,
    # so re-copying a fresh render drops them -- re-run certbot afterwards.

    location /.well-known/acme-challenge/ { root /var/www/certbot; }

    access_log /var/log/nginx/${LOG_PREFIX}-edge-brand-access.log;
    error_log  /var/log/nginx/${LOG_PREFIX}-edge-brand-error.log;

    client_max_body_size 2m;

    location / {
        proxy_pass http://${ORIGIN_IP}:${BRAND_ORIGIN_PORT};
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        # This is the hop where $scheme is meaningful -- the origin passes this
        # value through rather than recomputing it.
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   Connection        "";
        proxy_read_timeout 60s;
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# ${ADMIN_HOST} -> origin :${ADMIN_ORIGIN_PORT}
# ─────────────────────────────────────────────────────────────────────────────
server {
    listen 80;
    listen [::]:80;
    server_name ${ADMIN_HOST};

    location /.well-known/acme-challenge/ { root /var/www/certbot; }

    access_log /var/log/nginx/${LOG_PREFIX}-edge-admin-access.log;
    error_log  /var/log/nginx/${LOG_PREFIX}-edge-admin-error.log;

    client_max_body_size 2m;

    # Operator surface -- uncomment to allowlist office/VPN IPs. Do this HERE
    # rather than at the origin, so the block applies before the Tailscale hop.
    # Leave it commented while PUBLIC_API_BASE_URL points at this host, or
    # WooCommerce and ShipStation webhook delivery is blocked along with
    # everyone else.
    # allow 203.0.113.0/24;
    # deny  all;

    location / {
        proxy_pass http://${ORIGIN_IP}:${ADMIN_ORIGIN_PORT};
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   Connection        "";
        proxy_read_timeout 60s;
    }
}
```

- [ ] **Step 3: Run the tests**

```bash
deploy/nginx/test/run-tests.sh
```

Expected: all pass except the four landing assertions, which need Task 4.

- [ ] **Step 4: Verify the edge cannot address the API directly**

```bash
grep -E ':(3901|3911)' deploy/nginx/out/edge.dev.conf deploy/nginx/out/edge.prod.conf
```

Expected: no matches. The edge reaches origin nginx only; the API stays loopback-bound.

- [ ] **Step 5: Commit**

```bash
git add deploy/nginx/edge.conf.template
git commit -m "Add edge server blocks for the reverse-proxy VPS

Forwards whole hostnames to origin ports over Tailscale. This is the hop
where \$scheme is meaningful, so it is where X-Forwarded-Proto is set."
```

---

### Task 4: Landing site (prod-only, both roles)

**Files:**
- Create: `deploy/nginx/landing.origin.conf.template`, `deploy/nginx/landing.edge.conf.template`
- Test: `deploy/nginx/test/run-tests.sh`

**Interfaces:**
- Consumes: `LANDING`, `LANDING_HOST`, `LANDING_ROOT`, `LANDING_ORIGIN_PORT` from `env.prod`; appended by `render.sh`.
- Produces: a third server block in each prod render. Site content is out of scope.

Two files rather than one because the landing site needs a block on each machine, and `envsubst` has no conditionals — the prod-only gate is `render.sh` appending them when `LANDING=1`. Keeping it on the origin preserves the VPS as a pure proxy.

- [ ] **Step 1: Confirm the failing assertions**

```bash
deploy/nginx/test/run-tests.sh 2>&1 | grep -i landing
```

Expected: `FAIL prod edge has landing` and `FAIL prod origin has landing`; the two dev assertions pass vacuously.

- [ ] **Step 2: Write both landing templates**

Create `deploy/nginx/landing.origin.conf.template`:

```nginx
# ─────────────────────────────────────────────────────────────────────────────
# Marketing site origin -- ${LANDING_HOST}. Production only; appended by
# render.sh when the env file sets LANDING=1. Static content only, no API.
# The site content itself is out of scope for this repo.
# ─────────────────────────────────────────────────────────────────────────────
server {
    listen ${ORIGIN_IP}:${LANDING_ORIGIN_PORT};
    server_name ${LANDING_HOST} www.${LANDING_HOST};

    allow ${EDGE_IP};
    allow 127.0.0.1;
    deny  all;

    root ${LANDING_ROOT};
    index index.html;

    access_log /var/log/nginx/${LOG_PREFIX}-landing-access.log;
    error_log  /var/log/nginx/${LOG_PREFIX}-landing-error.log;

    gzip             on;
    gzip_min_length  1024;
    gzip_vary        on;
    gzip_types       text/plain text/css application/json application/javascript
                     text/xml application/xml image/svg+xml;

    # Plain static site -- 404 rather than an SPA fallback.
    location / { try_files $uri $uri/ =404; }
}
```

Create `deploy/nginx/landing.edge.conf.template`:

```nginx
# ─────────────────────────────────────────────────────────────────────────────
# Marketing site edge -- ${LANDING_HOST} (+ www) -> origin
# :${LANDING_ORIGIN_PORT}. Production only.
# ─────────────────────────────────────────────────────────────────────────────
server {
    listen 80;
    listen [::]:80;
    server_name ${LANDING_HOST} www.${LANDING_HOST};

    location /.well-known/acme-challenge/ { root /var/www/certbot; }

    access_log /var/log/nginx/${LOG_PREFIX}-edge-landing-access.log;
    error_log  /var/log/nginx/${LOG_PREFIX}-edge-landing-error.log;

    location / {
        proxy_pass http://${ORIGIN_IP}:${LANDING_ORIGIN_PORT};
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   Connection        "";
    }
}
```

- [ ] **Step 3: Run the tests**

```bash
deploy/nginx/test/run-tests.sh
```

Expected: PASS — every assertion, including `nginx -t` for all four rendered configs.

- [ ] **Step 4: Verify the landing site is genuinely absent from dev**

```bash
grep -c ruostack.com deploy/nginx/out/origin.dev.conf deploy/nginx/out/edge.dev.conf    # both 0
grep -c ruostack.com deploy/nginx/out/origin.prod.conf deploy/nginx/out/edge.prod.conf  # both >= 1
```

- [ ] **Step 5: Commit**

```bash
git add deploy/nginx/landing.origin.conf.template deploy/nginx/landing.edge.conf.template
git commit -m "Add prod-only landing site blocks

Separate files rather than flags in the main templates: envsubst has no
conditionals. Served from the origin so the VPS stays a pure proxy."
```

---

### Task 5: PM2 ecosystem config

**Files:**
- Create: `ecosystem.config.cjs` (repo root)
- Create: `deploy/test-ecosystem.sh`

**Interfaces:**
- Consumes: `RUOSTACK_ENV` (`dev` default, or `prod`).
- Produces: PM2 apps `ruostack-api-dev` / `ruostack-api-prod` running `apps/api/dist/server.js` on `127.0.0.1:3901` / `:3911`. Task 6 calls `pm2 reload <name>`; Task 2's origin upstream targets those ports.

`.cjs` because PM2 requires CommonJS for ecosystem files, matching `/apps/dev/ship3/ecosystem.config.cjs` on this box.

- [ ] **Step 1: Write the failing test**

Create `deploy/test-ecosystem.sh`:

```bash
#!/usr/bin/env bash
# Tests for the PM2 ecosystem config and the deploy script's guards.
# Run: deploy/test-ecosystem.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0; FAIL=0
ok()  { printf '  ok   %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; FAIL=$((FAIL+1)); }

field() { # <env> <js-expression-on-app>
  RUOSTACK_ENV="$1" node -e "
    const c = require('$ROOT/ecosystem.config.cjs');
    const app = c.apps[0];
    process.stdout.write(String($2));
  " 2>/dev/null
}
expect() { # <description> <actual> <wanted>
  [[ "$2" == "$3" ]] && ok "$1" || bad "$1" "got '$2', want '$3'"
}

echo "== dev defaults =="
expect "defaults to dev name"  "$(field dev 'app.name')"         "ruostack-api-dev"
expect "dev port 3901"         "$(field dev 'app.env.API_PORT')" "3901"

echo "== prod =="
expect "prod name"             "$(field prod 'app.name')"         "ruostack-api-prod"
expect "prod port 3911"        "$(field prod 'app.env.API_PORT')" "3911"

echo "== invariants =="
expect "runs the compiled entrypoint" "$(field dev 'app.script')"      "apps/api/dist/server.js"
expect "binds loopback only"          "$(field dev 'app.env.API_HOST')" "127.0.0.1"
expect "NODE_ENV=production"          "$(field dev 'app.env.NODE_ENV')" "production"
# Four background workers start unconditionally in apps/api/src/server.ts, so a
# second instance would double every sweep.
expect "single instance"              "$(field dev 'app.instances')"    "1"
expect "fork mode"                    "$(field dev 'app.exec_mode')"    "fork"
expect "dev log path"   "$(field dev 'app.error_file')"  "/var/log/ruostack-dev/error.log"
expect "prod log path"  "$(field prod 'app.error_file')" "/var/log/ruostack-prod/error.log"

echo "== rejects a bad environment =="
if RUOSTACK_ENV=staging node -e "require('$ROOT/ecosystem.config.cjs')" >/dev/null 2>&1; then
  bad "unknown RUOSTACK_ENV throws" "loaded without error"
else
  ok "unknown RUOSTACK_ENV throws"
fi

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
chmod +x deploy/test-ecosystem.sh
deploy/test-ecosystem.sh
```

Expected: FAIL — `ecosystem.config.cjs` does not exist.

- [ ] **Step 3: Write the ecosystem config**

Create `ecosystem.config.cjs` at the repo root:

```js
// PM2 process config for the RUOStack API.
//
//   pm2 start ecosystem.config.cjs                     # dev checkout
//   RUOSTACK_ENV=prod pm2 start ecosystem.config.cjs   # prod checkout
//   pm2 save                                           # persist across reboots
//
// Dev and prod are two checkouts of this repo (/apps/dev/ruo-stack and
// /apps/prod/ruo-stack) on the same box, because apps/api/src/config.ts loads
// .env from the repo root relative to its own source file -- one directory can
// only ever bind to one database.
//
// Runs the COMPILED api (apps/api/dist/server.js), never tsx watch: dev and
// prod must execute the same artifact from the same build.

const ENV = process.env.RUOSTACK_ENV || 'dev';

if (ENV !== 'dev' && ENV !== 'prod') {
  throw new Error(`RUOSTACK_ENV must be "dev" or "prod", got "${ENV}"`);
}

const API_PORT = ENV === 'prod' ? '3911' : '3901';

module.exports = {
  apps: [
    {
      name: `ruostack-api-${ENV}`,
      // cwd pinned to this file's directory so dotenv resolves the repo-root
      // .env no matter where pm2 was invoked from.
      cwd: __dirname,
      script: 'apps/api/dist/server.js',
      // Single instance: the rate-quote sweeper, reconciliation, dunning, and
      // subscription-lapse workers all start unconditionally in
      // apps/api/src/server.ts, so a second instance doubles every sweep.
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      max_memory_restart: '500M',
      watch: false,
      // PM2 exports these before spawn and dotenv runs with override:false, so
      // they win over .env -- the port and loopback binding stay pinned even if
      // .env drifts. Only origin nginx reaches this port.
      env: {
        NODE_ENV: 'production',
        API_HOST: '127.0.0.1',
        API_PORT,
      },
      out_file: `/var/log/ruostack-${ENV}/out.log`,
      error_file: `/var/log/ruostack-${ENV}/error.log`,
      merge_logs: true,
      time: true,
    },
  ],
};
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
deploy/test-ecosystem.sh
```

Expected: PASS, 11 passed / 0 failed.

- [ ] **Step 5: Commit**

```bash
git add ecosystem.config.cjs deploy/test-ecosystem.sh
git commit -m "Add PM2 ecosystem config keyed on RUOSTACK_ENV

Single instance is required, not just simplest: four background workers
start unconditionally in server.ts, so a second instance would double
every sweep."
```

---

### Task 6: Deploy script

**Files:**
- Create: `deploy/deploy.sh`
- Modify: `deploy/test-ecosystem.sh`

**Interfaces:**
- Consumes: `deploy/nginx/env.<env>`; the PM2 process names from Task 5.
- Produces: populated webroots and a reloaded API. Terminal deliverable — never touches the VPS.

- [ ] **Step 1: Write the failing test**

Insert into `deploy/test-ecosystem.sh`, immediately before the final `printf`:

```bash
echo "== deploy.sh guards =="

if [[ ! -x "$ROOT/deploy/deploy.sh" ]]; then
  bad "deploy.sh exists and is executable" "missing or not +x"
else
  ok "deploy.sh exists and is executable"

  if "$ROOT/deploy/deploy.sh" staging >/dev/null 2>&1; then
    bad "rejects unknown env" "exited 0"
  else ok "rejects unknown env"; fi

  if "$ROOT/deploy/deploy.sh" >/dev/null 2>&1; then
    bad "requires an argument" "exited 0"
  else ok "requires an argument"; fi

  # The guard that matters: the two checkouts are identical except for .env, so
  # a prod deploy fired from the dev directory would publish dev's database
  # config to the prod hosts. It must also fail FAST, before any build.
  if [[ "$ROOT" == */apps/dev/* ]]; then
    start=$SECONDS
    if "$ROOT/deploy/deploy.sh" prod >/dev/null 2>&1; then
      bad "blocks prod from a dev checkout" "exited 0"
    else
      ok "blocks prod from a dev checkout"
      (( SECONDS - start < 10 )) && ok "guard fails fast (before any build)" \
                                 || bad "guard fails fast (before any build)" "took $((SECONDS-start))s"
    fi
  fi
fi
```

- [ ] **Step 2: Run to verify it fails**

```bash
deploy/test-ecosystem.sh
```

Expected: `FAIL deploy.sh exists and is executable`.

- [ ] **Step 3: Write the deploy script**

Create `deploy/deploy.sh`:

```bash
#!/usr/bin/env bash
# Build and publish RUOStack for one environment. Runs on the ORIGIN box only --
# the edge VPS holds no application files and is never touched by a deploy.
#
#   deploy/deploy.sh dev    # run from /apps/dev/ruo-stack
#   deploy/deploy.sh prod   # run from /apps/prod/ruo-stack
#
# Must run from the checkout matching the environment: dev and prod are separate
# clones with separate .env files (apps/api/src/config.ts loads .env from the
# repo root, so a checkout binds to exactly one database).
set -euo pipefail

ENV_NAME="${1:-}"
if [[ "$ENV_NAME" != "dev" && "$ENV_NAME" != "prod" ]]; then
  echo "usage: deploy.sh <dev|prod>" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/deploy/nginx/env.$ENV_NAME"
[[ -f "$ENV_FILE" ]] || { echo "deploy: missing $ENV_FILE" >&2; exit 2; }

# Guard first, before any build: a prod deploy fired from the dev directory
# would publish dev's database config to the prod hosts.
case "$ENV_NAME" in
  dev)  [[ "$ROOT" == */apps/dev/*  ]] || { echo "deploy: refusing -- 'dev' must run from a /apps/dev/ checkout (this is $ROOT)"  >&2; exit 1; } ;;
  prod) [[ "$ROOT" == */apps/prod/* ]] || { echo "deploy: refusing -- 'prod' must run from a /apps/prod/ checkout (this is $ROOT)" >&2; exit 1; } ;;
esac

[[ -f "$ROOT/.env" ]] || { echo "deploy: no .env in $ROOT" >&2; exit 1; }

set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

echo "==> deploying $ENV_NAME from $ROOT"

cd "$ROOT"
pnpm install --frozen-lockfile

echo "==> applying database migrations"
pnpm --filter @ruostack/db run deploy

echo "==> building api"
pnpm --filter @ruostack/api build

# Both SPAs bake VITE_API_BASE_URL in at build time and fall back to
# ${hostname}:3901 when unset (apps/brand-web/src/lib/api.ts:9). They share the
# root .env, so the override goes inline and the builds run sequentially --
# they would otherwise overwrite each other's dist/.
echo "==> building brand-web for https://$BRAND_HOST"
VITE_API_BASE_URL="https://$BRAND_HOST" pnpm --filter @ruostack/brand-web build

echo "==> building admin-web for https://$ADMIN_HOST"
VITE_API_BASE_URL="https://$ADMIN_HOST" pnpm --filter @ruostack/admin-web build

echo "==> publishing to webroots"
sudo mkdir -p "$BRAND_ROOT" "$ADMIN_ROOT"
sudo rsync -a --delete "$ROOT/apps/brand-web/dist/" "$BRAND_ROOT/"
sudo rsync -a --delete "$ROOT/apps/admin-web/dist/" "$ADMIN_ROOT/"

echo "==> reloading api"
if pm2 describe "ruostack-api-$ENV_NAME" >/dev/null 2>&1; then
  pm2 reload "ruostack-api-$ENV_NAME"
else
  RUOSTACK_ENV="$ENV_NAME" pm2 start "$ROOT/ecosystem.config.cjs"
  pm2 save
fi

cat <<DONE

==> done. verify the origin directly (bypasses the edge):
    curl -H 'Host: $BRAND_HOST' http://$ORIGIN_IP:$BRAND_ORIGIN_PORT/healthz
  then end to end:
    curl -sS https://$BRAND_HOST/healthz
DONE
```

- [ ] **Step 4: Run the tests to verify the guards pass**

```bash
chmod +x deploy/deploy.sh
deploy/test-ecosystem.sh
```

Expected: PASS, including all four guard assertions. The prod-from-dev guard must return in under 10 seconds, proving it fires before `pnpm install`.

- [ ] **Step 5: Commit**

```bash
git add deploy/deploy.sh deploy/test-ecosystem.sh
git commit -m "Add deploy script with checkout/environment guard

The two checkouts are identical except for .env, so a prod deploy fired
from the dev directory would publish dev's database config to the prod
hosts. The guard runs before any build step."
```

---

### Task 7: Documentation and removal of the superseded config

**Files:**
- Rewrite: `deploy/nginx/README.md`
- Delete: `deploy/nginx/ruostack.conf`

- [ ] **Step 1: Delete the superseded config**

```bash
git rm deploy/nginx/ruostack.conf
```

It was never deployed (absent from `/etc/nginx/sites-enabled/`), assumes nginx runs beside the app, and is superseded. Leaving it gives operators a plausible-but-wrong file to install.

- [ ] **Step 2: Rewrite the README**

Replace `deploy/nginx/README.md` with:

````markdown
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
````

- [ ] **Step 3: Verify the full test suite passes**

```bash
deploy/nginx/test/run-tests.sh && deploy/test-ecosystem.sh
```

Expected: both PASS.

- [ ] **Step 4: Verify no reference to the deleted file survives**

```bash
grep -rn "nginx/ruostack\.conf" --include='*.md' --include='*.sh' . | grep -v node_modules
```

Expected: no hits.

- [ ] **Step 5: Commit**

```bash
git add -A deploy/nginx/README.md
git commit -m "Document the edge/origin runbook; drop superseded config

Deletes the never-deployed deploy/nginx/ruostack.conf, which assumed
nginx ran beside the app."
```

---

### Task 8: Install and cut over (blocked on DNS)

**Files:** none — this changes both machines, not the repo.

**Blocked until** A records for `app.dev.ruostack.io` and `backend.dev.ruostack.io`
resolve to the **edge VPS's public IP**. Verify first:

```bash
dig +short app.dev.ruostack.io A backend.dev.ruostack.io A
ssh srv1153350 'curl -s https://api.ipify.org'   # must match
```

- [ ] **Step 1: Prepare the origin box**

```bash
sudo mkdir -p /var/www/app.dev.ruostack.io/html /var/www/backend.dev.ruostack.io/html
sudo mkdir -p /var/log/ruostack-dev
sudo chown -R "$USER" /var/log/ruostack-dev
sudo cp deploy/nginx/origin-shared.conf /etc/nginx/conf.d/ruostack-shared.conf
```

Then set in `/apps/dev/ruo-stack/.env`:

```ini
API_HOST=127.0.0.1
API_PORT=3901
CORS_ORIGINS=https://app.dev.ruostack.io,https://backend.dev.ruostack.io
PUBLIC_API_BASE_URL=https://backend.dev.ruostack.io
```

- [ ] **Step 2: Install the origin config and verify in isolation**

```bash
deploy/nginx/test/run-tests.sh
deploy/nginx/render.sh dev
sudo cp deploy/nginx/out/origin.dev.conf /etc/nginx/sites-available/ruostack-origin.dev.conf
sudo ln -sf /etc/nginx/sites-available/ruostack-origin.dev.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
deploy/deploy.sh dev
curl -H 'Host: app.dev.ruostack.io' http://100.99.76.119:8901/healthz
```

Expected: `nginx -t` OK — this also proves nothing collides with the six sites
already enabled here — and the health payload returns. The origin is now proven
before the edge is involved.

- [ ] **Step 3: Verify the origin's access control and API isolation**

```bash
# From a DIFFERENT tailscale peer (not the edge, not this box):
curl -sS --max-time 5 http://100.99.76.119:8901/healthz    # expect 403
curl -sS --max-time 5 http://100.99.76.119:3901/healthz    # expect connection refused
```

The first proves `allow`/`deny`; the second proves the API is loopback-bound.

- [ ] **Step 4: Install the edge config and verify over HTTP**

```bash
scp deploy/nginx/out/edge.dev.conf srv1153350:/tmp/
ssh srv1153350 'sudo mkdir -p /var/www/certbot && \
  sudo mv /tmp/edge.dev.conf /etc/nginx/sites-available/ruostack-edge.dev.conf && \
  sudo ln -sf /etc/nginx/sites-available/ruostack-edge.dev.conf /etc/nginx/sites-enabled/ && \
  sudo nginx -t && sudo systemctl reload nginx'

curl -sS http://app.dev.ruostack.io/healthz
curl -sI http://app.dev.ruostack.io/orders | head -1
```

Expected: the health payload, and `HTTP/1.1 200 OK` for the deep link.

- [ ] **Step 5: Issue certificates and verify end to end**

```bash
ssh srv1153350 'sudo certbot --nginx -d app.dev.ruostack.io -d backend.dev.ruostack.io'

curl -sS https://app.dev.ruostack.io/healthz
curl -sI http://app.dev.ruostack.io/ | head -1     # expect 301 -> https
pm2 save && pm2 describe ruostack-api-dev
```

Then log into the admin portal and confirm two things in the audit log: the entry
records the **real client IP** (not `100.99.76.10`), and the request registers as
HTTPS. The first proves the forwarded chain across both hops; the second proves the
`X-Forwarded-Proto` passthrough.

---

## Self-Review

**Spec coverage.** Topology → Tasks 2, 3, 7 (README), 8. Origin port map → Task 1 env
files, asserted in Task 1's tests. Templates + renderer → Tasks 1–4. Edge behaviour →
Task 3. Origin behaviour → Task 2. Shared map → Task 1. TLS + re-render caveat → Task 1
(`render.sh` warning), Task 7 (README). PM2 → Task 5. Deploy script → Task 6. `.env`
values → Tasks 7 and 8. Prerequisites/ordering → Task 8. Testing → Task 1's harness,
exercised throughout; the spec's isolation checks are Task 8 Step 3. Out-of-scope items
are correctly absent.

**Known gap, accepted:** the spec puts Prisma migrations before the build in
`deploy.sh`, and Task 6 implements that. Whether prod migrations should be gated behind
a manual step is deliberately unresolved, since prod is out of scope until
`/apps/prod/ruo-stack` exists. Revisit before the first prod deploy.

**Placeholder scan:** no TBDs. Every code step carries literal file content.

**Type consistency:** variable names match across env files, `render.sh`'s `REQUIRED`
array, its `SUBST` allowlist, all four templates, and `deploy.sh` (`BRAND_HOST`,
`ADMIN_HOST`, `ORIGIN_IP`, `EDGE_IP`, `BRAND_ORIGIN_PORT`, `ADMIN_ORIGIN_PORT`,
`API_PORT`, `API_UPSTREAM`, `BRAND_ROOT`, `ADMIN_ROOT`, `LOG_PREFIX`, `LANDING`,
`LANDING_HOST`, `LANDING_ROOT`, `LANDING_ORIGIN_PORT`). The map variable
`$ruostack_forwarded_proto` is spelled identically in `origin-shared.conf`,
`origin.conf.template`, and the test asserting it. PM2 names `ruostack-api-<env>` match
across `ecosystem.config.cjs`, `deploy.sh`, the README, and the tests. Port values
3901/3911 and 8901/8902/8911/8912/8913 are consistent everywhere they appear.
