#!/usr/bin/env bash
# Диагностика Блокума на сервере (workflow «Диагностика сервера»). Только чтение; секреты не печатаются.
set -uo pipefail
APP_ROOT="${BLOKUM_ROOT:-$HOME/blokum}"
LOGS="${BLOKUM_LOGS:-$HOME/logs}"
ENV_FILE="$APP_ROOT/shared/.env.prod"
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091 # nvm lives only on the server
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null && nvm use 22 >/dev/null 2>&1

mask() { sed -E 's/\+?7[0-9]{10}/+7••••••••••/g; s/(token|secret|password|key)=[^ &"]+/\1=•••/Ig; s/[0-9]{6}\b/••••••/g'; }

echo "── Релиз"
if [ -L "$APP_ROOT/current" ]; then
  echo "current: $(basename "$(readlink "$APP_ROOT/current")"), коммит $(head -c 12 "$APP_ROOT/current/REVISION" 2>/dev/null)"
  echo "релизы: $(find "$APP_ROOT/releases" -mindepth 1 -maxdepth 1 -type d | wc -l)"
else
  echo "Блокум ещё не развёрнут"
fi
[ -f "$ENV_FILE" ] && echo ".env.prod: есть ($(stat -c %a "$ENV_FILE"))" || echo ".env.prod: НЕТ — нужен server-setup.sh"

echo "── Процессы PM2 (только blokum-*)"
# shellcheck disable=SC2016 # JavaScript template literals, not shell expansions
pm2 jlist 2>/dev/null | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const list = JSON.parse(s || "[]").filter((p) => p.name.startsWith("blokum-"));
    if (!list.length) console.log("нет процессов Блокума");
    for (const p of list) console.log(`${p.name}: ${p.pm2_env.status}, перезапусков ${p.pm2_env.restart_time}, память ${Math.round(p.monit.memory / 1048576)} МБ`);
  });'

echo "── Здоровье"
echo "API:  $(curl -s --max-time 3 http://127.0.0.1:3100/api/v1/health || echo 'нет ответа')"
echo "Сайт: $(curl -s --max-time 3 http://127.0.0.1:3110/healthz || echo 'нет ответа')"
if [ -f "$ENV_FILE" ]; then
  url="$(grep -E '^REDIS_URL=' "$ENV_FILE" | cut -d= -f2-)"
  echo "Воркер (heartbeat): $(redis-cli -u "$url" --raw get bk:worker:heartbeat 2>/dev/null || echo 'нет')"
fi
bst="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:3000/api/health)"
echo "BST /api/health: ${bst/#000/нет ответа}"

echo "── Диск"
df -h "$HOME" /srv 2>/dev/null | awk 'NR==1 || !seen[$0]++'

echo "── Последние строки логов"
for f in "$LOGS"/blokum-api-error.log "$LOGS"/blokum-web-error.log "$LOGS"/blokum-worker-error.log; do
  [ -f "$f" ] || continue
  echo "· $(basename "$f")"
  tail -n 15 "$f" | mask
done
