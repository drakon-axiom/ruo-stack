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

# The edge config serves every hostname it renders, so the recovery command must
# name every one of them. Omitting the marketing hosts when LANDING=1 would leave
# ruostack.com HTTP-only after a re-render.
CERTBOT_HOSTS="-d $BRAND_HOST -d $ADMIN_HOST"
if [[ "${LANDING:-0}" == "1" ]]; then
  CERTBOT_HOSTS+=" -d $LANDING_HOST -d www.$LANDING_HOST"
fi

# certbot --nginx edits the DEPLOYED edge config on the VPS, not this template,
# so every fresh render is HTTP-only. render.sh cannot detect an existing
# certificate (wrong machine), so this warning is unconditional.
cat >&2 <<WARN

render: NOTE -- edge.$ENV_NAME.conf is HTTP-only by construction.
  If certificates already exist on the VPS, copying this file over drops the
  443 blocks until you re-run:
    sudo certbot --nginx $CERTBOT_HOSTS
  certbot reuses the existing certificate (no re-issue, no rate-limit cost)
  and re-adds the TLS blocks and the HTTP->HTTPS redirect.
WARN
