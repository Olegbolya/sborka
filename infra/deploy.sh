#!/usr/bin/env bash
# Деплой Блокума на сервер (docs/02-ARCHITECTURE.md §3.3). Запускается workflow «Деплой» по SSH
# от пользователя deploy; переменные приходят через stdin перед текстом скрипта:
#   GH_TOKEN      — временный токен запуска GitHub Actions (только чтение репозитория)
#   REPO          — owner/repo, по умолчанию Olegbolya/sborka
#   DEPLOY_SHA    — коммит для выкладки (по умолчанию — свежий main)
#   SIMULATE_BROKEN_API=1 — проверка отката: новая сборка API намеренно не запускается
# Для локальной проверки: REPO_URL=file:///путь/к/репозиторию BLOKUM_ROOT=/tmp/... bash infra/deploy.sh
#
# Раскладка на сервере:
#   ~/blokum/repo.git          — голый git-репозиторий (без учётных данных)
#   ~/blokum/releases/<время>-<коммит> — собранные релизы (храним 3 последних)
#   ~/blokum/current -> releases/…     — то, что запущено в PM2
#   ~/blokum/shared/.env.prod  — секреты (создаёт server-setup.sh)
#   ~/blokum/setup/infra       — копия скриптов для владельца (sudo bash ~/blokum/setup/infra/server-setup.sh)
# Процессы BST (bst-api, bst-renderer) и его файлы скрипт не трогает: команды PM2 — только с --only blokum-*.
set -euo pipefail

APP_ROOT="${BLOKUM_ROOT:-$HOME/blokum}"
REPO="${REPO:-Olegbolya/sborka}"
REPO_DIR="$APP_ROOT/repo.git"
RELEASES="$APP_ROOT/releases"
CURRENT="$APP_ROOT/current"
ENV_FILE="$APP_ROOT/shared/.env.prod"
KEEP_RELEASES=3
API_URL="http://127.0.0.1:${API_PORT:-3100}/api/v1/health"
WEB_URL="http://127.0.0.1:${WEB_PORT:-3110}/healthz"
APPS=(blokum-api blokum-web blokum-worker)

ok() { printf '✓ %s\n' "$1"; }
info() { printf '→ %s\n' "$1"; }
fail() { printf '✗ %s\n' "$1" >&2; exit "${2:-1}"; }

echo "════════════════════════════════════════"
echo " Деплой Блокума $(date '+%Y-%m-%d %H:%M:%S')"
echo "════════════════════════════════════════"

# ── Код ───────────────────────────────────────────────────────────────────────
mkdir -p "$RELEASES" "$APP_ROOT/shared"
[ -d "$REPO_DIR" ] || git init -q --bare "$REPO_DIR"
if [ -n "${REPO_URL:-}" ]; then
  SOURCE="$REPO_URL"
else
  [ -n "${GH_TOKEN:-}" ] || fail "Нет GH_TOKEN (запускайте через workflow «Деплой»)" 2
  SOURCE="https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git"
fi
info "Получаю код…"
git --git-dir="$REPO_DIR" -c credential.helper= fetch -q --depth 50 "$SOURCE" "+refs/heads/main:refs/heads/main"
SHA="${DEPLOY_SHA:-$(git --git-dir="$REPO_DIR" rev-parse refs/heads/main)}"
git --git-dir="$REPO_DIR" cat-file -e "${SHA}^{commit}" 2>/dev/null || fail "Коммит $SHA не найден в main"
SHORT="${SHA:0:12}"
ok "Коммит $SHORT"

rm -rf "$APP_ROOT/setup"
mkdir -p "$APP_ROOT/setup"
git --git-dir="$REPO_DIR" archive "$SHA" infra | tar -x -C "$APP_ROOT/setup"
ok "Скрипты подготовки сервера: $APP_ROOT/setup/infra"

[ -f "$ENV_FILE" ] || fail "Сервер ещё не подготовлен (нет $ENV_FILE). Владельцу: ssh на сервер и sudo bash $APP_ROOT/setup/infra/server-setup.sh" 3
# Secrets added after the server was prepared are generated once into the existing file (never printed).
ensure_secret() {
  grep -qE "^$1=[0-9a-fA-F]{64}$" "$ENV_FILE" && return 0
  sed -i "/^$1=/d" "$ENV_FILE"
  printf '%s=%s\n' "$1" "$(openssl rand -hex 32)" >> "$ENV_FILE"
  echo "→ в .env.prod добавлен новый секрет $1 (значение не выводится)"
}
ensure_secret TOTP_SECRET_KEY

