#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# LOCAL_DOCKER_CERTIFICATION
#
# The full chain against the local stack: migrations from empty, schema and
# policy suites, the production build, and the browser journeys.
#
# What this is
# ------------
# A pre-certification layer. It proves the migrations and policies are correct
# and that the engines compose, on a machine, before a hosted run is spent on
# finding it out. It runs the real GoTrue, the real PostgREST and the real
# Storage API, so the boundaries it exercises are the ones that ship.
#
# What this is NOT
# ----------------
# Hosted certification. A green run here says nothing about whether the
# migrations were applied to the real project, whether that project's policies
# match this repository, or whether its API enforces them. Only
# `npm run test:hosted` and .github/workflows/hosted-db.yml certify that, and
# docs/ITERATION-STANDARD.md is the authority on which of the two an iteration
# needs. Never report a green run of this script as hosted certification.
# ---------------------------------------------------------------------------

. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

STEP=0
step() { STEP=$((STEP + 1)); printf '\n\033[1m[%d] %s\033[0m\n' "$STEP" "$*"; }

RESULTS=()
record() { RESULTS+=("$1"); }

# ---------------------------------------------------------------------------
# Configuration comes from the running stack, and is asserted to be local
# before a single test runs.
# ---------------------------------------------------------------------------
step "environment"
# Even here, where nothing is destructive: a suite that could reach the hosted
# project could report a hosted result, and this tier's whole claim is that it
# cannot.
strip_hosted_credentials
if [ -z "${CI:-}" ] || [ -f "$ENV_FILE" ]; then
  load_env_file
fi
: "${NEXT_PUBLIC_SUPABASE_URL:?not set — run npm run docker:start}"
: "${TEST_DATABASE_URL:?not set — run npm run docker:start}"
assert_loopback "$NEXT_PUBLIC_SUPABASE_URL" "NEXT_PUBLIC_SUPABASE_URL"
assert_loopback "$TEST_DATABASE_URL" "TEST_DATABASE_URL"
log "target: $NEXT_PUBLIC_SUPABASE_URL (local)"

# ---------------------------------------------------------------------------
# The invariant the topology actually rests on.
#
# Every Supabase URL this application hands out has to resolve for whoever
# receives it. That is broader than it looks: the vault builds a **signed
# storage URL on the server** and gives it to the browser to fetch, so the
# address the server was configured with becomes an address the browser must
# reach. An earlier version of this environment put the app on a bridge
# network with an internal Kong hostname, on the reasoning that no client
# module imports lib/supabase/client.ts. That reasoning was true and
# irrelevant, and the journeys failed on it:
#
#   getaddrinfo ENOTFOUND supabase_kong_las-afrique
#
# Auditing imports could not have caught that, so the guard is not an import
# audit. Both services run on the host network, and what is checked is that
# the one address in play is a local one — which assert_loopback above has
# already done, for both the API and the database.
# ---------------------------------------------------------------------------
step "one address space"
# Read from the file rather than through `docker compose config`: this has to
# give the same answer from inside the certify container, which has no Docker
# socket.
host_networked="$(grep -cE '^[[:space:]]+network_mode:[[:space:]]*host' compose.yaml || true)"
[ "$host_networked" = "2" ] || die "compose.yaml puts $host_networked of 2 services on the host network. A signed storage URL the server generates must resolve for the browser that receives it — see the comment on the app service before changing this."
record "ADDRESS_SPACE=PASS"
log "application and runner share the host's addresses"

# ---------------------------------------------------------------------------
# Migration chain, from empty.
# ---------------------------------------------------------------------------
step "migration head matches the repository"
repo_head="$(ls supabase/migrations/*.sql | sed -E 's#.*/([0-9]+)_.*#\1#' | sort | tail -1)"
db_head="$(psql_head)"
log "repository: $repo_head    database: $db_head"
[ "$repo_head" = "$db_head" ] || die "the local database is at $db_head, the repository at $repo_head. Run: npm run docker:reset"
record "MIGRATION_HEAD=$db_head"

# ---------------------------------------------------------------------------
# Schema, RLS, grants, referral invariants, bundle safety.
#
# These build their own throwaway databases on the stack's cluster and replay
# every migration into each one, so the chain is exercised from empty on every
# run rather than inspected once at the end.
# ---------------------------------------------------------------------------
step "production build"
# Built before the suites, not after, because tests/bundle-safety.test.ts
# inspects real client chunks — with no build present it skips the one
# assertion that proves no secret reached the browser, and reports green.
npm run build
record "BUILD=PASS"

step "schema, row-level security and grant suites"
npm test
record "RLS_TESTS=PASS"
record "UNIT_TESTS=PASS"

# ---------------------------------------------------------------------------
# Build and browser journeys.
# ---------------------------------------------------------------------------
if [ "${SKIP_BROWSER:-0}" != "1" ]; then
  step "browser journeys against the running application"
  : "${E2E_BASE_URL:?not set}"
  npx playwright test
  record "E2E=PASS"

  # A journey that skipped is not a journey that passed, and a green Playwright
  # run reports both the same way. The hosted workflow already refuses to call
  # a skip evidence; the local tier gets the same guard, because the whole
  # point of this environment is that these journeys stop being hosted-only.
  step "skip guard"
  if [ -f e2e-results.json ]; then
    skipped="$(node -e '
      const r = require("./e2e-results.json");
      const names = [];
      const walk = (s) => {
        for (const spec of s.specs || []) {
          const skipped = spec.tests?.some((t) =>
            t.results?.some((x) => x.status === "skipped"),
          );
          if (skipped) names.push(spec.title);
        }
        for (const child of s.suites || []) walk(child);
      };
      for (const s of r.suites || []) walk(s);
      process.stdout.write(names.join("\n"));
    ')"
    if [ -n "$skipped" ]; then
      printf '%s\n' "$skipped" | sed 's/^/  skipped: /'
      die "journeys skipped rather than ran. A skip is not evidence — this environment exists so these execute."
    fi
  fi
  record "E2E_SKIP_GUARD=PASS"
  log "every journey executed"
else
  record "E2E=SKIPPED_BY_REQUEST"
fi

printf '\n\033[1mLOCAL_DOCKER_CERTIFICATION\033[0m\n'
printf '%s\n' "${RESULTS[@]}" | sed 's/^/  /'
printf '  HOSTED_CERTIFICATION=NOT_ATTEMPTED (this tier cannot certify the hosted project)\n'
