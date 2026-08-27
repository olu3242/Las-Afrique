# Take Me Home

Homecoming trip planning for the African diaspora.

Take Me Home turns a trip home into something you can see: what your passport and
documents need, what the trip will cost, what to save each month, and how many
days are left. It calls that **Homecoming Readiness** — a single figure that
answers where you're going, when, what to do next, and how ready you are.

## Status: Phase 1 in progress — platform foundation

The Phase 0 marketing route is complete and stays live at `/`. Phase 1 is being
built behind it in numbered iterations, one branch and PR each:

| Iteration | Scope | State |
| --- | --- | --- |
| 0 | Landing page and waitlist | PASS |
| 1 | Platform foundation — route separation, Supabase, schema, RLS | PASS |
| 2 | Auth and trip onboarding | PASS |
| 3 | Country intelligence | PASS |
| 4 | Travel readiness | PASS |
| 5 | Deterministic budget engine | PASS |
| 6 | AI planner | ENGINE_PARTIAL — no provider configured |
| 7 | Dashboard | PASS |
| 8 | Document vault | PASS |
| 9 | Reminders | PASS |
| 10 | Golden path | PASS |
| 11 | Group coordination (Phase 2) | ENGINE_PARTIAL — awaiting hosted run |

An iteration counts as done only when its whole path works end to end and
consumes the real engine before it — see
[`docs/ITERATION-STANDARD.md`](docs/ITERATION-STANDARD.md).

Authentication works and the authenticated product is behind it: trips,
travellers, country guides, readiness, budget, documents and reminders. There
is no payment processing, and the AI planner has no provider configured, so it
reports itself unavailable rather than answering.

What the landing page does today:

- demonstrates the Homecoming Readiness model with clearly-labelled example data
- previews passport and document readiness across five states
- previews the deterministic budget breakdown, range, assumptions and savings plan
- presents the eleven launch countries with a "last checked" freshness signal
- collects waitlist interest

> **Not yet wired:** the waitlist form updates local state only. Nothing is
> stored or sent. Connect `components/sections/waitlist.tsx` to a real store
> before deploying this anywhere public.

All trip figures on the page are illustrative examples, labelled as such in the
interface. None of it is live user data.

## Getting started

Requires Node.js 18.18 or newer.

```bash
npm install
cp .env.example .env.local   # optional — the marketing route runs without it
npm run dev
```

The site runs at http://localhost:3000.

### Environment

`.env.example` documents the full contract. The split matters:

- `NEXT_PUBLIC_*` values are **inlined into the client bundle**. The Supabase
  publishable key belongs there — it is protected by row-level security, not
  secrecy.
- The server secret key **bypasses row-level security** and must never reach
  the browser. Only `lib/supabase/admin.ts` reads it, and that module imports
  `server-only` so misuse fails the build.

Both Supabase key generations are accepted, so a project issuing either works:

| Role | Current | Legacy |
| --- | --- | --- |
| Public | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_…`) | `NEXT_PUBLIC_SUPABASE_ANON_KEY` (`eyJ…`) |
| Secret | `SUPABASE_SECRET_KEY` (`sb_secret_…`) | `SUPABASE_SERVICE_ROLE_KEY` |

The current names win when both are set.

The marketing route builds and runs with no configuration at all. Protected
routes fail closed when Supabase is unconfigured.

### Database and tests

The test suite runs against a real PostgreSQL cluster, because row-level
security policies can only be verified by executing them:

```bash
npm run db:start   # throwaway local cluster on port 55432
npm test
npm run db:stop
```

Already have a Postgres you manage? Point `TEST_DATABASE_URL` at it and skip
`db:start`.

Browser end-to-end runs against a production build, because middleware,
prerendering and bundle contents all differ from the dev server:

```bash
npm run build
npm run test:e2e
```

On a machine with a pre-installed browser, point Playwright at it with
`PLAYWRIGHT_CHROMIUM_PATH` instead of downloading one.

### Hosted database

The local suites prove the migrations and policies are *correct*. They cannot
prove they were **applied to the project the app actually talks to** — that
needs the hosted project itself.

`.github/workflows/hosted-db.yml` closes that gap. It is manual only
(`workflow_dispatch`, confirmation required), applies `supabase/migrations/` in
order with `supabase db push`, and then proves the resulting state:

- every repo migration present in the hosted migration history
- exactly the expected tables
- RLS enabled **and forced** on every tenant table
- all four policy verbs per tenant table
- `anon` holding no grant on any tenant table
- two-user isolation via direct SQL, executing the real policies
- two-user isolation via the HTTP API, through real sessions and PostgREST

It never resets, drops or recreates anything. `supabase db reset` must not
appear in that workflow.

The credentials are **GitHub Environment secrets**, held in the environment named
`Los Afrique`, and the job declares `environment: Los Afrique` to read them. A
job without that declaration resolves every one of them to an empty string and
fails preflight — which is exactly how the first two dispatches failed. Do not
duplicate them as repository secrets to work around it; declare the environment.

Secrets required:

| Secret | Required | Purpose |
| --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | yes | CLI authentication |
| `SUPABASE_DB_PASSWORD` | yes | Migration push |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | API probes; the project ref is derived from it |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | API probes |
| `SUPABASE_DB_URL` | **yes** | Session pooler string from the Connect dialog, pasted **verbatim including the `[YOUR-PASSWORD]` placeholder** — the workflow substitutes `SUPABASE_DB_PASSWORD` with correct percent-encoding. Required: the direct host `db.<ref>.supabase.co` is IPv6-only and unreachable from GitHub runners |
| `SUPABASE_PROJECT_REF` | no | Derived from the project URL unless set explicitly |

The API probes create their two users through the Auth admin API
(`POST /auth/v1/admin/users` with `email_confirm: true`), then exchange the
credentials for real sessions. That route needs no change to the project's
email-confirmation setting, sends no mail, and is unaffected by the email rate
limit — all of which public signup runs into. The service-role key it needs is
read at run time from the Management API using `SUPABASE_ACCESS_TOKEN`; it is
not a stored secret and is never printed. Each run deletes the users it created.

`HOSTED_PROBE_EMAIL_DOMAIN` is optional: Supabase rejects `example.com` and the
reserved `.invalid` / `.test` TLDs, so set it if the project refuses the default
probe domain.

Run them yourself against a project you are pointed at:

```bash
npm run test:hosted
```

#### Rehearsing before you point at a real project

The probes and the migration push can both be exercised against a throwaway
local cluster first, which is worth doing before any run that mutates a hosted
project:

```bash
npm run db:start
createdb -h 127.0.0.1 -p 55432 -U postgres rehearsal
psql -h 127.0.0.1 -p 55432 -U postgres -d rehearsal -f supabase/test/00_auth_shim.sql