# ── Node 22 (у BST по умолчанию Node 20 — его не меняем) ──────────────────────
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091 # nvm lives only on the server
  . "$NVM_DIR/nvm.sh" >/dev/null
  NODE_BIN="$(nvm which 22 2>/dev/null || true)"
  [ -n "$NODE_BIN" ] || fail "На сервере нет Node 22. Владельцу: sudo bash $APP_ROOT/setup/infra/server-setup.sh" 3
else
  NODE_BIN="$(command -v node || true)"
fi
[ -n "$NODE_BIN" ] || fail "Node.js не найден" 3
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || fail "Нужен Node 22+, найден $("$NODE_BIN" --version)" 3
NODE_DIR="$(dirname "$NODE_BIN")"
export PATH="$NODE_DIR:$PATH"
export BLOKUM_NODE="$NODE_BIN" BLOKUM_ROOT="$APP_ROOT"
PNPM=(pnpm)
command -v pnpm >/dev/null 2>&1 || PNPM=(corepack pnpm)
command -v pm2 >/dev/null 2>&1 || fail "PM2 не найден (на сервере он общий с BST)" 3
ok "Node $("$NODE_BIN" --version), pnpm $("${PNPM[@]}" --version)"

PREV="$(readlink "$CURRENT" 2>/dev/null || true)"
if [ -n "$PREV" ] && [ -f "$PREV/REVISION" ] && [ "$(cat "$PREV/REVISION")" = "$SHA" ] && [ "${SIMULATE_BROKEN_API:-0}" != 1 ]; then
  ok "Коммит $SHORT уже запущен — пересборка не нужна"
  REDEPLOY_ONLY=1
else
  REDEPLOY_ONLY=0
fi

health() { curl -fsS --max-time 3 "$1" >/dev/null 2>&1; }
wait_for() {
  local what="$1" check="$2" tries="${3:-30}"
  for _ in $(seq 1 "$tries"); do
    if "$check"; then return 0; fi
    sleep 2
  done
  echo "  ${what}: не ответил за $((tries * 2)) с" >&2
  return 1
}
api_ok() { health "$API_URL"; }
web_ok() { health "$WEB_URL"; }
worker_ok() {
  local url value ts
  url="$(grep -E '^REDIS_URL=' "$ENV_FILE" | cut -d= -f2-)"
  value="$(redis-cli -u "$url" --raw get bk:worker:heartbeat 2>/dev/null || true)"
  [ -n "$value" ] || return 1
  ts="$(date -d "$value" +%s%3N 2>/dev/null || echo 0)"
  [ "$ts" -ge "$RELOAD_STARTED" ]
}
check_app() {
  case "$1" in
    blokum-api) wait_for "API" api_ok ;;
    blokum-web) wait_for "сайт" web_ok ;;
    blokum-worker) wait_for "воркер" worker_ok ;;
  esac
}
reload_app() {
  RELOAD_STARTED="$(($(date +%s) * 1000 - 1000))"
  APP_VERSION="$(head -c 12 "$CURRENT/REVISION")" pm2 startOrReload "$CURRENT/infra/pm2/ecosystem.config.cjs" --only "$1" --update-env >/dev/null
}

if [ "$REDEPLOY_ONLY" = 0 ]; then
  REL="$RELEASES/$(date +%Y%m%d%H%M%S)-$SHORT"
  mkdir -p "$REL"
  git --git-dir="$REPO_DIR" archive "$SHA" | tar -x -C "$REL"
  echo "$SHA" > "$REL/REVISION"
  cd "$REL"
  info "Зависимости…"
  env -u NODE_ENV "${PNPM[@]}" install --frozen-lockfile --prefer-offline --reporter=silent
  info "Сборка…"
  env -u NODE_ENV NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1 APP_VERSION="$SHORT" "${PNPM[@]}" -s build --output-logs=errors-only
  for f in apps/api/dist/main.js apps/worker/dist/main.js packages/db/dist/cli/migrate.js apps/web/.next/BUILD_ID; do
    [ -f "$f" ] || fail "Сборка неполная: нет $f (запущенная версия не тронута)"
  done
  ok "Собрано: $REL"
  if [ "${SIMULATE_BROKEN_API:-0}" = 1 ]; then
    echo 'console.error("Проверка отката: API намеренно не запускается"); process.exit(1);' > apps/api/dist/main.js
    info "SIMULATE_BROKEN_API=1: новая сборка API намеренно сломана — ожидается откат"
  fi

  info "Миграции базы данных…"
  "$NODE_BIN" --env-file="$ENV_FILE" packages/db/dist/cli/migrate.js || fail "Миграции не применились — запущенная версия не тронута"
  ok "Миграции применены"

  ln -sfn "$REL" "$APP_ROOT/current.next"
  mv -T "$APP_ROOT/current.next" "$CURRENT"
  ok "current → $(basename "$REL")"
