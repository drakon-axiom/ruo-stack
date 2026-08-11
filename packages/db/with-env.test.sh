#!/usr/bin/env bash
# Tests for with-env.sh — supplies DATABASE_URL/DIRECT_URL to the Prisma CLI.
#
# Two behaviours must hold simultaneously and pull in opposite directions:
#   * CI exports both URLs and ships no .env  -> the environment must win.
#   * The origin box has a .env and no exports -> the file must be used.
# Everything else here is a regression test for how the previous one-liner
# (`set -a; . ../../.env`) failed: it evaluated secrets as shell and exported
# the entire file into the child.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
WITH_ENV="$HERE/with-env.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0
fail=0

check() { # check <name> <expected> <actual>
  if [[ "$2" == "$3" ]]; then
    printf '  ok    %s\n' "$1"; pass=$((pass + 1))
  else
    printf '  FAIL  %s\n        expected: %s\n        actual:   %s\n' "$1" "$2" "$3"; fail=$((fail + 1))
  fi
}

cat > "$TMP/.env" <<'EOF'
# RUOStack .env
DATABASE_URL="postgresql://prisma.fileref:filepw@pooler:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.fileref:filepw@pooler:5432/postgres"
STRIPE_SECRET_KEY="sk_live_must_not_leak"
JWT_ADMIN_SECRET="admin_secret_must_not_leak"
MFA_ENCRYPTION_KEY="bWZhX2tleV9tdXN0X25vdF9sZWFr"
EOF

run() { ENV_FILE="$TMP/.env" "$WITH_ENV" "$@"; }
run_noenv() { ENV_FILE="$TMP/absent.env" "$WITH_ENV" "$@"; }

echo "with-env.sh"

# 1. No ambient vars: both come from the file.
got=$(env -u DATABASE_URL -u DIRECT_URL "$BASH" -c 'ENV_FILE="'"$TMP"'/.env" "'"$WITH_ENV"'" printenv DATABASE_URL')
check "reads DATABASE_URL from .env when unset" \
  "postgresql://prisma.fileref:filepw@pooler:6543/postgres?pgbouncer=true" "$got"

got=$(env -u DATABASE_URL -u DIRECT_URL "$BASH" -c 'ENV_FILE="'"$TMP"'/.env" "'"$WITH_ENV"'" printenv DIRECT_URL')
check "reads DIRECT_URL from .env when unset" \
  "postgresql://postgres.fileref:filepw@pooler:5432/postgres" "$got"

# 2. THE CI PATH. Both exported, no .env present -> environment is used as-is.
got=$(DATABASE_URL=postgresql://ci/db DIRECT_URL=postgresql://ci/direct \
      "$BASH" -c 'ENV_FILE="'"$TMP"'/absent.env" "'"$WITH_ENV"'" printenv DATABASE_URL')
check "CI path: exported DATABASE_URL survives with no .env" "postgresql://ci/db" "$got"

# 3. Environment beats the file, for DATABASE_URL...
got=$(DATABASE_URL=postgresql://ambient/db env -u DIRECT_URL \
      "$BASH" -c 'ENV_FILE="'"$TMP"'/.env" "'"$WITH_ENV"'" printenv DATABASE_URL')
check "exported DATABASE_URL beats .env" "postgresql://ambient/db" "$got"

# 4. ...and symmetrically for DIRECT_URL. The old script probed only DIRECT_URL,
#    so precedence was inconsistent between the two keys.
got=$(DIRECT_URL=postgresql://ambient/direct env -u DATABASE_URL \
      "$BASH" -c 'ENV_FILE="'"$TMP"'/.env" "'"$WITH_ENV"'" printenv DIRECT_URL')
check "exported DIRECT_URL beats .env (symmetric with DATABASE_URL)" "postgresql://ambient/direct" "$got"

# 5. Mixed: one exported, the other from the file. Each key resolves on its own.
got=$(DIRECT_URL=postgresql://ambient/direct env -u DATABASE_URL \
      "$BASH" -c 'ENV_FILE="'"$TMP"'/.env" "'"$WITH_ENV"'" printenv DATABASE_URL')
