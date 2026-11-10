#!/usr/bin/env bash
# Диагностика Блоккера на сервере (workflow «Диагностика сервера»). Только чтение; секреты не печатаются.
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
  echo "Блоккер ещё не развёрнут"
fi
[ -f "$ENV_FILE" ] && echo ".env.prod: есть ($(stat -c %a "$ENV_FILE"))" || echo ".env.prod: НЕТ — нужен server-setup.sh"

echo "── Процессы PM2 (только blokum-*)"
# shellcheck disable=SC2016 # JavaScript template literals, not shell expansions
pm2 jlist 2>/dev/null | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const list = JSON.parse(s || "[]").filter((p) => p.name.startsWith("blokum-"));
    if (!list.length) console.log("нет процессов Блоккера");
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

echo "── Домен, nginx и сертификат Блоккера"
DOM="$(sed -n 's/^DOMAIN=//p' "$APP_ROOT/current/infra/server.env" 2>/dev/null | head -1)"; DOM="${DOM:-blokker.ru}"
echo "домен: $DOM · адрес по DNS (с сервера): $(getent ahostsv4 "$DOM" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ')"
echo "www.$DOM: $(getent ahostsv4 "www.$DOM" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ') · media.$DOM: $(getent ahostsv4 "media.$DOM" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ')"
echo "nginx: $(systemctl is-active nginx 2>&1 | head -1) · конфиг Блоккера: $(find /etc/nginx/sites-enabled /etc/nginx/conf.d -maxdepth 1 -iname '*blokum*' -printf '%f ' 2>/dev/null)"
echo "https у себя ($DOM): $(curl -sk -o /dev/null -w '%{http_code}' --max-time 5 --resolve "$DOM:443:127.0.0.1" "https://$DOM/" 2>&1)"
echo "сертификат: $(echo | timeout 5 openssl s_client -connect 127.0.0.1:443 -servername "$DOM" 2>/dev/null | openssl x509 -noout -subject -enddate 2>/dev/null | tr '\n' ' ')"

echo "── Диск"
df -h "$HOME" /srv 2>/dev/null | awk 'NR==1 || !seen[$0]++'

echo "── Последние строки логов"
for f in "$LOGS"/blokum-api-error.log "$LOGS"/blokum-web-error.log "$LOGS"/blokum-worker-error.log; do
  [ -f "$f" ] || continue
  echo "· $(basename "$f")"
  tail -n 15 "$f" | mask
done

echo "── Медиафайлы (статусы и причины)"
if [ -f "$ENV_FILE" ]; then
  dburl="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)"
  psql "$dburl" -Atc "select status || ': ' || count(*) from media where deleted_at is null group by status order by 1" 2>&1 | head -8 | mask
  psql "$dburl" -Atc "select to_char(created_at,'DD.MM HH24:MI') || ' ' || kind || ' ' || status || ' ' || mime || ' ' || bytes || ' ' || coalesce(left(moderation::text,120),'') from media where deleted_at is null order by created_at desc limit 5" 2>&1 | head -6 | mask
fi
for f in "$LOGS"/blokum-worker-out.log "$LOGS"/blokum-worker-error.log; do
  [ -f "$f" ] || continue
  echo "· $(basename "$f"): медиа"
  grep -aE 'media|медиа|TS-2|REJECTED|BLOCKED|sharp|ffmpeg|ClamAV' "$f" | tail -n 8 | cut -c1-230 | mask
done

echo "── ClamAV (антивирус для загруженных файлов)"
echo "freshclam: $(systemctl is-active clamav-freshclam 2>&1 | head -1) · clamd: $(systemctl is-active clamav-daemon 2>&1 | head -1)"
echo "базы: $(find /var/lib/clamav -maxdepth 1 -type f -printf '%f ' 2>&1 | head -c 200)"
tail -n 6 /var/log/clamav/freshclam.log 2>&1 | cut -c1-200 | mask
if [ -f /tmp/clam-probe.txt ] || printf 'probe' > /tmp/clam-probe.txt; then
  echo "clamscan: $(clamscan --no-summary /tmp/clam-probe.txt 2>&1 | head -3 | tr '\n' ' ' | cut -c1-300)"; rm -f /tmp/clam-probe.txt
fi