URL="postgresql://postgres@127.0.0.1:55432/rehearsal?sslmode=disable"
npx supabase db push --db-url "$URL" --include-all --skip-vault --dry-run
npx supabase db push --db-url "$URL" --include-all --skip-vault

SUPABASE_DB_URL="$URL" \
NEXT_PUBLIC_SUPABASE_URL=http://unused.invalid \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=unused \
  npx vitest run --config vitest.hosted.config.ts \
    tests/hosted/schema.test.ts tests/hosted/rls.test.ts
```

The auth shim stands in for the `auth` schema Supabase provides. `sslmode=disable`
is honoured only because the connection string asks for it — Supabase requires
TLS, so the hosted path is unaffected. The API suite is excluded from a
rehearsal: it needs PostgREST and GoTrue, which a bare cluster does not have.

### Continuous integration

`.github/workflows/ci.yml` runs on every pull request:

| Job | Does |
| --- | --- |
| Lint and types | ESLint, `tsc --noEmit` |
| Tests | Build unconfigured, then schema / RLS / bundle-safety against a real PostgreSQL service container |
| Browser E2E | Build, then Playwright against the production server |

The build step deliberately runs with **no** Supabase configuration: the
marketing site must build on a fresh checkout, and protected routes must fail
closed rather than fall open when unconfigured.

### Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint via `next lint` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest — schema, RLS and bundle-safety suites (local Postgres) |
| `npm run test:hosted` | Vitest — hosted schema, RLS and API probes against a real project |
| `npm run test:e2e` | Playwright — browser end-to-end against a production build |
| `npm run test:all` | Both suites |
| `npm run db:start` / `db:stop` | Local Postgres for the database tests |

## Stack

Next.js (App Router) · React · TypeScript (strict) · Tailwind CSS

Motion is CSS-only, so the global reduced-motion rule governs all of it.

Fonts are Fraunces (display), Inter (body) and IBM Plex Mono (data), loaded
through `next/font`.

## Layout

```
app/
  layout.tsx        Fonts, metadata, document shell
  globals.css       Base layer, brand utilities, reduced-motion rules
  icon.svg          Favicon
  (marketing)/      Public site — static
    page.tsx        Landing page composition
  (app)/            Authenticated product — gated in middleware
    layout.tsx      Signed-in shell
    dashboard/      Placeholder dashboard

middleware.ts       Session refresh and protected-route gate

components/
  ui/               Reusable primitives (badge, meter, route motif, breakdown…)
  sections/         Page sections composed from those primitives

lib/
  env.ts            Environment contract; public vs server-only split
  readiness.ts      Readiness state vocabulary and journey stages
  mock-data.ts      Illustrative Phase 0 data — replaced by real sources later
  format.ts         Currency formatting
  supabase/
    client.ts       Browser client (anon key, inside RLS)
    server.ts       Server client (session-scoped, inside RLS)
    admin.ts        Service-role client (bypasses RLS — server only)
    middleware.ts   Session refresh and route gating
    types.ts        Database types, kept in step with migrations by tests

supabase/
  migrations/       Applied in lexical order; append-only
  test/             Local auth shim and database test harness

tests/              Vitest suites — schema, RLS, bundle safety
scripts/test-db.sh  Throwaway Postgres cluster for the test suite

docs/
  PRD.md            Product requirements — the product authority
CLAUDE.md           Engineering and design conventions
```

## Documentation

- **[`docs/PRD.md`](docs/PRD.md)** — product scope, phases, requirements. The
  authority on what gets built.
- **[`CLAUDE.md`](CLAUDE.md)** — brand system, architecture rules, accessibility
  bar, copy conventions. Read this before changing the interface.

## Two principles worth knowing up front

**The AI is not a source of truth.** A deterministic Cost Estimation Engine
produces every cost figure; a Country Data Service supplies every requirement.
The assistant plans and explains — it never invents numbers or rules. The
interface is designed to make that separation visible.

**Accessibility is a requirement, not a pass.** WCAG 2.1 AA, mobile-first,
reduced motion respected, and no state ever conveyed by colour alone.

**Row-level security is the authorisation boundary.** Every tenant table denies
by default and is verified against a real Postgres in the test suite. Server
code runs *as the signed-in user*, not above them.
