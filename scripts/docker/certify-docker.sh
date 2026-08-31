#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# `npm run certify:docker` — the whole thing, from nothing, twice.
#
# One successful stateful run proves a machine got lucky. This resets the
# database between two full passes, so what it proves is that the chain
# reproduces: every migration applies to an empty database, every suite passes
# against it, and doing it again from empty gives the same answer.
#
# Fails fast. A migration that does not apply stops the run there rather than
# letting later steps report on a database that is not the one described.
# ---------------------------------------------------------------------------

. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_docker
strip_hosted_credentials
note_linked_project

pass=1
run_pass() {
  printf '\n\033[1m========== CLEAN_DB_RUN_%d ==========\033[0m\n' "$pass"
  scripts/docker/stack.sh reset
  load_env_file
  docker compose --env-file "$ENV_FILE" up -d --wait app
  scripts/docker/certify.sh
  pass=$((pass + 1))
}

scripts/docker/stack.sh start

# Only the application image. The `certify` service exists for running the
# suites from inside the stack's network; this path runs them from here, and
# building a browser image that will not be used would add several minutes to
# every run for nothing. `npm run docker:build` builds both.
docker compose --env-file "$ENV_FILE" build app

run_pass          # CLEAN_DB_RUN_1
run_pass          # reset, then CLEAN_DB_RUN_2 — the one that proves reproducibility

printf '\n\033[1mLOCAL_DOCKER_CERTIFICATION: two clean runs passed\033[0m\n'
printf 'This is not hosted certification. See docs/DOCKER-CERTIFICATION.md.\n'
