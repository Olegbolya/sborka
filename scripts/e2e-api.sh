#!/usr/bin/env bash
# Starts the API for the e2e run (A-01, ADR-036): makes sure PostgreSQL is reachable, applies migrations, runs the API.
# Locally the database comes from `scripts/dev-services.sh`; on a CI runner without a database service
# (the E2E job has none) a throw-away `postgres:16` container is started, like the «Проверки» job does. Redis, which the
# media queue needs (uploading a file puts a job in it), is handled the same way.
set -euo pipefail

DATABASE_URL="${DATABASE_URL:-postgresql://blokum:blokum@127.0.0.1:5432/blokum_test}"
export DATABASE_URL

db_up() { (exec 3<>/dev/tcp/127.0.0.1/5432) 2>/dev/null; }
redis_up() { (exec 3<>/dev/tcp/127.0.0.1/6379) 2>/dev/null; }

if ! db_up; then
  if command -v pg_ctlcluster >/dev/null 2>&1; then
    bash scripts/dev-services.sh || true
  fi
fi
if ! db_up && command -v docker >/dev/null 2>&1; then
  docker rm -f blokum-e2e-pg >/dev/null 2>&1 || true
  docker run -d --name blokum-e2e-pg -p 5432:5432 \
    -e POSTGRES_USER=blokum -e POSTGRES_PASSWORD=blokum -e POSTGRES_DB=blokum_test postgres:16 >/dev/null
  for _ in $(seq 1 60); do
    docker exec blokum-e2e-pg pg_isready -U blokum >/dev/null 2>&1 && break
    sleep 1
  done
fi
if ! db_up; then
  echo "PostgreSQL недоступен на 127.0.0.1:5432 — e2e входа не может запустить API" >&2
  exit 1
fi

if ! redis_up; then
  if command -v redis-server >/dev/null 2>&1; then
    redis-server --daemonize yes --port 6379 >/dev/null || true
    for _ in $(seq 1 10); do
      redis_up && break
      sleep 0.5
    done
  fi
  if ! redis_up && command -v docker >/dev/null 2>&1; then
    docker rm -f blokum-e2e-redis >/dev/null 2>&1 || true
    docker run -d --name blokum-e2e-redis -p 6379:6379 redis:7 >/dev/null
    for _ in $(seq 1 30); do
      redis_up && break
      sleep 1
    done
  fi
fi
if ! redis_up; then
  echo "Redis недоступен на 127.0.0.1:6379 — очередь медиа не заработает" >&2
  exit 1
fi

pnpm db:migrate
# Все участники e2e приходят с одного адреса: лимит стартов по адресу (TS-13) для них отодвинут; его проверяет тест API.
export PLAY_STARTS_PER_HOUR_PER_IP="${PLAY_STARTS_PER_HOUR_PER_IP:-1000000}"
# То же для жалоб (TS-11): их ограничение по адресу проверяет тест API.
export REPORTS_PER_HOUR_PER_IP="${REPORTS_PER_HOUR_PER_IP:-1000000}"
# Администраторы e2e (AD-01): эти номера в эмуляторе VK ID и Яндекс ID получают роль при входе; обычные тесты их не используют.
# 01–04 — вход администратора (A6); 11–13 и 21–23 — админка (P9.3): по три администратора на проект Playwright, они идут рядом.
export ADMIN_ACCOUNTS="${ADMIN_ACCOUNTS:-vk:700000000001,vk:700000000003,yandex:700000000002,yandex:700000000004,vk:700000000011,vk:700000000012,vk:700000000013,vk:700000000014,vk:700000000021,vk:700000000022,vk:700000000023,vk:700000000024}"
# Настройку второго фактора тест проходит с нуля: администраторы прошлого запуска стираются (сборки и данные уходят вместе с ними).
if command -v psql >/dev/null 2>&1; then
  psql "$DATABASE_URL" -q -c "DELETE FROM users WHERE id IN (SELECT user_id FROM auth_identities WHERE provider_user_id LIKE '7000000000__')" >/dev/null 2>&1 || true
fi
exec pnpm --filter @blokum/api start
