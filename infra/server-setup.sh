#!/usr/bin/env bash
# Однократная подготовка домашнего сервера для Блокума (docs/02-ARCHITECTURE.md §3.2).
# Запускает владелец, один раз и после изменения infra/nginx/blokum.conf.template или домена:
#   sudo bash /home/deploy/blokum/repo-setup/infra/server-setup.sh
# Повторный запуск безопасен: каждый шаг сначала проверяет, сделан ли он.
# Скрипт НЕ трогает BST: его каталог, базу, Redis-БД, процессы PM2 и nginx-конфиг mybst.ru.
#
#   --dry-run   только напечатать, что было бы сделано (используется в CI)
set -euo pipefail

DRY_RUN=0
RENDER_ONLY=""
RENDER_TLS=1
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --render-nginx=*) RENDER_ONLY="${arg#--render-nginx=}" ;;
    --no-tls) RENDER_TLS=0 ;;
    *) echo "Неизвестный параметр: $arg" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=server.env
source "$SCRIPT_DIR/server.env"

DEPLOY_HOME="/home/${DEPLOY_USER}"
APP_ROOT="${DEPLOY_HOME}/blokum"
SHARED="${APP_ROOT}/shared"
DATA="${DATA_ROOT}"
LOGS="${DEPLOY_HOME}/logs"
ENV_FILE="${SHARED}/.env.prod"
NGINX_SITE="/etc/nginx/sites-available/blokum.conf"
NGINX_LINK="/etc/nginx/sites-enabled/blokum.conf"
HTPASSWD="/etc/nginx/blokum.htpasswd"
CERT_NAME="blokum"

# Media files share the main certificate when they live on a subdomain; a separate domain gets its own.
MEDIA_CERT="$CERT_NAME"
case "$MEDIA_DOMAIN" in *."$DOMAIN") ;; *) MEDIA_CERT="blokum-media" ;; esac

done_() { printf '  ✓ %s\n' "$1"; }
skip() { printf '  · %s — уже сделано\n' "$1"; }
step() { printf '\n▶ %s\n' "$1"; }
fail() { printf '✗ %s\n' "$1" >&2; exit 1; }
run() {
  if [ "$DRY_RUN" = 1 ]; then
    printf '  [dry-run] %s\n' "$*"
  else
    "$@"
  fi
}
as_deploy() {
  if [ "$DRY_RUN" = 1 ]; then
    printf '  [dry-run] (от %s) %s\n' "$DEPLOY_USER" "$1"
  else
    su - "$DEPLOY_USER" -c "$1"
  fi
}
as_postgres() { su postgres -c "$1"; }

render_nginx() {
  local with_tls="$1" out="$2"
  local -a cut=()
  [ "$with_tls" = 1 ] || cut+=(-e '/^#@TLS_BEGIN/,/^#@TLS_END/d')
  [ "$PRELAUNCH" = 1 ] || cut+=(-e '/^#@PRELAUNCH_BEGIN/,/^#@PRELAUNCH_END/d')
  sed "${cut[@]}" -e "s#@@DOMAIN@@#${DOMAIN}#g" -e "s#@@MEDIA_DOMAIN@@#${MEDIA_DOMAIN}#g" \
    -e "s#@@MEDIA_CERT@@#${MEDIA_CERT}#g" -e "s#@@DATA_ROOT@@#${DATA_ROOT}#g" \
    -e "s#@@API_PORT@@#${API_PORT}#g" -e "s#@@WEB_PORT@@#${WEB_PORT}#g" \
    "$SCRIPT_DIR/nginx/blokum.conf.template" > "$out"
}

if [ -n "$RENDER_ONLY" ]; then
  # Used by CI to validate the template with `nginx -t`; changes nothing on the machine.
  render_nginx "$RENDER_TLS" "$RENDER_ONLY"
  echo "nginx-конфигурация записана в $RENDER_ONLY"
  exit 0
fi

