#!/usr/bin/env bash
# Starts the API for the e2e run (A-01, ADR-036): makes sure PostgreSQL is reachable, applies migrations, runs the API.
# Locally the database comes from `scripts/dev-services.sh`; on a CI runner without a database service
# (the E2E job has none) a throw-away `postgres:16` container is started, like the «Проверки» job does.
set -euo pipefail

DATABASE_URL="${DATABASE_URL:-postgresql://blokum:blokum@127.0.0.1:5432/blokum_test}"
export DATABASE_URL

db_up() { (exec 3<>/dev/tcp/127.0.0.1/5432) 2>/dev/null; }

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

pnpm db:migrate
exec pnpm --filter @blokum/api start
