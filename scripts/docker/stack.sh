#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Lifecycle for the local certification stack.
#
#   scripts/docker/stack.sh start|stop|reset|status|migrate|logs|shell
#
# The database, auth, REST and storage services are the supported Supabase
# local stack, started by the Supabase CLI. This project does not stand up its
# own GoTrue or PostgREST substitutes: the point of the environment is that the
# thing under test is the thing that ships, and a hand-rolled approximation of
# PostgREST would certify the approximation.
#
# Everything here is local-only by construction — see strip_hosted_credentials
# in lib.sh.
# ---------------------------------------------------------------------------

. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# Services the certification path does not exercise. Studio is a GUI, the
# others serve product surfaces this application does not use. Excluding them
# is not a shortcut: fewer moving parts is what makes a run reproducible.
EXCLUDE="studio,imgproxy,edge-runtime,logflare,vector,supavisor"

cmd_start() {
  require_docker
  strip_hosted_credentials
  note_linked_project
  if stack_is_up; then
    log "stack already running"
  else
    log "starting the local Supabase stack"
    supabase_cli start -x "$EXCLUDE"
  fi
  write_env_file
  log "wrote $ENV_FILE"
  cmd_status
}

# Stop, not destroy. `--no-backup` is deliberately absent: it deletes the data
# volumes, and a command called "stop" that silently loses a developer's local
# state is a command they only trust once. Destroying local data is `reset`,
# which says so.
cmd_stop() {
  require_docker
  strip_hosted_credentials
  log "stopping the application containers"
  docker compose down --remove-orphans 2>/dev/null || true
  log "stopping the local Supabase stack (local data is kept)"
  supabase_cli stop --yes || true
}

# `supabase db reset` drops and rebuilds the LOCAL database only. It is not the
# `--linked` variant and never will be: the hosted project is converged by the
# hosted workflow, from migrations, and nothing in this repository resets it.
cmd_reset() {
  require_docker
  strip_hosted_credentials
  note_linked_project
  stack_is_up || die "the stack is not running. Run: npm run docker:start"
  log "resetting the local database — every local row is destroyed"
  supabase_cli db reset --local
  write_env_file
}

cmd_migrate() {
  require_docker
  strip_hosted_credentials
  stack_is_up || die "the stack is not running. Run: npm run docker:start"
  # There is no separate "apply pending" for the local stack: a reset replays
  # every migration from an empty database, which is the stronger check
  # anyway — it proves the chain, not just its tail.
  cmd_reset
}

cmd_status() {
  require_docker
  if ! stack_is_up; then
    log "stack is not running"
    return 0
  fi
  log "containers"
  docker ps --filter "name=supabase_" --format '  {{.Names}}  {{.Status}}' | sort
  log "migration head applied to the local database"
  docker exec "$DB_CONTAINER" psql -U postgres -tAc \
    "select version from supabase_migrations.schema_migrations order by version desc limit 1" \
    2>/dev/null | sed 's/^/  /'
}

cmd_logs() {
  require_docker
  if [ $# -gt 0 ]; then
    docker logs -f --tail 200 "$1"
  else
    docker compose logs -f --tail 200
  fi
}

cmd_shell() {
  require_docker
  case "${1:-db}" in
    db)  docker exec -it "$DB_CONTAINER" psql -U postgres ;;
    app) docker compose exec app sh ;;
    *)   die "shell target must be 'db' or 'app'" ;;
  esac
}

case "${1:-status}" in
  start)   shift; cmd_start "$@" ;;
  stop)    shift; cmd_stop "$@" ;;
  reset)   shift; cmd_reset "$@" ;;
  migrate) shift; cmd_migrate "$@" ;;
  status)  shift; cmd_status "$@" ;;
  logs)    shift; cmd_logs "$@" ;;
  shell)   shift; cmd_shell "$@" ;;
  *) die "usage: $0 start|stop|reset|migrate|status|logs|shell" ;;
esac