echo "════════════════════════════════════════"
echo " Блокум: подготовка сервера $(date '+%Y-%m-%d %H:%M')"
[ "$DRY_RUN" = 1 ] && echo " РЕЖИМ ПРОВЕРКИ (--dry-run): ничего не меняется"
echo "════════════════════════════════════════"

if [ "$DRY_RUN" = 0 ]; then
  [ "$(id -u)" = 0 ] || fail "Запустите через sudo: sudo bash $0"
  id "$DEPLOY_USER" >/dev/null 2>&1 || fail "Нет пользователя $DEPLOY_USER (на нём работает BST — проверьте сервер)"
fi

# ── 1. Каталоги ───────────────────────────────────────────────────────────────
step "Каталоги"
for d in "$APP_ROOT" "$APP_ROOT/releases" "$SHARED" "$DATA" "$DATA/media" "$DATA/exports" "$DATA/tmp" "$DATA/quarantine" "$LOGS"; do
  if [ "$DRY_RUN" = 0 ] && [ -d "$d" ]; then skip "$d"; else
    run install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 750 "$d"; done_ "$d"
  fi
done
run chmod 755 "$DATA" "$DATA/media"
done_ "медиа ($DATA/media) доступны nginx на чтение, остальное — только $DEPLOY_USER"

# ── 2. Системные пакеты ───────────────────────────────────────────────────────
step "Пакеты: ffmpeg, ClamAV, certbot"
need_pkgs=()
for p in ffmpeg clamav clamav-daemon certbot; do
  if [ "$DRY_RUN" = 0 ] && dpkg -s "$p" >/dev/null 2>&1; then skip "$p"; else need_pkgs+=("$p"); fi
done
if [ "${#need_pkgs[@]}" -gt 0 ]; then
  run apt-get update -qq
  run env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${need_pkgs[@]}"
  done_ "установлено: ${need_pkgs[*]}"
fi
run systemctl enable --now clamav-freshclam
run systemctl enable --now clamav-daemon
done_ "антивирус ClamAV запущен (базы обновляются freshclam)"

# ── 3. Node.js 22 и pnpm для пользователя deploy (Node 20 у BST не трогаем) ───
step "Node.js ${NODE_MAJOR} и pnpm ${PNPM_VERSION}"
as_deploy "export NVM_DIR=\$HOME/.nvm; [ -s \$NVM_DIR/nvm.sh ] || { echo 'нет nvm у $DEPLOY_USER'; exit 1; }; . \$NVM_DIR/nvm.sh; nvm ls ${NODE_MAJOR} >/dev/null 2>&1 || nvm install ${NODE_MAJOR} --no-progress; nvm exec ${NODE_MAJOR} corepack enable; nvm exec ${NODE_MAJOR} corepack prepare pnpm@${PNPM_VERSION} --activate; nvm exec ${NODE_MAJOR} node --version"
done_ "Node ${NODE_MAJOR} установлен через nvm (версия по умолчанию для BST не меняется)"

# ── 4. PostgreSQL: своя роль и база ───────────────────────────────────────────
step "PostgreSQL: роль blokum и база blokum_db"
PG_PASSWORD=""
if [ "$DRY_RUN" = 1 ]; then
  run "CREATE ROLE blokum LOGIN PASSWORD '***'; CREATE DATABASE blokum_db OWNER blokum"
else
  if as_postgres "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='blokum'\"" | grep -q 1; then
    skip "роль blokum"
  else
    PG_PASSWORD="$(openssl rand -hex 24)"
    as_postgres "psql -v ON_ERROR_STOP=1 -c \"CREATE ROLE blokum LOGIN PASSWORD '${PG_PASSWORD}'\""
    done_ "роль blokum создана"
  fi
  if as_postgres "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='blokum_db'\"" | grep -q 1; then
    skip "база blokum_db"
  else
    as_postgres "createdb -O blokum blokum_db"
    done_ "база blokum_db создана"
  fi
