# ---------------------------------------------------------------------------
# Take Me Home — application and certification images.
#
# Two targets, built from one dependency graph:
#
#   runtime   The production-like server. `next start` over a real `next build`,
#             as it ships. This is the artifact the browser journeys drive.
#   certify   The same source with dev dependencies and a browser, used to run
#             the suites from inside the network the stack lives on.
#
# The same application code runs inside and outside Docker. Nothing here is
# conditional on being containerised, and no image-only branch exists in the
# app — if a behaviour differs between `npm run start` and this image, that is
# a defect in the image, not a supported configuration.
#
# No `# syntax=` directive: nothing below uses a feature the built-in frontend
# lacks, and the directive makes every build fetch a frontend image first. A
# certification image should not need the network to decide how to parse its
# own Dockerfile.
# ---------------------------------------------------------------------------

# Pinned to an exact patch. A floating tag makes the image a moving target and
# a certification environment that moves is not one.
ARG NODE_VERSION=22.23.2

# ---------------------------------------------------------------------------
# base — the one place the runtime version is decided.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# ---------------------------------------------------------------------------
# deps — every dependency, installed from the lockfile.
#
# `npm ci` rather than `npm install`: it fails when package.json and the
# lockfile disagree instead of quietly resolving something new. A certification
# image that can drift in its dependency tree certifies a different tree each
# time it is built.
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
# build — the production build.
#
# NEXT_PUBLIC_* values are substituted at build time by Next, in server code as
# well as client code, so the URL and publishable key have to be present here
# rather than supplied at run time. Both are public by contract: the
# publishable key is protected by row-level security, not by secrecy, and
# lib/env.ts documents that split.
#
# The secret key is deliberately NOT an argument. It bypasses RLS, it is read
# only by lib/supabase/admin.ts, and a build argument is recoverable from image
# history — so it arrives at run time or not at all. scripts/docker/certify.sh
# asserts that no secret is recoverable from the built image.
# ---------------------------------------------------------------------------
FROM deps AS build
ARG NEXT_PUBLIC_SUPABASE_URL=""
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=""
ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL} \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}
COPY . .

# There is no public/ directory today. Creating it rather than dropping the
# copy below keeps the image correct the day someone adds one — a missing
# static asset is the kind of defect that only shows up in production, and a
# Dockerfile that silently stops copying assets is how it gets there.
RUN mkdir -p public && npm run build

# ---------------------------------------------------------------------------
# prod-deps — the same install, with the dev half removed.
#
# `npm prune` rather than a second `npm ci --omit=dev`. Two installs of the
# same lockfile is not just slower: BuildKit runs independent stages
# concurrently, and two npm processes resolving the same tree at once is enough
# to exhaust memory on a small runner — which npm reports as "Exit handler
# never called", an error that says nothing about its own cause. Pruning is
# derived from `deps`, so it cannot start until that install has finished, and
# it removes the packages rather than re-resolving them.
# ---------------------------------------------------------------------------
FROM deps AS prod-deps
RUN npm prune --omit=dev && npm cache clean --force

# ---------------------------------------------------------------------------
# runtime — production dependencies and the build output, nothing else.
# ---------------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY package.json package-lock.json ./
COPY --from=prod-deps /app/node_modules ./node_modules

COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.js ./next.config.js

# The base image ships a non-root `node` user (uid 1000). Ownership is set
# rather than left to root so the runtime user can read what it serves without
# the image granting write access to its own code.
RUN chown -R node:node /app
USER node

EXPOSE 3000

# Readiness, not liveness: /health renders without a database, without a
# session and without Supabase configured, so a passing check means the server
# is serving — and never means the database happens to be reachable this
# second. Anything that consults a dependency would flap on the dependency.
HEALTHCHECK --interval=5s --timeout=3s --start-period=40s --retries=20 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start"]

# ---------------------------------------------------------------------------
# certify — the suites, with a browser, inside the stack's network.
#
# Root, deliberately and only here: Playwright's Chromium needs to install its
# system libraries, and this image never serves traffic. The runtime image
# above is the one that does, and it does not run as root.
# ---------------------------------------------------------------------------
FROM deps AS certify
ENV CI=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# python3 is not incidental. `tests/resolve-db-url.test.ts` runs
# `scripts/resolve-db-url.py` through execFileSync, so a Node-only image cannot
# run this repository's suite — it runs 433 of 445 tests and fails the rest,
# which is how CI found this. An image that can run *most* of the suite is not
# a certification runner.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 \
 && npx playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/*

COPY . .

CMD ["scripts/docker/certify.sh"]
