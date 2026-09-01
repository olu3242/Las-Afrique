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

# ---------------------------------------------------------------------------
# Where the suites run.
#
# In the certify container when its image exists: it carries a pinned Chromium,
# which is the point of building it. Running Playwright on the host instead
# needs a browser the host may not have — the first CI run of this workflow
# failed exactly there, having installed no Chromium, and the journeys did not
# run at all rather than failing loudly.
#
# On the host when that image is unavailable. Some environments cannot build it
# (an egress policy that blocks apt inside containers, for one), and a tier
# that refuses to run at all there would be worse than one that runs with the
# host's browser and says so.
# ---------------------------------------------------------------------------
run_suites() {
  if docker image inspect takemehome-certify:local >/dev/null 2>&1; then
    log "running the suites in the certify container (pinned browser)"
    docker compose --env-file "$ENV_FILE" run --rm certify
  else
    warn "certify image not built; running the suites on the host with its own browser"
    scripts/docker/certify.sh
  fi
}

pass=1
run_pass() {
  printf '\n\033[1m========== CLEAN_DB_RUN_%d ==========\033[0m\n' "$pass"
  scripts/docker/stack.sh reset
  load_env_file
  docker compose --env-file "$ENV_FILE" up -d --wait app
  run_suites
  pass=$((pass + 1))
}

scripts/docker/stack.sh start

# Both images. The certify image carries the browser the journeys run in, so
# skipping it here is what left the first CI run of this workflow with no
# Chromium at all. Where it cannot be built, run_suites falls back to the host
# and says so.
docker compose --env-file "$ENV_FILE" build app
docker compose --env-file "$ENV_FILE" build certify || \
  warn "certify image could not be built here; the suites will run on the host"

load_env_file

# ---------------------------------------------------------------------------
# The secret is not recoverable from the image.
#
# Asserted here rather than inside certify.sh, and the reason is the bug this
# was: it is a claim about the *image*, and it was living in the script that
# runs *inside* the image. There is no Docker socket in there, so the check was
# guarded on `command -v docker` and silently did nothing on CI — passing
# locally, absent from the CI summary, and nobody the wiser. An assertion that
# quietly skips where it matters most is worse than one that was never written,
# because it reads as coverage.
#
# It belongs where the image is built: on the host, once, before either pass.
#
# tests/bundle-safety.test.ts proves no secret reaches the browser. This is the
# same rule one layer down: build arguments and ENV survive in image history,
# so "it is only a build argument" is not a place a key that bypasses row-level
# security may live.
# ---------------------------------------------------------------------------
log "checking no privileged key is recoverable from the application image"
if [ -n "${SUPABASE_SECRET_KEY:-}" ]; then
  if { docker history --no-trunc --format '{{.CreatedBy}}' takemehome-app:local
       docker image inspect --format '{{json .Config.Env}}{{json .Config.Labels}}' takemehome-app:local
     } | grep -qF "$SUPABASE_SECRET_KEY"; then
    die "the privileged key is recoverable from takemehome-app:local. It must arrive at run time, never as a build argument or ENV."
  fi
  log "IMAGE_SECRET_BOUNDARY=PASS"
else
  die "SUPABASE_SECRET_KEY is not set, so the image secret boundary cannot be checked. Run: npm run docker:start"
fi

run_pass          # CLEAN_DB_RUN_1
run_pass          # reset, then CLEAN_DB_RUN_2 — the one that proves reproducibility

printf '\n\033[1mLOCAL_DOCKER_CERTIFICATION: two clean runs passed\033[0m\n'
printf 'This is not hosted certification. See docs/DOCKER-CERTIFICATION.md.\n'
