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
| 1 | Platform foundation — route separation, Supabase, schema, RLS | ENGINE_PARTIAL |
| 2 | Auth and trip onboarding | BLOCKED — needs a real Supabase project |
| 3 | Country intelligence | Not started |
| 4 | Travel readiness | Not started |
| 5 | Deterministic budget engine | Not started |

An iteration counts as done only when its whole path works end to end and
consumes the real engine before it — see
[`docs/ITERATION-STANDARD.md`](docs/ITERATION-STANDARD.md).

There is still no working authentication, no AI and no payment processing. The
`/dashboard` route exists and is gated, but has nothing behind it yet.

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
| `npm test` | Vitest — schema, RLS and bundle-safety suites |
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
