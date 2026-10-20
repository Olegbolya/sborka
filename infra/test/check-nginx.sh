#!/usr/bin/env bash
# CI check of infra/nginx/blokum.conf.template: renders it the same way server-setup.sh does and runs
# `nginx -t` against a throw-away main config with self-signed certificates. Needs root and nginx.
# Never run on the production server (it creates /etc/letsencrypt/live/blokum* with test certificates).
set -euo pipefail
[ "${CI:-}" = "true" ] || [ "${BLOKUM_ALLOW_TEST_CERTS:-}" = 1 ] || { echo "Только для CI (или BLOKUM_ALLOW_TEST_CERTS=1)" >&2; exit 2; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

for name in blokum blokum-media; do
  dir="/etc/letsencrypt/live/$name"
  if [ ! -f "$dir/fullchain.pem" ]; then
    mkdir -p "$dir"
    openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=test.$name" \
      -keyout "$dir/privkey.pem" -out "$dir/fullchain.pem" >/dev/null 2>&1
  fi
done

check() {
  local label="$1"; shift
  bash "$HERE/server-setup.sh" --render-nginx="$WORK/blokum.conf" "$@" >/dev/null
  printf 'events {}\nhttp {\n  include %s/blokum.conf;\n}\n' "$WORK" > "$WORK/nginx.conf"
  nginx -t -q -c "$WORK/nginx.conf"
  if grep -vE '^\s*#' "$WORK/blokum.conf" | grep -nE 'mybst|/home/deploy/bst|bst_api|bst_renderer'; then
    echo "✗ $label: в конфигурации Блокума есть ссылки на BST" >&2; exit 1
  fi
  echo "✓ nginx -t: $label"
}

check "TLS + режим до запуска"
check "только порт 80 (домен ещё не настроен)" --no-tls
PRELAUNCH=0 check "после запуска (без пароля)"
if grep -q 'auth_basic "' "$WORK/blokum.conf"; then echo "✗ при PRELAUNCH=0 остался пароль на сайте" >&2; exit 1; fi
echo "nginx-конфигурация Блокума корректна"
