#!/usr/bin/env bash
# Переезд Блоккера на другой сервер (ADR-115): отправляющая сторона, запускается на СТАРОМ сервере пользователем deploy
# из задания GitHub «Переезд на другой сервер». stdout — архив (tar), все сообщения — в stderr; секреты не печатаются.
#   check — только показать, что будет перенесено (ничего не останавливает);
#   send  — остановить API и обработчик Блоккера (сайт перестаёт принимать новые данные), снять копию базы,
#           взять .env.prod, медиа и базы антивируса и выдать всё одним архивом. Процессы BST не трогаются.
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

[ -f "$ENV_FILE" ] || { log "✗ нет $ENV_FILE"; exit 1; }
DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | tail -1 | cut -d= -f2-)"
[ -n "$DATABASE_URL" ] || { log "✗ в .env.prod нет DATABASE_URL"; exit 1; }
counts() { psql "$DATABASE_URL" -tAc "select 'users='||(select count(*) from users)||' projects='||(select count(*) from projects)||' media='||(select count(*) from media)||' sessions='||(select count(*) from participant_sessions)||' orders='||(select count(*) from orders)"; }

if [ "$MODE" = check ]; then
  log "· база: $(psql "$DATABASE_URL" -tAc "select pg_size_pretty(pg_database_size(current_database()))"), $(counts)"
  log "· медиа: $(du -sh "$DATA/media" 2>/dev/null | cut -f1), файлов $(find "$DATA/media" -type f 2>/dev/null | wc -l)"
  log "· базы антивируса: $(find /var/lib/clamav -maxdepth 1 -name '*.c?d' -printf '%f ' 2>/dev/null)"
  log "· процессы: $(pm2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).filter(p=>p.name.startsWith("blokum-")).map(p=>p.name+"="+p.pm2_env.status).join(" "))}catch{console.log("?")}})')"
  exit 0
fi
[ "$MODE" = send ] || { log "✗ режим: check или send"; exit 2; }

log "→ останавливаю API и обработчик Блоккера на старом сервере (только blokum-api и blokum-worker)"
pm2 stop blokum-api blokum-worker >/dev/null
# Saved so that a reboot of the old server does not start them again and take writes from people with the old address.
pm2 save >/dev/null
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
pg_dump --format=custom --no-owner "$DATABASE_URL" >"$T/db.dump"
counts >"$T/counts"
install -m 600 "$ENV_FILE" "$T/env.prod"
mkdir -p "$T/clamav"
find /var/lib/clamav -maxdepth 1 -name '*.c?d' -exec cp {} "$T/clamav/" \; 2>/dev/null || true
log "✓ снята копия: база $(du -h "$T/db.dump" | cut -f1) ($(cat "$T/counts")), медиа $(du -sh "$DATA/media" | cut -f1), баз антивируса $(find "$T/clamav" -type f | wc -l)"
tar -cf - -C "$T" db.dump counts env.prod clamav -C "$DATA" media
