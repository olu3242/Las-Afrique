# Take Me Home — engineering and design conventions

Persistent context for anyone (human or agent) working in this repository.

**Source-of-truth hierarchy.** `docs/PRD.md` defines product scope and
requirements. `docs/ITERATION-STANDARD.md` defines when an iteration may be
called done. This file defines engineering and design conventions. `README.md`
describes setup and current status. Code implements. When documentation and code
disagree, the PRD wins — fix the code, or fix the doc if the PRD justifies it.

## Current phase

**Phase 1 — core product, in progress.** The Phase 0 marketing route is complete
and stays live; Phase 1 is being built behind it in numbered iterations.
Iterations 1 and 2 are certified against the live Supabase project, not only
locally — see `docs/ITERATION-STANDARD.md` for what that required.

| Iteration | Scope | State |
| --- | --- | --- |
| 0 | Landing page and waitlist | PASS |
| 1 | Platform foundation — route separation, Supabase, schema, RLS | **PASS** |
| 2 | Auth and trip onboarding | **PASS** |
| 3 | Country intelligence | Built — awaiting hosted certification |
| 4 | Travel readiness | Built — awaiting hosted certification |
| 5 | Deterministic budget engine | Built — awaiting hosted certification |

Each iteration ships on its own branch and PR. Phase 2 scope (group
coordination, referrals, native apps, post-arrival concierge) stays out
entirely.

**An iteration is an engine, not a feature slice.** Compiling code, passing
isolated tests and existing UI do not make an iteration complete — the full path
from input through validation, domain logic, persistence, authorization and back
to a consumer has to work, and it has to consume the real preceding engine
rather than a duplicate of its logic. Read `docs/ITERATION-STANDARD.md` before
starting or certifying one.

Never report an iteration certified when a mock stands in for a dependency that
actually exists. Report `ENGINE_PARTIAL` or `BLOCKED` and name the gap.

## Stack

Next.js (App Router) · React · TypeScript (strict) · Tailwind CSS · Supabase
(Postgres, Auth) · Vitest

npm is the package manager. `package-lock.json` is committed.

## Brand system

These are fixed decisions. Do not introduce competing colours or typefaces.

### Colour

| Token | Hex | Use |
| --- | --- | --- |
| `indigo-950` | `#0F1026` | Page ground |
| `indigo-900` | `#14152B` | Raised surfaces, cards |
| `indigo-800` | `#1E2142` | Wells, track backgrounds |
| `sunset` | `#D4A24C` | Primary accent, calls to action, attention states |
| `baobab` | `#3F8C7A` | Positive and complete states |
| `ivory` | `#F5F1E8` | Primary text |
| `muted` | `#9593B0` | Secondary text, metadata |

`baobab-light` (`#6FBFA9`) exists for one reason: `baobab` on a `baobab`-tinted
surface falls to about 4:1, below the AA floor for small text. It is an
accessibility tint of an existing brand colour, not a new one. Use it only for
small text on tinted green surfaces.

### Typography

| Family | Role |
| --- | --- |
| **Fraunces** | Display — headings only |
| **Inter** | Body — all prose and UI text |
| **IBM Plex Mono** | Data, labels, statistics, countdowns |

**IBM Plex Mono must never become body typography.** It marks figures and
labels. Prose is Inter. The `.text-data` and `.text-label` utilities in
`app/globals.css` are the sanctioned mono entry points.

### The signature motif

The route line — origin to destination — is the product's one visual idea. It
represents the homecoming journey and evolves into the Phase 1 readiness
timeline:

```
Plan ━━━●━━ Prepare ━━━○━━ Budget ━━━○━━ Go home
```

It lives in `components/ui/route-motif.tsx`. Reuse it. **Do not introduce a
second, competing signature motif.** Where the motif acts as a connector behind
other markers, pass `stops={[]}` so it does not compete with them.

## Architecture rules

### The AI is not a source of truth

Carried over from the PRD because it constrains component design:

```
Cost Engine          →  numbers
Country Data Service →  requirements
AI                   →  planner and explainer only
```

Presentation components **receive** figures and render them. They do not compute
estimates, and they must not be built in a way that assumes the AI produced the
value. `BudgetBreakdown` derives bar widths and nothing else.

### Illustrative data

Everything in `lib/mock-data.ts` is illustrative Phase 0 example data. It is
typed to the shape the eventual engine and services return, so Phase 1 is a
data-source swap rather than a redesign.

Any surface showing illustrative figures must say so in visible copy. Never
present example data as live user data.

### Never fabricate requirements

Do not hardcode invented legal, immigration or medical facts to fill a card. For
Phase 0, safe framing is: "Country guide", "Requirements available", "Last
checked", "Verify before travel". State that a guide exists — not what it says.

## Route and component conventions

Two route groups share one root layout:

- `app/(marketing)/` — the public site. No authentication, renders statically.
- `app/(app)/` — authenticated product routes. Gated in middleware; rendered per
  request.

Route groups do not appear in URLs, so `app/(marketing)/page.tsx` is `/` and
`app/(app)/dashboard/page.tsx` is `/dashboard`.

- `components/ui/` — reusable presentation primitives
- `components/sections/` — page sections, composed of primitives
- Route files — composition only: a named list of sections, no layout logic

## Data access rules

Three Supabase entry points, and picking the wrong one is a security bug:

| Module | Key | Use |
| --- | --- | --- |
| `lib/supabase/client.ts` | publishable | Browser. Inside RLS. |
| `lib/supabase/server.ts` | publishable + session | Server components and actions. Inside RLS, acting as the signed-in user. |
| `lib/supabase/admin.ts` | secret | **Bypasses RLS.** Only where genuinely required. |

Both Supabase key generations are accepted — publishable/secret
(`sb_publishable_…` / `sb_secret_…`) and the legacy anon/service-role JWTs. The
current names take precedence. `lib/env.ts` owns that resolution; read keys
through it rather than off `process.env`, and note that `NEXT_PUBLIC_*` names
must stay written as literal static property paths or Next stops inlining
them.

Default to `server.ts`. Reach for `admin.ts` only when a privileged operation is
unavoidable — never to work around a policy you could write instead. Both
server modules import `server-only`, so pulling either into a client component
fails the build rather than leaking a key.

Never prefix a secret with `NEXT_PUBLIC_`. That prefix inlines the value into
the client bundle. `tests/bundle-safety.test.ts` enforces this.

## Database conventions

Migrations live in `supabase/migrations/`, applied in lexical order, and are
append-only — never edit a migration that has been applied anywhere real.

Every tenant-scoped table carries `user_id` referencing `auth.users`, with RLS
`enable`d **and** `force`d, and a policy for all four verbs comparing
`user_id = auth.uid()`. `with check` is always specified alongside `using`, so a
row cannot be inserted into, or re-assigned to, another user's ownership.

New tenant table means: add it to `TENANT_TABLES` in `lib/supabase/types.ts`.
The schema tests iterate that list, so a table added without policies fails.

Tests run against a real PostgreSQL cluster with the real policy predicates
(`npm run db:start && npm test`). Do not mock the database in RLS tests — a
mocked policy tests the mock, not the boundary.

Two tiers, and they prove different things:

| Suite | Runs against | Proves |
| --- | --- | --- |
| `npm test` | Throwaway local Postgres | The migrations and policies are correct |
| `npm run test:hosted` | The real Supabase project | They were actually applied there, and the API enforces them |

The local tier can be green while the hosted project is empty. Only the hosted
tier certifies a hosted engine — see `docs/ITERATION-STANDARD.md`.

`tests/hosted/**` is excluded from the default run and never has a fallback
connection default: a missing credential fails loudly rather than letting a
suite pass against the wrong database, or none.

Extract a component when it establishes a pattern Phase 1 will reuse. Do not
build a design system ahead of need, and do not abstract one-off components.

Server components by default. `"use client"` only where interaction requires it
(currently: the country selector and the waitlist form).

## Accessibility — WCAG 2.1 AA

Not optional. Every change is checked against these:

- One `h1` per page; no skipped heading levels
- Landmarks: `header`, `nav`, `main`, `footer`
- **Never remove visible focus styles.** The global `:focus-visible` ring in
  `globals.css` is load-bearing
- **State is never conveyed by colour alone** — pair every state with a glyph and
  a text label (see `lib/readiness.ts`)
- Form controls have real labels; meaningful images have alt text; decorative
  SVG is `aria-hidden`
- Interactive targets are at least 24×24 CSS pixels
- Contrast: 4.5:1 for normal text, 3:1 for large text — check against the
  *composited* background, not the page ground, when a surface is tinted
- `prefers-reduced-motion` is respected globally in `globals.css`; do not
  reintroduce motion that bypasses it

## Copy conventions

Plain, active, specific, non-salesy. Say what the product does.

Avoid: "Get Started", "Unlock", "Revolutionize", "Transform your journey",
"Seamless experience".

Never claim a capability that does not exist. Take Me Home does not book travel,
process applications, determine visa eligibility, or give immigration, legal or
medical advice.

## Before you commit

```bash
npm run lint
npm run typecheck
npm run db:start && npm test
npm run build
npm run test:e2e
```

CI runs all of these on every pull request (`.github/workflows/ci.yml`), with
the database suite against a real PostgreSQL service container and the
end-to-end suite against a production build. Run them locally first — a push
that turns CI red costs a cycle.

For visual changes, check 375 / 768 / 1024 / 1440 px for horizontal overflow,
stacking and touch targets. Mobile is a first-class experience, not a fallback.