check "falls back to .env per-key when only DIRECT_URL is exported" \
  "postgresql://prisma.fileref:filepw@pooler:6543/postgres?pgbouncer=true" "$got"

# 6. THE LEAK. `set -a` exported the whole secrets file into the child, which
#    includes `prisma studio` -- a web UI.
leaked=$(env -u DATABASE_URL -u DIRECT_URL "$BASH" -c 'ENV_FILE="'"$TMP"'/.env" "'"$WITH_ENV"'" printenv' \
         | grep -cE '^(STRIPE_SECRET_KEY|JWT_ADMIN_SECRET|MFA_ENCRYPTION_KEY)=')
check "exports no .env key other than the two URLs" "0" "$leaked"

# 7. THE EVAL HAZARD. A generated password containing '$' or backticks must
#    reach Prisma byte-for-byte, not expanded or executed.
cat > "$TMP/evil.env" <<'EOF'
DATABASE_URL="postgresql://prisma.ref:pa$$w0rd@pooler:6543/postgres"
DIRECT_URL="postgresql://postgres.ref:x`id -un`y@pooler:5432/postgres"
EOF
got=$(env -u DATABASE_URL -u DIRECT_URL "$BASH" -c 'ENV_FILE="'"$TMP"'/evil.env" "'"$WITH_ENV"'" printenv DATABASE_URL')
check "does not expand \$\$ in a password" 'postgresql://prisma.ref:pa$$w0rd@pooler:6543/postgres' "$got"

got=$(env -u DATABASE_URL -u DIRECT_URL "$BASH" -c 'ENV_FILE="'"$TMP"'/evil.env" "'"$WITH_ENV"'" printenv DIRECT_URL')
check "does not execute backticks in a password" 'postgresql://postgres.ref:x`id -un`y@pooler:5432/postgres' "$got"

# 8. Neither source available: exec anyway and let Prisma report its own error.
#    Swallowing this into a bespoke message would hide P1012's detail.
got=$(env -u DATABASE_URL -u DIRECT_URL "$BASH" -c 'ENV_FILE="'"$TMP"'/absent.env" "'"$WITH_ENV"'" printenv DATABASE_URL; echo "rc=$?"')
check "no .env and no exports: runs the child anyway" "rc=1" "$got"

# 9. Argument passthrough, including flags and spaces.
got=$(run printf '%s|%s|%s' a "b c" --schema=x)
check "passes arguments through verbatim" "a|b c|--schema=x" "$got"

# 10. Child exit status must propagate, or a failed migration would look green.
run sh -c 'exit 42'; got=$?
check "propagates the child exit code" "42" "$got"

# 11. Quoting styles in .env: unquoted and single-quoted values.
cat > "$TMP/quotes.env" <<'EOF'
DATABASE_URL=postgresql://bare/db
DIRECT_URL='postgresql://single/direct'
EOF
got=$(env -u DATABASE_URL -u DIRECT_URL "$BASH" -c 'ENV_FILE="'"$TMP"'/quotes.env" "'"$WITH_ENV"'" printenv DATABASE_URL')
check "handles an unquoted value" "postgresql://bare/db" "$got"
got=$(env -u DATABASE_URL -u DIRECT_URL "$BASH" -c 'ENV_FILE="'"$TMP"'/quotes.env" "'"$WITH_ENV"'" printenv DIRECT_URL')
check "handles a single-quoted value" "postgresql://single/direct" "$got"

# 12. Commented-out keys must not be picked up.
cat > "$TMP/comment.env" <<'EOF'
#DATABASE_URL="postgresql://commented/db"
DATABASE_URL="postgresql://real/db"
DIRECT_URL="postgresql://real/direct"
EOF
got=$(env -u DATABASE_URL -u DIRECT_URL "$BASH" -c 'ENV_FILE="'"$TMP"'/comment.env" "'"$WITH_ENV"'" printenv DATABASE_URL')
check "ignores commented-out assignments" "postgresql://real/db" "$got"

echo
echo "  $pass passed, $fail failed"
[[ $fail -eq 0 ]]