fi

rollback() {
  local reason="$1"
  echo "✗ $reason" >&2
  if [ -n "$PREV" ] && [ -d "$PREV" ] && [ "$PREV" != "$(readlink "$CURRENT")" ]; then
    ln -sfn "$PREV" "$APP_ROOT/current.next"
    mv -T "$APP_ROOT/current.next" "$CURRENT"
    for app in "${APPS[@]}"; do reload_app "$app"; check_app "$app" || echo "  ! после отката $app не ответил" >&2; done
    pm2 save >/dev/null 2>&1 || true
    fail "Откат выполнен: снова запущена $(basename "$PREV")"
  fi
  for app in "${APPS[@]}"; do pm2 delete "$app" >/dev/null 2>&1 || true; done
  fail "Первый деплой не запустился, процессы Блокума остановлены (BST не затронут)"
}

command -v redis-cli >/dev/null 2>&1 || fail "redis-cli не найден (нужен для проверки воркера)" 3
RELOAD_STARTED=0
for app in "${APPS[@]}"; do
  if [ "$REDEPLOY_ONLY" = 1 ] && pm2 describe "$app" >/dev/null 2>&1 && check_app "$app"; then
    ok "$app уже работает"
    continue
  fi
  info "Перезапуск $app…"
  reload_app "$app"
  check_app "$app" || rollback "$app не прошёл проверку здоровья"
  ok "$app работает"
done
pm2 save >/dev/null 2>&1 || true

# ── Уборка старых релизов ─────────────────────────────────────────────────────
ACTIVE="$(readlink "$CURRENT")"
mapfile -t OLD < <(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d | sort -r | tail -n +$((KEEP_RELEASES + 1)))
for d in "${OLD[@]}"; do
  [ "$d" = "$ACTIVE" ] || [ "$d" = "$PREV" ] || rm -rf "$d"
done

# ── Проверка снаружи: nginx, сертификат, закрытый доступ до запуска ──────────
# Не влияет на исход деплоя (приложение уже проверено выше), но показывает владельцу, открывается ли сайт.
(
  set +eu
  # shellcheck source=/dev/null
  . "$CURRENT/infra/server.env"
  code() { curl -s -o /dev/null -w '%{http_code}' --max-time 5 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN$1"; }
  want_root=200
  [ "${PRELAUNCH:-1}" = "1" ] && want_root=401
  for check in "/healthz:200" "/api/v1/health:200" "/:$want_root"; do
    path="${check%%:*}"; want="${check##*:}"; got="$(code "$path")"
    if [ "$got" = "$want" ]; then ok "https://$DOMAIN$path → $got"; else echo "⚠ https://$DOMAIN$path → ${got:-нет ответа} (ожидалось $want)"; fi
  done
  cert="$(echo | openssl s_client -connect 127.0.0.1:443 -servername "$DOMAIN" 2>/dev/null | openssl x509 -noout -enddate -ext subjectAltName 2>/dev/null)"
  until="$(printf '%s\n' "$cert" | sed -n 's/^notAfter=//p')"
  names="$(printf '%s\n' "$cert" | grep -o 'DNS:[^,]*' | sed 's/DNS://' | paste -sd' ' -)"
  if printf ' %s ' "$names" | grep -q " $DOMAIN "; then ok "Сертификат $DOMAIN действует до $until"
  else echo "⚠ На $DOMAIN отдаётся чужой сертификат (${names:-нет}), действует до ${until:-?}"; fi
  public_ip="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}')"
  if [ "$public_ip" = "$SERVER_IP" ]; then ok "DNS: $DOMAIN → $public_ip"; else echo "⚠ DNS: $DOMAIN → ${public_ip:-не найден} (нужно $SERVER_IP)"; fi
)

BST_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:3000/api/health || true)"
echo "BST (mybst.ru) /api/health: ${BST_CODE:-нет ответа}"
echo "════════════════════════════════════════"
ok "Деплой $SHORT завершён"
