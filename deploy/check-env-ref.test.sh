#!/usr/bin/env bash
# Tests for check-env-ref.sh — the deploy-time guard that pins a checkout's .env
# to one Supabase project.
#
# The failure this guard exists for is not "operator deploys the wrong thing on
# purpose". It is a half-edited .env: SUPABASE_URL swapped to the new project,
# DIRECT_URL still on the old one. Migrations then run against the old database
# while the app talks to the new one, and nothing reports an error.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
GUARD="$HERE/check-env-ref.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

DEV=kcgqabbiihtfxczhpyfs
PROD=nanixtzbmorpojnyverq
POOLER=aws-1-us-west-2.pooler.supabase.com

pass=0
fail=0

check() { # check <name> <expected-exit> <actual-exit> [extra-condition-desc] [extra-condition-result]
  local name="$1" want="$2" got="$3"
  if [[ "$want" != "$got" ]]; then
    printf '  FAIL  %s\n        expected exit %s, got %s\n' "$name" "$want" "$got"
    fail=$((fail + 1))
    return
  fi
  if [[ $# -ge 5 && "$5" != "ok" ]]; then
    printf '  FAIL  %s\n        %s\n' "$name" "$4"
    fail=$((fail + 1))
    return
  fi
  printf '  ok    %s\n' "$name"
  pass=$((pass + 1))
}

write_env() { # write_env <file> <db-ref> <direct-ref> <supabase-ref>
  cat > "$1" <<EOF
# RUOStack .env
DATABASE_URL="postgresql://prisma.$2:pw@$POOLER:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.$3:pw@$POOLER:5432/postgres"
SUPABASE_URL="https://$4.supabase.co"
SUPABASE_ANON_KEY="eyJhbGciOi.irrelevant"
EOF
}

echo "check-env-ref.sh"

# 1. Happy path: all three agree with the pinned ref.
write_env "$TMP/ok.env" "$PROD" "$PROD" "$PROD"
out=$("$GUARD" "$TMP/ok.env" "$PROD" 2>&1); rc=$?
check "passes when all three refs match the pinned ref" 0 "$rc"

# 2. Internally consistent but wrong project: prod deploy holding dev's .env.
#    This is the case that silently migrates the wrong database today.
write_env "$TMP/devenv.env" "$DEV" "$DEV" "$DEV"
out=$("$GUARD" "$TMP/devenv.env" "$PROD" 2>&1); rc=$?
named=ok
[[ "$out" == *"$DEV"* && "$out" == *"$PROD"* ]] || named="message must name both the found and expected refs; got: $out"
check "rejects a consistent .env pinned to a different project" 1 "$rc" "$named" "$named"

# 3. Half-edited .env — the realistic mistake.
write_env "$TMP/half.env" "$DEV" "$DEV" "$PROD"
out=$("$GUARD" "$TMP/half.env" "$PROD" 2>&1); rc=$?
named=ok
[[ "$out" == *"DIRECT_URL"* || "$out" == *"DATABASE_URL"* ]] || named="message must name the disagreeing key; got: $out"
check "rejects a half-edited .env and names the stale key" 1 "$rc" "$named" "$named"

# 4. Reverse half-edit: connection strings moved, SUPABASE_URL left behind.
write_env "$TMP/half2.env" "$PROD" "$PROD" "$DEV"
out=$("$GUARD" "$TMP/half2.env" "$PROD" 2>&1); rc=$?
named=ok
[[ "$out" == *"SUPABASE_URL"* ]] || named="message must name SUPABASE_URL; got: $out"
check "rejects a stale SUPABASE_URL and names it" 1 "$rc" "$named" "$named"

# 5. A key missing entirely must fail loudly, not be treated as agreement.
cat > "$TMP/missing.env" <<EOF
DATABASE_URL="postgresql://prisma.$PROD:pw@$POOLER:6543/postgres?pgbouncer=true"
SUPABASE_URL="https://$PROD.supabase.co"
EOF
out=$("$GUARD" "$TMP/missing.env" "$PROD" 2>&1); rc=$?
named=ok
[[ "$out" == *"DIRECT_URL"* ]] || named="message must name the missing key; got: $out"
check "rejects a .env missing DIRECT_URL" 1 "$rc" "$named" "$named"

# 6. A URL with no extractable ref must fail, not silently pass.
cat > "$TMP/noref.env" <<EOF
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ruostack_test"
DIRECT_URL="postgresql://postgres:postgres@localhost:5432/ruostack_test"
SUPABASE_URL="http://localhost:54321"
EOF
out=$("$GUARD" "$TMP/noref.env" "$PROD" 2>&1); rc=$?
check "rejects URLs with no extractable project ref" 1 "$rc"

# 7. Missing .env file.
out=$("$GUARD" "$TMP/nope.env" "$PROD" 2>&1); rc=$?
check "rejects a missing .env" 1 "$rc"

# 8. Unreadable .env must not be reported as a ref mismatch.
write_env "$TMP/unreadable.env" "$PROD" "$PROD" "$PROD"
chmod 000 "$TMP/unreadable.env"
if [[ -r "$TMP/unreadable.env" ]]; then
  printf '  skip  rejects an unreadable .env (running as root)\n'
else
  out=$("$GUARD" "$TMP/unreadable.env" "$PROD" 2>&1); rc=$?
  named=ok
  [[ "$out" == *"read"* || "$out" == *"readable"* ]] || named="message should say the file could not be read; got: $out"
  check "rejects an unreadable .env with a read-specific message" 1 "$rc" "$named" "$named"
fi
chmod 644 "$TMP/unreadable.env"

# 9. THE SOURCING REGRESSION. A password containing $ or backticks must be inert.
#    `. .env` would expand $$ to a PID and execute `id -un`; the guard must not.
cat > "$TMP/evil.env" <<EOF
DATABASE_URL="postgresql://prisma.$PROD:pa\$\$w0rd\`id -un\`@$POOLER:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.$PROD:pw@$POOLER:5432/postgres"
SUPABASE_URL="https://$PROD.supabase.co"
EOF
out=$("$GUARD" "$TMP/evil.env" "$PROD" 2>&1); rc=$?
inert=ok
[[ "$out" == *"$(id -un)"* ]] && inert="command substitution in .env was EXECUTED; output: $out"
check "does not evaluate \$ or backticks in .env values" 0 "$rc" "$inert" "$inert"

# 10. Guard must not leak .env values into its own output on success.
write_env "$TMP/quiet.env" "$PROD" "$PROD" "$PROD"
out=$("$GUARD" "$TMP/quiet.env" "$PROD" 2>&1); rc=$?
quiet=ok
[[ "$out" == *"pw@"* ]] && quiet="guard echoed a password into its output: $out"
check "does not print secrets on success" 0 "$rc" "$quiet" "$quiet"

# 11. Usage error when called wrong.
out=$("$GUARD" 2>&1); rc=$?
check "rejects invocation with no arguments" 2 "$rc"

echo
echo "  $pass passed, $fail failed"
[[ $fail -eq 0 ]]
