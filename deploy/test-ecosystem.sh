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