fi

# ── 5. Redis: БД 3 ────────────────────────────────────────────────────────────
step "Redis (БД ${REDIS_DB}, префикс bk:)"
if [ "$DRY_RUN" = 1 ]; then run redis-cli -n "$REDIS_DB" ping; else
  redis-cli -n "$REDIS_DB" ping | grep -q PONG || fail "Redis не отвечает"
  done_ "Redis отвечает"
fi

# ── 6. .env.prod ──────────────────────────────────────────────────────────────
step "Переменные окружения ${ENV_FILE}"
if [ "$DRY_RUN" = 0 ] && [ -f "$ENV_FILE" ]; then
  skip ".env.prod (существующий файл не перезаписывается)"
  if [ -n "$PG_PASSWORD" ]; then
    sed -i "s#^DATABASE_URL=.*#DATABASE_URL=postgresql://blokum:${PG_PASSWORD}@127.0.0.1:5432/blokum_db#" "$ENV_FILE"
    done_ "пароль новой роли blokum записан в DATABASE_URL"
  fi
else
  if [ "$DRY_RUN" = 1 ]; then run "сгенерировать $ENV_FILE из infra/env.prod.example (секреты — openssl rand)"; else
    [ -n "$PG_PASSWORD" ] || fail "Роль blokum уже есть, а .env.prod нет: задайте пароль вручную (ALTER ROLE blokum PASSWORD …) и создайте .env.prod из infra/env.prod.example"
    s1="$(openssl rand -hex 32)"; s2="$(openssl rand -hex 32)"; s3="$(openssl rand -hex 32)"
    sed -e "s#@@DOMAIN@@#${DOMAIN}#g" -e "s#@@MEDIA_DOMAIN@@#${MEDIA_DOMAIN}#g" -e "s#@@PG_PASSWORD@@#${PG_PASSWORD}#g" \
        -e "s#@@SECRET_1@@#${s1}#g" -e "s#@@SECRET_2@@#${s2}#g" -e "s#@@SECRET_3@@#${s3}#g" -e "s#^PRELAUNCH=.*#PRELAUNCH=${PRELAUNCH}#" \
        -e "s#@@DATA_ROOT@@#${DATA_ROOT}#g" "$SCRIPT_DIR/env.prod.example" > "$ENV_FILE"
    chown "$DEPLOY_USER:$DEPLOY_USER" "$ENV_FILE"; chmod 600 "$ENV_FILE"
    done_ ".env.prod создан (600), секреты сгенерированы и не выводятся"
  fi
fi

# ── 7. Пароль режима «до запуска» ─────────────────────────────────────────────
step "Режим «до запуска» (PRELAUNCH=${PRELAUNCH})"
if [ "$PRELAUNCH" = 1 ]; then
  if [ "$DRY_RUN" = 0 ] && [ -f "$HTPASSWD" ]; then skip "$HTPASSWD"; else
    if [ "$DRY_RUN" = 1 ]; then run "создать $HTPASSWD (логин blokum, случайный пароль)"; else
      pass="$(openssl rand -base64 12 | tr -dc 'A-Za-z0-9' | head -c 14)"
      printf 'blokum:%s\n' "$(openssl passwd -apr1 "$pass")" > "$HTPASSWD"
      chown root:www-data "$HTPASSWD"; chmod 640 "$HTPASSWD"
      done_ "доступ к сайту до запуска: логин blokum, пароль ${pass} (сохраните — больше не показывается)"
    fi
  fi
fi

# ── 8. Сертификат Let's Encrypt (только если домен уже указывает на сервер) ──
step "Сертификат для ${DOMAIN}, www.${DOMAIN}, ${MEDIA_DOMAIN}"
resolves_here() { getent ahostsv4 "$1" | awk '{print $1}' | grep -qx "$SERVER_IP"; }
HAVE_TLS=0
if [ "$DRY_RUN" = 1 ]; then
  run certbot certonly --webroot -w /var/www/certbot --cert-name "$CERT_NAME" -d "$DOMAIN" -d "www.$DOMAIN"
  HAVE_TLS=1
