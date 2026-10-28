#!/usr/bin/env bash
# Проверка копии (P9.5, N-03): расшифровывает копию, восстанавливает её во временную базу, сверяет число строк ключевых таблиц
# с файлом .counts, который backup.sh записал на тот же снимок, и удаляет временную базу. Код выхода 0 — копия пригодна.
# Ключ расшифровки (AGE_IDENTITY_FILE) есть только у владельца; на сервере проверку запускают с ключом на время проверки.
#
#   ADMIN_DATABASE_URL  подключение с правом CREATE DATABASE (база в строке не важна)
#   AGE_IDENTITY_FILE   секретный ключ age (AGE-SECRET-KEY-…)
#   файл копии первым аргументом; без аргумента берётся самая свежая из BACKUP_DIR
set -euo pipefail

: "${ADMIN_DATABASE_URL:?ADMIN_DATABASE_URL не задан}"
: "${AGE_IDENTITY_FILE:?AGE_IDENTITY_FILE не задан}"
BACKUP_DIR="${BACKUP_DIR:-/srv/blokum/backups}"
FILE="${1:-}"
if [ -z "$FILE" ]; then
  # shellcheck disable=SC2012
  FILE="$(ls -1t "$BACKUP_DIR"/blokum-*.dump.age 2>/dev/null | head -n 1 || true)"
fi
[ -n "$FILE" ] && [ -f "$FILE" ] || { echo "Копий нет в $BACKUP_DIR" >&2; exit 1; }
[ -f "$FILE.counts" ] || { echo "Нет файла сверки $FILE.counts" >&2; exit 1; }
for tool in age pg_restore psql; do command -v "$tool" >/dev/null || { echo "Нет программы $tool" >&2; exit 2; }; done

( cd "$(dirname "$FILE")" && sha256sum --check --status "$(basename "$FILE").sha256" ) || { echo "Контрольная сумма копии не сходится: файл повреждён" >&2; exit 1; }

DB="blokum_restore_check_$(date +%s)_$$"
# Строка подключения к временной базе: та же, но с другим именем базы.
TARGET_URL="$(printf '%s' "$ADMIN_DATABASE_URL" | sed -E "s#(/)[^/?]*(\?|$)#\1$DB\2#")"
cleanup() { psql -qAtX "$ADMIN_DATABASE_URL" -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)" >/dev/null 2>&1 || true; }
trap cleanup EXIT
psql -qAtX -v ON_ERROR_STOP=1 "$ADMIN_DATABASE_URL" -c "CREATE DATABASE \"$DB\""

age --decrypt -i "$AGE_IDENTITY_FILE" "$FILE" | pg_restore --no-owner --exit-on-error --dbname="$TARGET_URL"

bad=0
while IFS='=' read -r table expected; do
  [ -n "$table" ] || continue
  actual="$(psql -qAtX -v ON_ERROR_STOP=1 "$TARGET_URL" -c "SELECT count(*) FROM public.$table")"
  if [ "$actual" = "$expected" ]; then
    printf '  ✓ %s: %s строк\n' "$table" "$actual"
  else
    printf '  ✗ %s: в копии %s, должно быть %s\n' "$table" "$actual" "$expected" >&2
    bad=1
  fi
done <"$FILE.counts"
[ "$bad" = 0 ] || { echo "Восстановление не сошлось с записанным числом строк" >&2; exit 1; }
echo "Копия $(basename "$FILE") восстановлена и сверена"
