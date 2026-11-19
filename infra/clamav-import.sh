#!/usr/bin/env bash
# ADR-122 · Ставит базы ClamAV, принесённые на сервер заданием GitHub «Скачать базы ClamAV» (или переездом, ADR-115),
# из ~deploy/blokum/shared/clamav-import в /var/lib/clamav и перезапускает антивирус. Запускается от root: cron
# /etc/cron.d/blokum-clamav-import раз в 15 минут и server-setup.sh. Ставятся только настоящие базы (заголовок
# ClamAV-VDB) и их файлы подписи; если ничего не изменилось — антивирус не трогается.
set -euo pipefail
SRC="${1:-/home/deploy/blokum/shared/clamav-import}"
DST=/var/lib/clamav
[ -d "$SRC" ] || exit 0
changed=0
shopt -s nullglob
for f in "$SRC"/*.cvd "$SRC"/*.cld "$SRC"/*.sign; do
  name="$(basename "$f")"
  case "$name" in
    *.sign) ;;
    *) [ "$(head -c 10 "$f")" = "ClamAV-VDB" ] || { echo "пропущен $name: не база ClamAV" >&2; continue; } ;;
  esac
  if [ -f "$DST/$name" ] && cmp -s "$f" "$DST/$name"; then continue; fi
  install -o clamav -g clamav -m 644 "$f" "$DST/$name"
  # A database replaces the other form of itself (main.cvd ↔ main.cld), otherwise clamd would load both.
  case "$name" in
    *.cvd) rm -f "$DST/${name%.cvd}.cld" ;;
    *.cld) rm -f "$DST/${name%.cld}.cvd" ;;
  esac
  changed=1
  echo "база антивируса: $name"
done
if [ "$changed" = 1 ] || ! systemctl is-active --quiet clamav-daemon; then
  systemctl reset-failed clamav-daemon 2>/dev/null || true
  if ! systemctl restart clamav-daemon; then
    echo "антивирус не запустился: sudo journalctl -u clamav-daemon -n 20" >&2
    exit 1
  fi
fi
