# Take Me Home

Homecoming trip planning for the African diaspora.

Take Me Home turns a trip home into something you can see: what your passport and
documents need, what the trip will cost, what to save each month, and how many
days are left. It calls that **Homecoming Readiness** — a single figure that
answers where you're going, when, what to do next, and how ready you are.

## Status: Phase 0 — landing page and waitlist

This repository currently contains **one public marketing route**. There is no
authentication, no database, no AI and no payment processing. Those arrive in
Phase 1.

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
npm run dev
```

The site runs at http://localhost:3000.

### Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint via `next lint` |
| `npm run typecheck` | `tsc --noEmit` |

No environment variables are required for Phase 0.

## Stack

Next.js (App Router) · React · TypeScript (strict) · Tailwind CSS

Motion is CSS-only, so the global reduced-motion rule governs all of it.

Fonts are Fraunces (display), Inter (body) and IBM Plex Mono (data), loaded
through `next/font`.

## Layout

```
app/
  layout.tsx      Fonts, metadata, document shell
  page.tsx        Route composition — an ordered list of sections
  globals.css     Base layer, brand utilities, reduced-motion rules
  icon.svg        Favicon

components/
  ui/             Reusable primitives (badge, meter, route motif, breakdown…)
  sections/       Page sections composed from those primitives

lib/
  readiness.ts    Readiness state vocabulary and journey stages
  mock-data.ts    Illustrative Phase 0 data — replaced by real sources in Phase 1
  format.ts       Currency formatting

docs/
  PRD.md          Product requirements — the product authority
CLAUDE.md         Engineering and design conventions
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
