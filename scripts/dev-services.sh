#!/usr/bin/env bash
# Starts local PostgreSQL 16 and Redis for development and tests in the agent sandbox
# (or any Ubuntu machine with postgresql-16 and redis-server installed). Idempotent.
set -euo pipefail

if command -v pg_ctlcluster >/dev/null 2>&1; then
  pg_ctlcluster 16 main start 2>/dev/null || true
  as_pg() { if [ "$(id -u)" = 0 ]; then su postgres -c "$1"; else sudo -u postgres bash -c "$1"; fi; }
  as_pg "psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='blokum'\"" | grep -q 1 \
    || as_pg "psql -c \"CREATE ROLE blokum LOGIN PASSWORD 'blokum' CREATEDB\""
  as_pg "psql -tc \"SELECT 1 FROM pg_database WHERE datname='blokum_test'\"" | grep -q 1 \
    || as_pg "createdb -O blokum blokum_test"
  as_pg "psql -tc \"SELECT 1 FROM pg_database WHERE datname='blokum_dev'\"" | grep -q 1 \
    || as_pg "createdb -O blokum blokum_dev"
  echo "PostgreSQL: postgresql://blokum:blokum@127.0.0.1:5432/blokum_dev (тесты — blokum_test)"
else
  echo "PostgreSQL 16 не найден — установите postgresql-16" >&2
fi

if command -v redis-server >/dev/null 2>&1; then
  redis-cli ping >/dev/null 2>&1 || redis-server --daemonize yes --port 6379 >/dev/null
  echo "Redis: redis://127.0.0.1:6379/3"
else
  echo "redis-server не найден — установите redis-server" >&2
fi
