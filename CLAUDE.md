# Take Me Home — engineering and design conventions

Persistent context for anyone (human or agent) working in this repository.

**Source-of-truth hierarchy.** `docs/PRD.md` defines product scope and
requirements. This file defines engineering and design conventions. `README.md`
describes setup and current status. Code implements. When documentation and code
disagree, the PRD wins — fix the code, or fix the doc if the PRD justifies it.

## Current phase

**Phase 0 — landing page and waitlist.** One public route. No authentication, no
database, no AI, no payments. See the PRD for what Phase 1 adds.

Do not start Phase 1 backend work without an explicit decision to move phases.

## Stack

Next.js (App Router) · React · TypeScript (strict) · Tailwind CSS

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

## Component conventions

- `components/ui/` — reusable presentation primitives
- `components/sections/` — page sections, composed of primitives
- `app/page.tsx` — route-level composition only: a named list of sections, no layout logic

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
npx tsc --noEmit
npm run build
```

For visual changes, check 375 / 768 / 1024 / 1440 px for horizontal overflow,
stacking and touch targets. Mobile is a first-class experience, not a fallback.
