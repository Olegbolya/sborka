#!/usr/bin/env bash
# Первая подготовка чистого VPS (Ubuntu 24.04) под Блоккер — переезд с домашнего сервера (ADR-115).
# На домашнем сервере базовые программы (nginx, PostgreSQL, Redis, nvm, PM2, пользователь deploy) уже стояли ради BST;
# на новом VPS их ставит этот скрипт, а дальше работает обычный server-setup.sh. Запускает владелец один раз:
#   curl -fsSL https://raw.githubusercontent.com/Olegbolya/sborka/main/infra/vps-bootstrap.sh -o /tmp/vps-bootstrap.sh
#   sudo bash /tmp/vps-bootstrap.sh
# Повторный запуск безопасен: каждый шаг сначала проверяет, сделан ли он.
# Ключи входа: пользователь deploy получает ключи пользователя ubuntu (владелец) и, если владелец положил его заранее,
# файл /tmp/home_keys — ключи пользователя deploy с домашнего сервера (среди них ключ деплоя из GitHub).
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Olegbolya/sborka.git}"
DEPLOY_USER=deploy
DEPLOY_HOME="/home/$DEPLOY_USER"
NVM_VERSION=v0.40.1
SWAP_SIZE=4G

done_() { printf '  ✓ %s\n' "$1"; }
skip() { printf '  · %s — уже сделано\n' "$1"; }
step() { printf '\n▶ %s\n' "$1"; }
fail() { printf '✗ %s\n' "$1" >&2; exit 1; }

[ "$(id -u)" = 0 ] || fail "Запустите через sudo: sudo bash $0"
# shellcheck source=/dev/null
. /etc/os-release
[ "${VERSION_ID:-}" = "24.04" ] || fail "Скрипт рассчитан на Ubuntu 24.04, а здесь ${PRETTY_NAME:-неизвестная система}"

echo "════════════════════════════════════════"
echo " Блоккер: первая подготовка VPS $(date '+%Y-%m-%d %H:%M')"
echo "════════════════════════════════════════"

step "Системные пакеты (nginx, PostgreSQL 16, Redis, git, fail2ban, ufw, автообновления безопасности)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq nginx postgresql redis-server git curl ca-certificates openssl fail2ban ufw unattended-upgrades build-essential python3
systemctl enable --now nginx postgresql redis-server fail2ban >/dev/null
done_ "пакеты установлены и запущены"

step "Файл подкачки $SWAP_SIZE (сборке сайта при деплое и антивирусу нужна память сверх 4 ГБ)"
if swapon --show | grep -q .; then skip "подкачка"; else
  fallocate -l "$SWAP_SIZE" /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  done_ "подкачка $SWAP_SIZE включена и переживёт перезагрузку"
fi

step "Файрвол: открыты только SSH, 80 и 443"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
done_ "ufw включён"

step "Пользователь $DEPLOY_USER и ключи входа"
if id "$DEPLOY_USER" >/dev/null 2>&1; then skip "пользователь $DEPLOY_USER"; else
  adduser --disabled-password --gecos "" "$DEPLOY_USER" >/dev/null
  done_ "пользователь $DEPLOY_USER создан (без пароля, вход только по ключу)"
fi
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_HOME/.ssh"
KEYS="$DEPLOY_HOME/.ssh/authorized_keys"
touch "$KEYS"
for src in /home/ubuntu/.ssh/authorized_keys /tmp/home_keys; do
  [ -f "$src" ] || continue
  # Ключи, переданные через PowerShell, приходят с переводами строк Windows и иногда с BOM — они убираются.
  { sed -e 's/\r$//' -e '1s/^\xEF\xBB\xBF//' "$src" | grep -E '^(ssh-|ecdsa-|sk-)' || true; } | while IFS= read -r line; do
    grep -qxF "$line" "$KEYS" || printf '%s\n' "$line" >> "$KEYS"
  done
done
chown "$DEPLOY_USER:$DEPLOY_USER" "$KEYS"; chmod 600 "$KEYS"
done_ "ключей у $DEPLOY_USER: $(grep -c . "$KEYS" || true)"
[ -f /tmp/home_keys ] || echo "  ! /tmp/home_keys нет — ключа деплоя из GitHub у $DEPLOY_USER пока нет (см. инструкцию переезда)"

step "nvm, Node 22 и PM2 для $DEPLOY_USER"
if [ -s "$DEPLOY_HOME/.nvm/nvm.sh" ]; then skip "nvm"; else
  su - "$DEPLOY_USER" -c "git clone -q --depth 1 --branch $NVM_VERSION https://github.com/nvm-sh/nvm.git ~/.nvm"
  su - "$DEPLOY_USER" -c "grep -q 'NVM_DIR' ~/.bashrc || printf '%s\n' 'export NVM_DIR=\"\$HOME/.nvm\"' '[ -s \"\$NVM_DIR/nvm.sh\" ] && . \"\$NVM_DIR/nvm.sh\"' >> ~/.bashrc"
  done_ "nvm $NVM_VERSION"
fi
su - "$DEPLOY_USER" -c '. ~/.nvm/nvm.sh; nvm ls 22 >/dev/null 2>&1 || nvm install 22 --no-progress >/dev/null; nvm alias default 22 >/dev/null; command -v pm2 >/dev/null || npm install -g --silent pm2 >/dev/null'
# shellcheck disable=SC2016 # the expression is expanded by the shell of the deploy user
NODE_DIR="$(su - "$DEPLOY_USER" -c '. ~/.nvm/nvm.sh; dirname "$(nvm which 22)"')"
done_ "Node $("$NODE_DIR/node" --version), PM2 $(su - "$DEPLOY_USER" -c '. ~/.nvm/nvm.sh; pm2 --version' 2>/dev/null | tail -1)"
if systemctl list-unit-files | grep -q "^pm2-$DEPLOY_USER.service"; then skip "автозапуск PM2"; else
  env PATH="$NODE_DIR:$PATH" "$NODE_DIR/pm2" startup systemd -u "$DEPLOY_USER" --hp "$DEPLOY_HOME" >/dev/null
  done_ "PM2 поднимает сайт после перезагрузки сервера"
fi

step "Скрипты Блоккера и обычная подготовка (server-setup.sh)"
SRC="$(mktemp -d)"
git clone -q --depth 1 "$REPO_URL" "$SRC/repo"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_HOME/blokum" "$DEPLOY_HOME/blokum/setup"
rm -rf "$DEPLOY_HOME/blokum/setup/infra"
cp -r "$SRC/repo/infra" "$DEPLOY_HOME/blokum/setup/infra"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_HOME/blokum/setup"
rm -rf "$SRC"
done_ "скрипты в $DEPLOY_HOME/blokum/setup/infra"
bash "$DEPLOY_HOME/blokum/setup/infra/server-setup.sh"

echo
echo "════════════════════════════════════════"
echo " Готово. Дальше: деплой на этот сервер из GitHub (инструкция переезда, шаг «Первая выкладка»)."
echo "════════════════════════════════════════"
