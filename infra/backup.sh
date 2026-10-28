#!/usr/bin/env bash
# Резервная копия базы Блокума (P9.5, N-03, docs/02-ARCHITECTURE.md §8 п. 9): pg_dump → шифрование age → файл в BACKUP_DIR.
# Рядом с копией кладутся .sha256 и .counts (число строк ключевых таблиц на тот же снимок базы) — по ним restore-check.sh
# проверяет восстановление. Ключ шифрования у владельца: здесь только публичная часть (AGE_RECIPIENT), расшифровать копию
# сервер не может. Старые копии удаляются, остаются последние KEEP штук.
#
#   DATABASE_URL    строка подключения (из .env.prod)
#   AGE_RECIPIENT   публичный ключ age (age1…) или AGE_RECIPIENT_FILE — файл с ним
#   BACKUP_DIR      куда класть копии (по умолчанию /srv/blokum/backups)
#   KEEP            сколько копий хранить (по умолчанию 14)
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL не задан}"
BACKUP_DIR="${BACKUP_DIR:-/srv/blokum/backups}"
KEEP="${KEEP:-14}"
RECIPIENT="${AGE_RECIPIENT:-}"
if [ -z "$RECIPIENT" ] && [ -n "${AGE_RECIPIENT_FILE:-}" ]; then RECIPIENT="$(grep -v '^#' "$AGE_RECIPIENT_FILE" | head -n 1)"; fi
[ -n "$RECIPIENT" ] || { echo "Не задан публичный ключ age (AGE_RECIPIENT): без него копия не шифруется, а нешифрованные копии не делаются" >&2; exit 2; }
case "$KEEP" in '' | *[!0-9]*) echo "KEEP — целое число" >&2; exit 2 ;; esac
command -v age >/dev/null || { echo "Нет программы age" >&2; exit 2; }
command -v pg_dump >/dev/null || { echo "Нет pg_dump" >&2; exit 2; }

# Ключевые таблицы, по которым сверяется восстановление.
TABLES="users projects project_versions participant_sessions answers media audit_log moderation_actions"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
NAME="blokum-$STAMP.dump.age"
TMP="$BACKUP_DIR/.$NAME.partial"
trap 'rm -f "$TMP" "$BACKUP_DIR/.$NAME.counts.partial"' EXIT

# Один снимок базы для счётчиков и для дампа: сессия psql держит транзакцию открытой, пока идёт pg_dump.
coproc SNAP { psql -qAtX -v ON_ERROR_STOP=1 "$DATABASE_URL"; }
exec 3>&"${SNAP[1]}" 4<&"${SNAP[0]}"
printf '%s\n' 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;' 'SELECT pg_export_snapshot();' >&3
IFS= read -r SNAPSHOT <&4
SQL=""
for t in $TABLES; do SQL="${SQL}${SQL:+ || ' ' || }'$t=' || (SELECT count(*) FROM public.$t)::text"; done
printf 'SELECT %s;\n' "$SQL" >&3
IFS= read -r COUNTS <&4

pg_dump --format=custom --no-owner --snapshot="$SNAPSHOT" "$DATABASE_URL" | age -r "$RECIPIENT" >"$TMP"
printf '%s\n' 'COMMIT;' '\q' >&3
exec 3>&- 4<&-
wait "$SNAP_PID" 2>/dev/null || true

[ -s "$TMP" ] || { echo "Копия пустая — что-то пошло не так" >&2; exit 1; }
printf '%s\n' "$COUNTS" | tr ' ' '\n' >"$BACKUP_DIR/.$NAME.counts.partial"
( cd "$BACKUP_DIR" && mv ".$NAME.partial" "$NAME" && sha256sum "$NAME" >"$NAME.sha256" && mv ".$NAME.counts.partial" "$NAME.counts" )
trap - EXIT
chmod 600 "$BACKUP_DIR/$NAME" "$BACKUP_DIR/$NAME.sha256" "$BACKUP_DIR/$NAME.counts"
echo "Копия: $BACKUP_DIR/$NAME ($(du -h "$BACKUP_DIR/$NAME" | cut -f1)); строк: $COUNTS"

# Хранение: остаются последние KEEP копий со своими файлами сверки.
# shellcheck disable=SC2012
ls -1t "$BACKUP_DIR"/blokum-*.dump.age 2>/dev/null | tail -n +"$((KEEP + 1))" | while IFS= read -r old; do
  rm -f -- "$old" "$old.sha256" "$old.counts"
  echo "Удалена старая копия: $old"
done
