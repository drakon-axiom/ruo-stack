#!/usr/bin/env sh
# Supply DATABASE_URL and DIRECT_URL to the Prisma CLI, then exec it.
#
#   with-env.sh prisma migrate deploy
#
# The Prisma CLI looks for .env beside the schema or in its cwd. pnpm --filter
# sets cwd to packages/db, and there is no .env there -- only the repo root has
# one -- so without this the step aborts on
# "Environment variable not found: DIRECT_URL".
#
# Resolution is per key: an exported value always wins, otherwise the repo-root
# .env supplies it. That keeps CI working, where both URLs are exported by the
# workflow and no .env exists at all.
#
# Two things this deliberately does NOT do, both of which the previous
# package.json one-liner did:
#
#   1. It does not source .env. `. .env` is not a parser, it is evaluation:
#      double-quoted values still undergo parameter expansion and command
#      substitution, so a '$' in a generated database password expands (a '$$'
#      becomes a PID) and a backtick executes as the deploying user. Both fail
#      silently with exit 0, leaving a corrupted connection URL nobody can see.
#      Generated passwords routinely contain '$'.
#
#   2. It does not use `set -a`. That exported the entire secrets file --
#      Stripe keys, admin JWT secret, both AES-256-GCM keys -- into every Prisma
#      child, including `prisma studio`, which serves a web UI. deploy/deploy.sh
#      explains at length why it is "Deliberately NOT `set -a`" for a committed
#      config file; the same reasoning applies with more force to secrets.
#
# See deploy/check-env-ref.sh for the same no-sourcing rule applied at deploy time.
set -eu

if [ -z "${ENV_FILE:-}" ]; then
  ENV_FILE="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)/.env"
fi

# Last assignment wins, matching dotenv. Strips one layer of matching quotes.
# sed only ever sees the value as text, so nothing in it is evaluated.
read_key() {
  sed -n "s/^[[:space:]]*$1=//p" "$2" 2>/dev/null \
    | tail -n 1 \
    | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}

if [ -r "$ENV_FILE" ]; then
  if [ -z "${DATABASE_URL:-}" ]; then
    _v="$(read_key DATABASE_URL "$ENV_FILE" || true)"
    if [ -n "$_v" ]; then
      DATABASE_URL="$_v"
      export DATABASE_URL
    fi
  fi
  if [ -z "${DIRECT_URL:-}" ]; then
    _v="$(read_key DIRECT_URL "$ENV_FILE" || true)"
    if [ -n "$_v" ]; then
      DIRECT_URL="$_v"
      export DIRECT_URL
    fi
  fi
  unset _v
fi

# Exec even when neither source supplied a value: Prisma's own P1012 names the
# missing variable, which is more useful than a message invented here.
exec "$@"
