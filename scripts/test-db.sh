#!/usr/bin/env bash
#
# Throwaway PostgreSQL cluster for the database test suite.
#
#   scripts/test-db.sh start|stop|status
#
# The suite needs a real Postgres to exercise the actual RLS policies — a mock
# would test the mock, not the security boundary. If TEST_DATABASE_URL already
# points at a database you manage (a CI service container, a local install),
# skip this script entirely and set that variable instead.
set -euo pipefail

PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
PGDATA_ROOT="${PGDATA_ROOT:-/var/lib/postgresql/tmh-test}"
PGPORT="${PGPORT:-55432}"

if [ ! -x "$PG_BIN/pg_ctl" ]; then
  echo "postgres binaries not found at $PG_BIN — set PG_BIN" >&2
  exit 1
fi

# Postgres refuses to run as root, so cluster commands run as the postgres user
# when we happen to be root.
run_as_postgres() {
  if [ "$(id -u)" -eq 0 ]; then
    su postgres -s /bin/bash -c "PATH=$PG_BIN:\$PATH $1"
  else
    PATH="$PG_BIN:$PATH" bash -c "$1"
  fi
}

case "${1:-start}" in
  start)
    if [ ! -d "$PGDATA_ROOT/data" ]; then
      mkdir -p "$PGDATA_ROOT"
      if [ "$(id -u)" -eq 0 ]; then chown -R postgres:postgres "$PGDATA_ROOT"; fi
      run_as_postgres "initdb -D $PGDATA_ROOT/data -U postgres --auth=trust" >/dev/null
    fi
    if run_as_postgres "pg_ctl -D $PGDATA_ROOT/data status" >/dev/null 2>&1; then
      echo "already running on port $PGPORT"
    else
      run_as_postgres "pg_ctl -D $PGDATA_ROOT/data -o '-p $PGPORT -c listen_addresses=127.0.0.1' -l $PGDATA_ROOT/log start" >/dev/null
      echo "started on port $PGPORT"
    fi
    ;;
  stop)
    run_as_postgres "pg_ctl -D $PGDATA_ROOT/data stop" >/dev/null 2>&1 || true
    echo "stopped"
    ;;
  status)
    run_as_postgres "pg_ctl -D $PGDATA_ROOT/data status" || true
    ;;
  *)
    echo "usage: $0 start|stop|status" >&2
    exit 1
    ;;
esac
