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
echo "── Ошибки API (5xx, последние; по коду запроса из сообщения «Внутренняя ошибка сервера»)"
# shellcheck disable=SC2016 # JavaScript for node, not shell
grep -ahE '"msg":"(необработанная ошибка|ошибка внешнего сервиса)"' "$LOGS/blokum-api-out.log" "$LOGS/blokum-api-error.log" 2>/dev/null | tail -n 6 | node -e '
  const lines = require("fs").readFileSync(0, "utf8").split("\n").filter(Boolean);
  for (const l of lines) {
    try {
      const j = JSON.parse(l.slice(l.indexOf("{")));
      const e = j.err ?? {};
      console.log(`${j.time ?? ""} ${j.requestId ?? ""} ${j.status ?? ""} ${j.code ?? ""} → ${j.cause ?? `${e.type ?? ""}: ${String(e.message ?? "").slice(0, 300)}`}`);
      if (e.stack) console.log("   " + String(e.stack).split("\n").slice(1, 4).map((x) => x.trim()).join(" | ").slice(0, 400));
    } catch { console.log(l.slice(0, 300)); }
  }' 2>&1 | mask
[ -f "$ENV_FILE" ] && echo "платежи: $(grep -oE '^(PAYMENT_PROVIDER|PAYMENT_PROVIDERS)=[a-z,]+' "$ENV_FILE" | tr '\n' ' ')· заданы: $(grep -oE '^(YOOKASSA|ROBOKASSA)_[A-Z0-9_]+=.' "$ENV_FILE" | cut -d= -f1 | tr '\n' ' ')"
# Only the kind of the YooKassa key (live_/test_), its length and stray spaces — never the key itself.
if [ -f "$ENV_FILE" ]; then
  yk="$(grep -E '^YOOKASSA_SECRET_KEY=' "$ENV_FILE" | tail -1 | cut -d= -f2-)"
  echo "ЮKassa: магазин $(grep -E '^YOOKASSA_SHOP_ID=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -cd '0-9'), ключ вида ${yk:0:5}…, длина ${#yk}$(case "$yk" in *[[:space:]]*|\"*|\'*) echo ', ЕСТЬ пробелы или кавычки';; esac), строк с ключом: $(grep -cE '^YOOKASSA_SECRET_KEY=' "$ENV_FILE")"
fi
# The keys are checked by YooKassa itself (GET /v3/me — the shop the key belongs to); only the answer's status and shop are shown.
if [ -f "$ENV_FILE" ] && grep -qE '^YOOKASSA_SECRET_KEY=.' "$ENV_FILE"; then
  me="$(curl -sS -m 15 -o /tmp/bk-yoo-me.json -w '%{http_code}' -K - https://api.yookassa.ru/v3/me 2>&1 <<CURL
user = "$(grep -E '^YOOKASSA_SHOP_ID=' "$ENV_FILE" | tail -1 | cut -d= -f2-):$(grep -E '^YOOKASSA_SECRET_KEY=' "$ENV_FILE" | tail -1 | cut -d= -f2-)"
CURL
)"
  echo "ЮKassa /v3/me: ответ $me · $(node -e 'try{const j=JSON.parse(require("fs").readFileSync("/tmp/bk-yoo-me.json","utf8"));console.log([j.account_id&&"магазин "+j.account_id,j.test!==undefined&&(j.test?"ТЕСТОВЫЙ":"боевой"),j.status,j.code,j.description].filter(Boolean).join(" · "))}catch{console.log("нет ответа")}' 2>&1)"
  rm -f /tmp/bk-yoo-me.json