elif [ -f "/etc/letsencrypt/live/${CERT_NAME}/fullchain.pem" ] && { [ "$MEDIA_CERT" = "$CERT_NAME" ] || [ -f "/etc/letsencrypt/live/${MEDIA_CERT}/fullchain.pem" ]; }; then
  skip "сертификаты"; HAVE_TLS=1
elif resolves_here "$DOMAIN" && resolves_here "www.$DOMAIN" && resolves_here "$MEDIA_DOMAIN"; then
  HAVE_TLS=2
else
  echo "  ! ${DOMAIN}, www.${DOMAIN} или ${MEDIA_DOMAIN} ещё не указывают на ${SERVER_IP}."
  echo "    Добавьте A-записи у регистратора и запустите скрипт снова — сайт пока будет только на порту 80 (для проверки домена)."
fi

# ── 9. nginx ──────────────────────────────────────────────────────────────────
step "nginx: сайт blokum.conf (только server_name Блокума)"
install_nginx() {
  local with_tls="$1"
  if [ "$DRY_RUN" = 1 ]; then
    run "сгенерировать $NGINX_SITE из шаблона (TLS=${with_tls}, PRELAUNCH=${PRELAUNCH})"
    run ln -sfn "$NGINX_SITE" "$NGINX_LINK"
    run nginx -t
    run systemctl reload nginx
    return
  fi
  local tmp; tmp="$(mktemp)"
  render_nginx "$with_tls" "$tmp"
  local backup=""
  if [ -f "$NGINX_SITE" ]; then backup="$(mktemp)"; cp "$NGINX_SITE" "$backup"; fi
  install -m 644 "$tmp" "$NGINX_SITE"; rm -f "$tmp"
  ln -sfn "$NGINX_SITE" "$NGINX_LINK"
  if ! nginx -t 2>/tmp/blokum-nginx-test.log; then
    cat /tmp/blokum-nginx-test.log >&2
    if [ -n "$backup" ]; then install -m 644 "$backup" "$NGINX_SITE"; else rm -f "$NGINX_LINK" "$NGINX_SITE"; fi
    fail "nginx -t не прошёл — предыдущая версия blokum.conf восстановлена, nginx не перезагружался (BST не затронут)"
  fi
  systemctl reload nginx
  done_ "nginx перезагружен после успешного nginx -t"
}
run install -d -m 755 /var/www/certbot
if [ "$HAVE_TLS" = 2 ]; then
  install_nginx 0
  email_args=(--register-unsafely-without-email)
  [ -n "$CERTBOT_EMAIL" ] && email_args=(--email "$CERTBOT_EMAIL")
  if [ "$MEDIA_CERT" = "$CERT_NAME" ]; then
    run certbot certonly --webroot -w /var/www/certbot --cert-name "$CERT_NAME" -n --agree-tos "${email_args[@]}" \
      -d "$DOMAIN" -d "www.$DOMAIN" -d "$MEDIA_DOMAIN"
  else
    run certbot certonly --webroot -w /var/www/certbot --cert-name "$CERT_NAME" -n --agree-tos "${email_args[@]}" -d "$DOMAIN" -d "www.$DOMAIN"
    run certbot certonly --webroot -w /var/www/certbot --cert-name "$MEDIA_CERT" -n --agree-tos "${email_args[@]}" -d "$MEDIA_DOMAIN"
  fi
  done_ "сертификаты получены (обновляются certbot автоматически)"
  install_nginx 1
else
  install_nginx "$HAVE_TLS"
fi

echo
echo "════════════════════════════════════════"
echo " Готово. Дальше: GitHub → Actions → «Деплой» → Run workflow."
echo " Проверка: GitHub → Actions → «Диагностика сервера»."
echo "════════════════════════════════════════"