echo "── Картинки в опубликованных сборках (почему у участника пусто)"
if [ -f "$ENV_FILE" ]; then
  dburl="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)"
  for pub in $(psql "$dburl" -At -c "select slug from projects where status='PUBLISHED' and deleted_at is null and published_version_id is not null limit 3" 2>&1); do
    echo "опубликованная $pub: media в документе: $(psql "$dburl" -At -c "select string_agg(m.id, ',') from media m, projects p join project_versions v on v.id=p.published_version_id where p.slug='$pub' and v.document::text like '%' || m.id || '%'" 2>&1 | head -1)"
    echo "  страница: $(curl -s -o /dev/null -m 10 -w '%{http_code}' "http://127.0.0.1:3100/api/v1/play/$pub" 2>&1)"
    for mid in $(psql "$dburl" -At -c "select m.id from media m, projects p join project_versions v on v.id=p.published_version_id where p.slug='$pub' and v.document::text like '%' || m.id || '%'" 2>&1); do
      echo "  картинка $mid: $(curl -s -o /dev/null -m 10 -w '%{http_code} %{content_type} %{size_download}' "http://127.0.0.1:3100/api/v1/play/$pub/media/$mid" 2>&1)"
    done
  done
fi
if [ -f "$ENV_FILE" ]; then
  dburl="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)"
  echo "проекты (последние 6): $(psql "$dburl" -At -F' · ' -c "select slug, status, to_char(updated_at,'DD.MM HH24:MI'), (published_version_id is not null) from projects where deleted_at is null order by updated_at desc limit 6" 2>&1 | tr '\n' ';' | cut -c1-400)"
  echo "медиа всего (с удалёнными): $(psql "$dburl" -At -F' ' -c "select id, status, (deleted_at is not null), to_char(created_at,'DD.MM HH24:MI') from media order by created_at desc limit 8" 2>&1 | tr '\n' ';' | cut -c1-500)"
fi
if [ -f "$ENV_FILE" ]; then
  dburl="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)"
  mroot="$(grep -E '^MEDIA_ROOT=' "$ENV_FILE" | cut -d= -f2-)"
  psql "$dburl" -At -F' ' -c "select m.owner_id, m.id, m.status, m.mime from media m where m.deleted_at is null and m.status='READY' order by m.created_at desc limit 3" 2>&1 | while read -r owner mid st mime; do
    [ -n "$mid" ] || continue
    echo "· $mid $st $mime файл: $(find "$mroot/$owner" -maxdepth 1 -name "$mid" -printf '%s байт' 2>&1 | head -c 160) [корень: ${mroot:-не задан}]"
    echo "  variants: $(psql "$dburl" -At -c "select left(variants::text,300) from media where id='$mid'" 2>&1 | head -1)"
    echo "  папка владельца: $(find "$mroot/$owner" -maxdepth 1 -name "$mid*" -printf '%f ' 2>&1 | cut -c1-300)"
    pub="$(psql "$dburl" -At -c "select p.slug from projects p join project_versions v on v.id=p.published_version_id where v.document::text like '%$mid%' limit 1" 2>&1 | head -1)"
    echo "  в опубликованной сборке: ${pub:-нет (не опубликовано после добавления)}"
    if [ -n "$pub" ]; then
      echo "  тело ответа: $(curl -s -m 10 "http://127.0.0.1:3100/api/v1/play/$pub/media/$mid" 2>&1 | head -c 200)"
      echo "  проект: $(psql "$dburl" -At -F' · ' -c "select status, moderation_status, coalesce(deleted_at::text,'не удалён'), to_char(updated_at,'DD.MM HH24:MI') from projects where slug='$pub'" 2>&1 | head -1)"
      echo "  флаги: $(psql "$dburl" -At -F'=' -c "select key, enabled from feature_flags order by 1" 2>&1 | tr '\n' ' ' | cut -c1-300)"
      echo "  слаг открывается: $(curl -s -o /dev/null -m 10 -w '%{http_code}' "http://127.0.0.1:3100/api/v1/play/$pub" 2>&1)"
      echo "  id встречается в документе в кавычках: $(psql "$dburl" -At -c "select (v.document::text like '%\"$mid\"%') from projects p join project_versions v on v.id=p.published_version_id where p.slug='$pub'" 2>&1 | head -1)"
      echo "  ответ участнику: $(curl -s -o /dev/null -m 10 -w '%{http_code} %{content_type} %{size_download}' "http://127.0.0.1:3100/api/v1/play/$pub/media/$mid" 2>&1)"
      echo "  через nginx (публично): $(curl -s -o /dev/null -m 10 -w '%{http_code} %{content_type} %{size_download}' -H 'Host: blokker.ru' --resolve blokker.ru:443:127.0.0.1 "https://blokker.ru/api/v1/play/$pub/media/$mid" 2>&1)"
    fi
  done
fi
tail -n 5 /var/log/nginx/blokum-error.log 2>/dev/null | cut -c1-200
