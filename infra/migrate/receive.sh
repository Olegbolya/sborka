#!/usr/bin/env bash
# Переезд Блоккера на другой сервер (ADR-115): принимающая сторона, запускается на НОВОМ сервере пользователем deploy.
#   check — проверить, что сервер готов принять перенос;
#   receive — stdin: архив от send.sh. Останавливает Блоккер на новом сервере, ставит роли базы пароль со старого
#           сервера, заменяет базу копией (схемы удаляются и восстанавливаются правами владельца базы), кладёт медиа
#           и .env.prod старого сервера (прежний .env.prod сохраняется рядом), базы антивируса — в shared/clamav-import
#           (их ставит в систему server-setup.sh под sudo), запускает Блоккер и проверяет его. Секреты не печатаются.
set -euo pipefail
MODE="${1:-check}"
APP="$HOME/blokum"
ENV_FILE="$APP/shared/.env.prod"
DATA="$(sed -n 's/^DATA_ROOT=//p' "$APP/setup/infra/server.env" 2>/dev/null | head -1)"
DATA="${DATA:-/srv/blokum}"
log() { printf '%s\n' "$*" >&2; }
# node and pm2 come from nvm (Node 22), as in deploy.sh: a non-interactive ssh does not read ~/.bashrc.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091 # nvm lives only on the server
  . "$NVM_DIR/nvm.sh" >/dev/null
  NODE_BIN="$(nvm which 22 2>/dev/null || true)"
  if [ -n "$NODE_BIN" ]; then NODE_DIR="$(dirname "$NODE_BIN")"; export PATH="$NODE_DIR:$PATH"; fi
fi
command -v pm2 >/dev/null || { printf '%s\n' "✗ не нашёл pm2 (Node 22 через nvm)" >&2; exit 1; }
url_of() { grep -E '^DATABASE_URL=' "$1" | tail -1 | cut -d= -f2-; }

[ -f "$ENV_FILE" ] || { log "✗ нет $ENV_FILE: сначала server-setup.sh и деплой"; exit 1; }
command -v pg_restore >/dev/null || { log "✗ нет pg_restore"; exit 1; }
[ -d "$APP/current" ] || { log "✗ Блоккер ещё не выложен на этот сервер"; exit 1; }
if [ "$MODE" = check ]; then
  log "· свободно на диске: $(df -h "$DATA" | awk 'NR==2{print $4}'), версия: $(head -c 12 "$APP/current/REVISION")"
  log "· база: $(psql "$(url_of "$ENV_FILE")" -tAc "select count(*) from projects") сборок (будут заменены)"
  exit 0
fi
[ "$MODE" = receive ] || { log "✗ режим: check или receive"; exit 2; }

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
tar -xf - -C "$T"
for f in db.dump counts env.prod; do [ -s "$T/$f" ] || { log "✗ в архиве нет $f — ничего не меняю"; exit 1; }; done
log "✓ архив получен: $(cat "$T/counts")"

log "→ останавливаю Блоккер на новом сервере"
pm2 stop blokum-api blokum-worker blokum-web >/dev/null 2>&1 || true

OLD_URL="$(url_of "$ENV_FILE")"
NEW_URL="$(url_of "$T/env.prod")"
NEW_PASS="$(printf '%s' "$NEW_URL" | sed -E 's#^postgresql://[^:]+:([^@]*)@.*#\1#')"
[ -n "$NEW_PASS" ] && [ "$NEW_PASS" != "$NEW_URL" ] || { log "✗ не разобрал DATABASE_URL старого сервера"; exit 1; }
# The role takes the password of the old server, so its .env.prod works here as is (secrets, keys, tokens).
printf "ALTER ROLE current_user PASSWORD :'pw';\n" | psql -v ON_ERROR_STOP=1 -v pw="$NEW_PASS" -q "$OLD_URL"
log "✓ пароль роли базы — как на старом сервере"
# The database of THIS server with the old password: the copy goes here whatever host or name the old address had.
TARGET_URL="$(printf '%s' "$OLD_URL" | sed -E "s#^(postgresql://[^:]+:)[^@]*(@.*)#\1${NEW_PASS//#/\\#}\2#")"

psql -v ON_ERROR_STOP=1 -q "$TARGET_URL" -c "DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;" 2>/dev/null
pg_restore --no-owner --no-privileges --exit-on-error --dbname "$TARGET_URL" "$T/db.dump"
GOT="$(psql "$TARGET_URL" -tAc "select 'users='||(select count(*) from users)||' projects='||(select count(*) from projects)||' media='||(select count(*) from media)||' sessions='||(select count(*) from participant_sessions)||' orders='||(select count(*) from orders)")"
[ "$GOT" = "$(cat "$T/counts")" ] || { log "✗ после восстановления счётчики не совпали: было $(cat "$T/counts"), стало $GOT"; exit 1; }
log "✓ база восстановлена, счётчики совпали: $GOT"

mkdir -p "$DATA/media"
find "$DATA/media" -mindepth 1 -delete
cp -a "$T/media/." "$DATA/media/"
log "✓ медиа: $(du -sh "$DATA/media" | cut -f1), файлов $(find "$DATA/media" -type f | wc -l)"

install -m 600 "$ENV_FILE" "$APP/shared/.env.prod.before-move"
install -m 600 "$T/env.prod" "$ENV_FILE"
# Everything from the old server, but the database is the one of this server.
TMP_ENV="$(mktemp)"
grep -vE '^DATABASE_URL=' "$ENV_FILE" >"$TMP_ENV"
printf 'DATABASE_URL=%s\n' "$TARGET_URL" >>"$TMP_ENV"
install -m 600 "$TMP_ENV" "$ENV_FILE"
rm -f "$TMP_ENV"
log "✓ .env.prod — со старого сервера (прежний сохранён как .env.prod.before-move)"

if [ -n "$(find "$T/clamav" -type f 2>/dev/null)" ]; then
  mkdir -p "$APP/shared/clamav-import"
  cp "$T/clamav/"* "$APP/shared/clamav-import/"
  log "✓ базы антивируса — в shared/clamav-import (их ставит в систему: sudo bash ~/blokum/setup/infra/server-setup.sh)"
fi

log "→ запускаю Блоккер"
for p in blokum-api blokum-web blokum-worker; do pm2 restart "$p" --update-env >/dev/null; done
pm2 save >/dev/null
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3100/api/v1/health >/dev/null 2>&1 && curl -fsS http://127.0.0.1:3110/healthz >/dev/null 2>&1; then
    log "✓ API и сайт на новом сервере отвечают"
    exit 0
  fi
  sleep 2
done
log "✗ API или сайт не ответили за минуту: pm2 logs blokum-api"
exit 1
