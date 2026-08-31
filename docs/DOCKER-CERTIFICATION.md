# Local Docker certification

A reproducible environment for validating migrations, policies, grants and the
engines end to end — on a machine, from empty, as many times as you like.

It exists because the hosted project had become the only place several things
could be observed, and each observation cost a full workflow run. Three real
defects in Iteration 12 were found that way, one of them a 500 on every user's
first visit to `/referrals`. None of the three needed a hosted project to be
found. They needed a real GoTrue, a real PostgREST and a real production build,
which is what this environment is.

## The boundary, stated first

| Tier | What a green run proves |
| --- | --- |
| `LOCAL_DOCKER_CERTIFICATION` | The migrations apply from empty, the policies and grants are correct, and the engines compose against real Supabase services |
| `HOSTED_SUPABASE_CERTIFICATION` | Those migrations were **actually applied to the real project**, and that project's API enforces them |

**A green Docker run is not hosted certification and must never be reported as
one.** The two answer different questions, and the local tier is structurally
incapable of answering the hosted one: it can be green against a perfect local
database while the hosted project is empty. `docs/ITERATION-STANDARD.md` is the
authority on which tier an iteration needs, and it has not changed — the hosted
tier still certifies a hosted engine.

What this tier changes is how many hosted runs it takes to get there.

```
        write ──► LOCAL_DOCKER_CERTIFICATION ──► HOSTED_SUPABASE_CERTIFICATION ──► promote
                  (fast, repeatable, free)        (the release gate)                (production)
```

## What is actually running

The database, auth, REST and storage services are the **supported Supabase
local stack**, started by the Supabase CLI from `supabase/config.toml`:

| Service | Image |
| --- | --- |
| PostgreSQL | `supabase/postgres:17.6.1.159` — the same major version as the hosted project |
| Auth | `supabase/gotrue` |
| REST | `postgrest/postgrest` |
| Storage | `supabase/storage-api` |
| Gateway | `kong` |
| Mail capture | `axllent/mailpit` |

This repository defines no substitute for any of them. A hand-rolled stand-in
for PostgREST would certify the stand-in, and the grant layer is exactly where
that would matter: `anon` is refused on `trips` by a **privilege**, before any
policy is consulted, and only the real PostgREST reports that.

`compose.yaml` adds the two services this repository owns — the production
build and the suite runner — both on the host network.

### Why host networking, and not a bridge

The first version of this environment put the application on the Supabase
bridge network with the internal hostname `supabase_kong_Las-Afrique:8000`. The
reasoning was that nothing in the browser bundle talks to Supabase directly —
no module imports `lib/supabase/client.ts`, and that was true.

It was also irrelevant. The first run of the browser journeys against the stack
failed with:

```
getaddrinfo ENOTFOUND supabase_kong_las-afrique
```

The vault builds a **signed storage URL on the server** and hands it to the
browser to fetch. A Supabase URL does reach the browser — not as an import, but
as a link. No amount of auditing imports would have found that.

So the invariant is not "no client module imports the browser client". It is:
**any Supabase URL the server hands out must resolve for whoever receives it.**
Two address spaces cannot satisfy that unless the server knows which audience
each URL is for, which is a distinction the application has no reason to carry.
One address space removes the question.

On Docker Desktop, host networking must be enabled (Resources → Network). On
Linux it is the default capability.

## Commands

```bash
npm run docker:start      # bring the stack up; writes .env.docker
npm run docker:build      # build the application and certify images
npm run docker:up         # start the application container, wait for healthy
npm run docker:test       # one full certification pass
npm run certify:docker    # the whole thing, from empty, twice
npm run docker:reset      # destroy the local database and replay every migration
npm run docker:e2e        # browser journeys only
npm run docker:status     # containers and the applied migration head
npm run docker:logs       # follow logs
npm run docker:shell      # psql on the local database (`... shell app` for the app)
npm run docker:stop       # stop the containers, keep the local data
npm run docker:down       # remove the application containers
```

### Why `certify:docker` runs twice

One successful run proves a machine got lucky with state left over from the
last one. The second run happens after a reset, from an empty database, and it
is the one that means anything. A chain that only applies cleanly the first
time is a chain that will fail for the next person who clones the repository.

## Credentials

`npm run docker:start` writes `.env.docker` from the running stack's own
status. It is gitignored, and it is not edited by hand — the file always
describes the stack you actually have.

