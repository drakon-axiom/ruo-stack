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

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
ENV_FILE="$ROOT/deploy/nginx/env.$ENV_NAME"
[[ -f "$ENV_FILE" ]] || { echo "deploy: missing $ENV_FILE" >&2; exit 2; }

# Guard first, before any build: a prod deploy fired from the dev directory
# would publish dev's database config to the prod hosts.
case "$ENV_NAME" in
  dev)  [[ "$ROOT" == */apps/dev/*  ]] || { echo "deploy: refusing -- 'dev' must run from a /apps/dev/ checkout (this is $ROOT)"  >&2; exit 1; } ;;
  prod) [[ "$ROOT" == */apps/prod/* ]] || { echo "deploy: refusing -- 'prod' must run from a /apps/prod/ checkout (this is $ROOT)" >&2; exit 1; } ;;
esac

[[ -f "$ROOT/.env" ]] || { echo "deploy: no .env in $ROOT" >&2; exit 1; }

# Deliberately NOT `set -a`: env.<env> defines API_PORT and API_HOST, which are
# real config keys read by apps/api/src/config.ts. Exporting them would leak
# them into pnpm -> vite -> node for every build step below. Sourcing without
# auto-export leaves them as ordinary shell variables -- readable here, invisible
# to children. Anything a child genuinely needs is passed inline at its call site
# (VITE_API_BASE_URL, RUOSTACK_ENV).
# shellcheck source=/dev/null
source "$ENV_FILE"

# set -u catches unset but NOT empty. An empty *_ROOT would make the rsync
# target "/", so require both to be non-empty and under /var/www before any
# --delete runs.
for var in BRAND_HOST ADMIN_HOST BRAND_ROOT ADMIN_ROOT; do
  [[ -n "${!var:-}" ]] || { echo "deploy: $ENV_FILE has empty $var" >&2; exit 1; }
done
for var in BRAND_ROOT ADMIN_ROOT; do
  case "${!var}" in
    /var/www/*) ;;
    *) echo "deploy: refusing -- $var must be under /var/www (got '${!var}')" >&2; exit 1 ;;
  esac
done

# Still guarding before any build: the checkout guard above proves this is the
# right *directory*, not that its .env points at the right *database*. Until
# 2026-08-10 dev and prod shared one Supabase project, so there was nothing to
# check; now a stale or half-edited .env would migrate the wrong one silently.
[[ -n "${SUPABASE_REF:-}" ]] || { echo "deploy: $ENV_FILE has empty SUPABASE_REF" >&2; exit 1; }
"$ROOT/deploy/check-env-ref.sh" "$ROOT/.env" "$SUPABASE_REF"

echo "==> deploying $ENV_NAME from $ROOT"

cd "$ROOT"
# Every step below is idempotent (install, migrate deploy, build, rsync
# --delete, pm2 reload/start) -- if the script dies partway through, re-run it
# rather than trying to hand-roll a rollback.
pnpm install --frozen-lockfile

# Migrations run before the build. If the build then fails, the database is
# left ahead of the deployed code. That ordering is a recorded project
# decision, not an oversight here -- it is flagged for deliberate review
# before the first production deploy.
#
# The db package supplies its own connection vars (packages/db/with-env.sh). It
# has to: the Prisma CLI only looks for .env beside the schema or in its cwd, and
# there is no .env there -- so this step used to abort the whole deploy on
# `Environment variable not found: DIRECT_URL` unless the operator happened to
# have the URLs exported already. That script reads the two keys out of the
# repo-root .env without sourcing it, and exports nothing else.
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
# pm2 reload does NOT re-read ecosystem.config.cjs -- it restarts the running
# process with its already-loaded settings. A port or env change here needs a
# delete-and-start, not a reload, or the process keeps its stale config.
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
