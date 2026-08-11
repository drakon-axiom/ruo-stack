#!/usr/bin/env bash
# Refuse a deploy whose repo-root .env does not point at the Supabase project
# this environment is pinned to.
#
#   check-env-ref.sh <env-file> <expected-project-ref>
#
# Exit 0 = every ref agrees with <expected-project-ref>. Exit 1 = mismatch or
# unreadable input. Exit 2 = called wrong.
#
# Why this exists: deploy/deploy.sh already refuses to run 'prod' from a dev
# checkout, but that guards the *host* config only -- nothing checks which
# database the .env in that checkout actually points at. Dev and prod were a
# single shared Supabase project until 2026-08-10, so there was nothing to
# check; with two projects, a stale .env silently migrates the wrong database.
#
# The realistic failure is not deploying the wrong thing on purpose. It is a
# half-edited .env: SUPABASE_URL moved to the new project, DIRECT_URL left on
# the old one. Migrations then run against one database while the app talks to
# another, and every step reports success.
#
# The project ref appears in all three values, so they can be cross-checked:
#   DATABASE_URL  postgresql://prisma.<ref>:<pw>@<pooler>:6543/postgres
#   DIRECT_URL    postgresql://postgres.<ref>:<pw>@<pooler>:5432/postgres
#   SUPABASE_URL  https://<ref>.supabase.co
#
# Values are read by pattern-matching the file, never by sourcing it. Sourcing
# evaluates every value as shell: a '$' or backtick in a rotated database
# password would expand or execute (see packages/db/with-env.sh for the same
# reasoning applied to the Prisma CLI's environment).
set -uo pipefail

ENV_FILE="${1:-}"
EXPECTED="${2:-}"
if [[ -z "$ENV_FILE" || -z "$EXPECTED" ]]; then
  echo "usage: check-env-ref.sh <env-file> <expected-project-ref>" >&2
  exit 2
fi

[[ -e "$ENV_FILE" ]] || { echo "deploy: no .env at $ENV_FILE" >&2; exit 1; }
[[ -r "$ENV_FILE" ]] || { echo "deploy: cannot read $ENV_FILE (check permissions)" >&2; exit 1; }

# Last assignment wins, matching dotenv. Strips one layer of matching quotes.
# No expansion happens: sed only ever sees the value as text.
read_key() {
  sed -n "s/^[[:space:]]*$1=//p" "$ENV_FILE" \
    | tail -n 1 \
    | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}

# Userinfo of a postgres URL is '<role>.<ref>'; take the segment after the dot.
# Cutting at the first ':' after '://' keeps a password containing '.' or '@'
# from being mistaken for the host.
ref_from_pg_url() {
  local url="$1" userinfo
  userinfo="${url#*://}"
  userinfo="${userinfo%%:*}"
  [[ "$userinfo" == *.* ]] || return 1
  printf '%s' "${userinfo#*.}"
}

ref_from_supabase_url() {
  local host="${1#*://}"
  host="${host%%/*}"
  [[ "$host" == *.supabase.co* ]] || return 1
  printf '%s' "${host%%.*}"
}

problems=()

extract() { # extract <key> <extractor>
  local key="$1" fn="$2" raw ref
  raw="$(read_key "$key")"
  if [[ -z "$raw" ]]; then
    problems+=("$key is missing from $ENV_FILE")
    return
  fi
  if ! ref="$("$fn" "$raw")" || [[ -z "$ref" ]]; then
    problems+=("$key has no recognisable Supabase project ref")
    return
  fi
  # Supabase refs are 20 lowercase alphanumerics. Anything else means the value
  # is some other kind of URL and comparing it would be meaningless.
  if [[ ! "$ref" =~ ^[a-z0-9]{20}$ ]]; then
    problems+=("$key has no recognisable Supabase project ref")
    return
  fi
  if [[ "$ref" != "$EXPECTED" ]]; then
    problems+=("$key points at project '$ref', expected '$EXPECTED'")
  fi
}

extract DATABASE_URL ref_from_pg_url
extract DIRECT_URL   ref_from_pg_url
extract SUPABASE_URL ref_from_supabase_url

if [[ ${#problems[@]} -gt 0 ]]; then
  echo "deploy: refusing -- $ENV_FILE does not match the pinned Supabase project '$EXPECTED'" >&2
  for p in "${problems[@]}"; do
    echo "  - $p" >&2
  done
  echo "  Nothing was built or migrated. Fix .env, or correct SUPABASE_REF for this environment." >&2
  exit 1
fi