The values in it are the Supabase CLI's **static local development
credentials**. Every checkout of every project produces the same ones, they are
published in Supabase's documentation, they authorise nothing outside this
machine, and `npm run docker:reset` destroys the database they belong to. They
are development credentials and are documented as non-production.

Nothing here is, or may become, a copy of a hosted credential:

- `SUPABASE_ACCESS_TOKEN` — the hosted management token
- `SUPABASE_DB_PASSWORD` — the hosted database password
- `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY` for the real project

Those are GitHub Actions secrets and reach the hosted workflow only.

### The safeguard

Every local command runs through `strip_hosted_credentials` in
`scripts/docker/lib.sh`, which **removes** hosted credentials from the child
process rather than refusing to start when it finds them.

That choice is the point. A refusal can be argued past, and a developer who
legitimately has those variables exported would learn to work around it. With
them removed, the Supabase CLI has no token to authenticate with and no project
reference to resolve: it is not that the local commands decline to touch the
hosted project, it is that they have nothing to touch it with. `SUPABASE_DB_URL`
matters most — `supabase db reset` honours it, and an exported hosted one is
precisely how a local reset stops being local.

Behind that, `assert_loopback` refuses any target that is not this machine, so
the guarantee does not rest on a single mechanism.

`npm run docker:reset` calls `supabase db reset` without `--linked`. Nothing in
this repository resets the hosted project; the hosted workflow converges it
forward from migrations and never resets it either.

## Secrets and image layers

`NEXT_PUBLIC_*` values are substituted by Next at build time — in server code
as well as client code — so the URL and publishable key are build arguments.
Both are public by contract: the publishable key is protected by row-level
security, not by secrecy.

`SUPABASE_SECRET_KEY` bypasses row-level security and is **run-time only**. It
is never a build argument, because build arguments survive in image history.
`tests/bundle-safety.test.ts` already proves no secret reaches the client
bundle; the split here is the same rule applied to image layers.

## The AI provider

`AI_PROVIDER_API_KEY` is supported as a run-time-only variable and is absent by
default. When no provider is configured, `planTrip` reports unavailable — it
does not return a stub plan, and **no mock stands in for the provider**.

Setting a real key locally lets a developer exercise the planner. It does not
certify Iteration 6, which stays `ENGINE_PARTIAL` until a real provider request
succeeds in a run recorded as evidence. A mock may appear only in tests
labelled as mock or unit tests, never as the thing under certification. That is
`docs/ITERATION-STANDARD.md`'s rule and this environment does not soften it.

## What the certification pass checks

`scripts/docker/certify.sh`, in order:

1. **Target is local.** `assert_loopback` on the API and database URLs before a
   single test runs.
2. **One address space.** Both services run on the host network so that
   `127.0.0.1:54321` names the same Supabase to the application, the browser
   and the runner. Asserted, not assumed — see below for the failure that made
   this a check rather than a convention.
3. **Migration head matches the repository.** The database's applied head
   against the highest file in `supabase/migrations/`.
4. **Schema, RLS, grants and unit suites.** `npm test` — each database suite
   builds its own throwaway database and replays every migration into it, so
   the chain is exercised from empty on every run.
5. **Browser journeys** against the production build.
6. **Skip guard.** A journey that skipped is not a journey that passed, and
   Playwright reports both as green. The hosted workflow has always refused to
   call a skip evidence; so does this.

## Journeys that used to be hosted-only

Before this environment, the four signed-in suites — golden path, trip
onboarding, group coordination, referral — skipped everywhere except the hosted
workflow. They needed a privileged key, and the only route to one was the
hosted Management API.

`e2e/support/supabase-admin.ts` now accepts a privileged key supplied directly,
preferring it over the Management API when both are available. Their first run
against this stack was worth the change on its own: 39 of 41 passed and the two
that failed found a real defect in the topology, described above. That ordering is
deliberate: a developer with both a local stack and hosted credentials exported
is running against the local stack, and silently reaching for the hosted
project instead would be the worst possible surprise.

The journeys themselves are unchanged, including the synchronisation contract
they were repaired to follow:

```
ACTION → ASSERT POST-ACTION RENDER → VERIFY PERSISTENCE → RELOAD → ASSERT DURABLE
```

No arbitrary sleeps are used as correctness mechanisms, here or anywhere else.
`click()` is not proof that a server action completed — that lesson cost a
hosted run and the specs still carry it.
