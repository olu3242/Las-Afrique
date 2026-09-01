#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Shared helpers for the local Docker certification environment.
#
# Sourced, never executed. Everything here exists to make one guarantee hold:
# a local command cannot reach the hosted Supabase project, however the shell
# it inherits happens to be configured.
# ---------------------------------------------------------------------------

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# The Supabase CLI derives container and network names from project_id.
PROJECT_ID="$(sed -n 's/^project_id[[:space:]]*=[[:space:]]*"\(.*\)"/\1/p' supabase/config.toml | head -1)"
: "${PROJECT_ID:?project_id missing from supabase/config.toml}"

STACK_NETWORK="supabase_network_${PROJECT_ID}"
DB_CONTAINER="supabase_db_${PROJECT_ID}"
KONG_CONTAINER="supabase_kong_${PROJECT_ID}"

# The URL the *containers* use to reach the stack. The host uses
# http://127.0.0.1:54321 for the same services; both are the same Kong.
INTERNAL_API_URL="http://${KONG_CONTAINER}:8000"

ENV_FILE="$REPO_ROOT/.env.docker"

log()  { printf '\033[1m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# The safeguard.
#
# Refusing to run when hosted credentials are present would be the obvious
# design and it is the weaker one: it can be argued past, and a developer who
# legitimately has them exported would learn to work around the refusal. This
# removes them from the child process instead, so the Supabase CLI has no
# credential to authenticate with and no project reference to resolve. It is
# not that the local commands decline to touch the hosted project — they have
# nothing to touch it with.
#
# SUPABASE_DB_URL matters most: `supabase db reset` honours it, and a shell
# that still had a hosted one exported is exactly how a local reset stops
# being local.
# ---------------------------------------------------------------------------
strip_hosted_credentials() {
  local stripped=()
  local name
  for name in SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_REF SUPABASE_DB_PASSWORD \
              SUPABASE_DB_URL SUPABASE_PROJECT_ID; do
    if [ -n "${!name:-}" ]; then
      stripped+=("$name")
      unset "$name"
    fi
  done
  if [ ${#stripped[@]} -gt 0 ]; then
    warn "hosted credentials removed from this command's environment: ${stripped[*]}"
    warn "local commands never talk to the hosted project; use the hosted workflow for that."
  fi
}

# A second barrier behind the first, for the case the first is ever loosened:
# assert the thing we are about to operate on is on this machine.
assert_loopback() {
  local url="$1" label="$2" host
  host="$(printf '%s' "$url" | sed -E 's#^[a-z0-9+.-]+://##; s#^[^@]*@##; s#[/?].*$##; s#:[0-9]+$##')"
  case "$host" in
    127.0.0.1|localhost|::1|"[::1]"|"$KONG_CONTAINER"|"$DB_CONTAINER") ;;
    *) die "$label points at '$host', which is not this machine. Refusing." ;;
  esac
}

# A linked project is not itself dangerous — the CLI still needs an access
# token, and strip_hosted_credentials has taken it. Worth saying out loud
# anyway, because a developer reading "reset" wants to know what it is aimed at.
note_linked_project() {
  if [ -f "supabase/.temp/project-ref" ]; then
    warn "this checkout is linked to a hosted project; the commands below still only touch local containers."
  fi
}

require_docker() {
  command -v docker >/dev/null 2>&1 || die "docker is not installed or not on PATH."
  docker info >/dev/null 2>&1 || die "the Docker daemon is not reachable. Start Docker and retry."
}

stack_is_up() {
  docker network inspect "$STACK_NETWORK" >/dev/null 2>&1 &&
  [ "$(docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null)" = "true" ]
}

supabase_cli() { npx --no-install supabase "$@"; }

# Read the running stack's own credentials rather than hardcoding them. They
# are static development values, but they belong to the CLI's config, and a
# copy in this repository would be a second source of truth that goes stale.
write_env_file() {
  local status
  status="$(supabase_cli status -o env 2>/dev/null | grep -E '^[A-Z0-9_]+=')" \
    || die "could not read the local stack's status. Is it running?"

  local api anon publishable secret db
  api="$(sed -n 's/^API_URL="\(.*\)"$/\1/p'          <<<"$status")"
  anon="$(sed -n 's/^ANON_KEY="\(.*\)"$/\1/p'        <<<"$status")"
  publishable="$(sed -n 's/^PUBLISHABLE_KEY="\(.*\)"$/\1/p' <<<"$status")"
  secret="$(sed -n 's/^SECRET_KEY="\(.*\)"$/\1/p'    <<<"$status")"
  db="$(sed -n 's/^DB_URL="\(.*\)"$/\1/p'            <<<"$status")"

  [ -n "$api" ] && [ -n "$db" ] || die "the local stack reported no API or database URL."
  assert_loopback "$api" "the local API URL"
  assert_loopback "$db"  "the local database URL"

  cat > "$ENV_FILE" <<ENVEOF
# Generated by scripts/docker/stack.sh — do not commit, do not edit by hand.
#
# These are the Supabase CLI's static local development credentials. They are
# not secrets: every checkout of every project produces the same ones, they
# authorise nothing outside this machine, and the stack they belong to is
# destroyed by \`npm run docker:reset\`. They are written here rather than
# committed so that the file a developer has always matches the stack they are
# actually running.
NEXT_PUBLIC_SUPABASE_URL=$api
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$publishable
NEXT_PUBLIC_SUPABASE_ANON_KEY=$anon
SUPABASE_SECRET_KEY=$secret
TEST_DATABASE_URL=$db
E2E_BASE_URL=http://127.0.0.1:3000
ENVEOF
  chmod 600 "$ENV_FILE"
}

load_env_file() {
  [ -f "$ENV_FILE" ] || die "$ENV_FILE is missing. Run: npm run docker:start"
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
}

# The migration version the target database actually carries.
#
# Read through `pg` rather than `docker exec ... psql`: this has to give the
# same answer from the host and from inside the certify container, and only one
# of those two has a Docker socket.
psql_head() {
  node -e '
    const { Client } = require("pg");
    const c = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    c.connect()
      .then(() =>
        c.query(
          "select version from supabase_migrations.schema_migrations order by version desc limit 1",
        ),
      )
      .then((r) => {
        process.stdout.write(r.rows[0] ? r.rows[0].version : "");
        return c.end();
      })
      .catch((e) => {
        console.error(e.message);
        process.exit(1);
      });
  '
}
