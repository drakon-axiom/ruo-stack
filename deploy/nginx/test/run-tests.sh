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
