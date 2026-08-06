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
  sudo mkdir -p "/var/log/ruostack-$ENV_NAME"
  sudo chown -R "$USER" "/var/log/ruostack-$ENV_NAME"
  RUOSTACK_ENV="$ENV_NAME" pm2 start "$ROOT/ecosystem.config.cjs"
  pm2 save
fi

cat <<DONE

==> done. verify the origin directly (bypasses the edge):
    curl -H 'Host: $BRAND_HOST' http://$ORIGIN_IP:$BRAND_ORIGIN_PORT/healthz
  then end to end:
    curl -sS https://$BRAND_HOST/healthz
DONE