fi
# Does the running API see the same key as the file? (node --env-file does not override a variable the process already has.) Only «same / differs».
api_pid="$(pm2 pid blokum-api 2>/dev/null | head -1)"
if [ -n "$api_pid" ] && [ "$api_pid" != 0 ] && [ -r "/proc/$api_pid/environ" ] && [ -f "$ENV_FILE" ]; then
  in_proc="$(tr '\0' '\n' <"/proc/$api_pid/environ" | grep -E '^YOOKASSA_SECRET_KEY=' | sha256sum | cut -c1-12)"
  in_file="$(grep -E '^YOOKASSA_SECRET_KEY=' "$ENV_FILE" | tail -1 | sha256sum | cut -c1-12)"
  none="$(printf '' | sha256sum | cut -c1-12)"
  if [ "$in_proc" = "$none" ]; then echo "ключ ЮKassa в процессе API: не задан окружением (берётся из .env.prod)"
  elif [ "$in_proc" = "$in_file" ]; then echo "ключ ЮKassa в процессе API: такой же, как в .env.prod"
  else echo "ключ ЮKassa в процессе API: ДРУГОЙ, чем в .env.prod (процесс держит старое значение)"; fi
fi
echo "── Уведомления платёжных сервисов (последние; только адрес, ответ и время)"
grep -aE '"[A-Z]+ /api/v1/payments/[a-z]+/(result|notify|notifications|webhook)[^"]*" [0-9]{3} ' /var/log/nginx/blokum-access.log 2>/dev/null | tail -n 6 | awk '{print $4, $6, $7, $9}' | sed -E 's/\?[^ ]*//' | cut -c1-160
echo "  в журнале nginx строк с robokassa: $(grep -ac 'robokassa' /var/log/nginx/blokum-access.log 2>/dev/null || echo 'журнал не читается')"
# shellcheck disable=SC2016 # JavaScript for node, not shell
grep -ahE 'payments/robokassa' "$LOGS/blokum-api-out.log" 2>/dev/null | tail -n 4 | sed -E 's/^[^{]*//' | node -e 'for (const l of require("fs").readFileSync(0,"utf8").split("\n").filter(Boolean)) { try { const j = JSON.parse(l); console.log(`  ${j.time} ${j.method ?? ""} ${String(j.path ?? "").split("?")[0]} → ${j.status ?? ""} ${j.msg ?? ""}`); } catch { console.log("  " + l.slice(0, 200)); } }' 2>&1 | mask
grep -ahE 'robokassa|Robokassa|уведомлени' "$LOGS/blokum-api-out.log" 2>/dev/null | grep -aE '"level":"(warn|error)"|"level":[45]0' | tail -n 4 | cut -c1-400 | mask
echo "== Ресурсы сервера (для выбора VPS) =="
echo "  процессор: $(nproc) ядер, $(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2 | sed 's/^ *//')"
echo "  память: $(free -m | awk '/^Mem:/{print "всего "$2" МБ, занято "$3" МБ, доступно "$7" МБ"}')"
echo "  нагрузка (1/5/15 мин): $(cut -d' ' -f1-3 /proc/loadavg)"
echo "  память процессов (МБ): $(ps -eo rss,args --sort=-rss | awk 'NR>1 && /blokum|bst|postgres|redis|clamd|nginx/ {n=$2; for(i=2;i<=NF;i++) if ($i ~ /blokum-|bst-|main.js|next-server|clamd|postgres:|redis-server|nginx/) {n=$i; break}; m[n]+=$1} END {for (k in m) printf "%s=%d ", substr(k,1,30), m[k]/1024}')"
echo "  диск: $(df -h /srv /home 2>/dev/null | awk 'NR>1{print $6": занято "$3" из "$2}' | sort -u | tr '\n' ';')"
echo "  медиа Блоккера: $(du -sh /srv/blokum/media 2>/dev/null | cut -f1), база blokum_db: $(sudo -n -u postgres psql -At -c "select pg_size_pretty(pg_database_size('blokum_db'))" 2>/dev/null || psql "$(grep '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)" -At -c "select pg_size_pretty(pg_database_size(current_database()))" 2>/dev/null)"
echo "== Вход на сервер по SSH (для владельца) =="
echo "  адреса сервера в домашней сети: $(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^(192\.168|10\.|172\.(1[6-9]|2[0-9]|3[01]))\.' | tr '\n' ' ')"
echo "  sshd: $(systemctl is-active ssh 2>/dev/null || systemctl is-active sshd 2>/dev/null), порт $(ss -ltnH 2>/dev/null | awk '{print $4}' | grep -oE ':(22|[0-9]+)$' | grep -m1 -E ':22$' || echo 'не 22')"
echo "  fail2ban: $(systemctl is-active fail2ban 2>/dev/null || echo 'нет')"
echo "== Неудачные ответы API за сутки (страница аккаунта и ВК; без IP) =="
grep -E '"[A-Z]+ /api/v1/(auth/account|account/vk|vk/callback)[^"]*" [45][0-9]{2} ' /var/log/nginx/blokum-access.log 2>/dev/null | tail -n 12 | cut -c1-220
echo "== ВКонтакте (уведомления D-07, ADR-110) =="
echo "  api.vk.com: $(curl -s -o /dev/null -m 15 -w 'код %{http_code}, всего %{time_total} с' 'https://api.vk.com/method/utils.getServerTime?v=5.199' 2>&1 || echo 'нет соединения')"
# Только «задано / не задано»: сами значения не печатаются.
for k in VK_GROUP_TOKEN VK_GROUP_ID VK_GROUP_SCREEN_NAME VK_CALLBACK_SECRET VK_CALLBACK_CONFIRMATION; do
  echo "  $k: $(grep -q "^$k=." "$ENV_FILE" 2>/dev/null && echo 'задано' || echo 'не задано')"
done
# Отвечает ли API на подтверждение адреса так, как ждёт ВКонтакте (строка не печатается — только совпадение).
vk_gid="$(grep '^VK_GROUP_ID=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)"
vk_conf="$(grep '^VK_CALLBACK_CONFIRMATION=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)"
# Вид значений без самих значений: номер — только цифры, короткий адрес — латиница/цифры/«_»/«.», длины.
echo "  VK_GROUP_ID только цифры: $(printf '%s' "$vk_gid" | grep -qE '^[0-9]+$' && echo да || echo "нет (длина ${#vk_gid}, первый знак «$(printf '%s' "$vk_gid" | cut -c1 | tr -d '0-9')»)")"
vk_sn="$(grep '^VK_GROUP_SCREEN_NAME=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)"
echo "  VK_GROUP_SCREEN_NAME вид: $(printf '%s' "$vk_sn" | grep -qE '^[A-Za-z0-9_.]+$' && echo 'адрес' || echo "другое (длина ${#vk_sn})")"
echo "  длины: строка подтверждения ${#vk_conf}, секрет $(grep '^VK_CALLBACK_SECRET=' "$ENV_FILE" | cut -d= -f2- | tr -d '\n' | wc -c), ключ $(grep '^VK_GROUP_TOKEN=' "$ENV_FILE" | cut -d= -f2- | tr -d '\n' | wc -c)"
echo "  API перезапущен после записи .env.prod: $([ "$(stat -c %Y "$ENV_FILE")" -lt "$(date -d "$(ps -o lstart= -p "$(pm2 pid blokum-api 2>/dev/null | head -1)" 2>/dev/null)" +%s 2>/dev/null || echo 0)" ] && echo да || echo нет)"
if [ -n "$vk_gid" ] && [ -n "$vk_conf" ]; then
  vk_ans="$(curl -s -m 10 -X POST -H 'content-type: application/json' -d "{\"type\":\"confirmation\",\"group_id\":$vk_gid}" http://127.0.0.1:3100/api/v1/vk/callback 2>&1)"
  [ "$vk_ans" = "$vk_conf" ] && echo "  подтверждение адреса: API отвечает верной строкой" || echo "  подтверждение адреса: НЕ совпадает (ответ ${#vk_ans} знаков)"
fi

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

