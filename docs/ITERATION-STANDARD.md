# Iteration standard — every iteration is an engine

The rule that governs when an iteration may be called done.

## The rule

An iteration is **not** complete because UI exists, schema exists, an API exists,
tests pass in isolation, or the code compiles.

An iteration is complete only when its engine works through the full real path:

```
UI/Input → Validation → Domain logic → Persistence/Service → Authorization
        → Output → UI/Consumer → Refresh/Replay
```

Each engine must prove two things:

1. **Internal correctness** — the logic is right
2. **Integration** — it composes with the engines before it

No mocked success path may substitute for a real implementation path **where the
actual dependency already exists**. Where the dependency genuinely does not exist
yet, say so and report `ENGINE_PARTIAL` or `BLOCKED` — never certify around it.

The purpose is to avoid ten individually "complete" pieces that do not compose
into a working product.

## Per-engine end-to-end paths

| # | Engine | Path that must work |
| --- | --- | --- |
| 1 | Platform | identity → tenant DB → RLS → server access → protected route |
| 2 | Trip onboarding | signup → profile → trip intake → travelers → validation → persistence → detail → refresh |
| 3 | Country intelligence | destination → canonical lookup → data service → provenance/freshness → consumer |
| 4 | Travel readiness | traveler + trip → country intelligence → documents → deterministic rules → readiness → next action → recompute on change |
| 5 | Budget | trip → travelers → destination → assumptions → FX → deterministic calculation → persistence → UI → savings target → "Why this estimate?" |
| 6 | AI planner | request → TripDraft → validation → country/readiness/budget tools → structured plan → persist → UI |
| 7 | Dashboard | trip → country → readiness → budget → documents → timeline → dashboard |
| 8 | Vault | user → validation → authorized upload → storage → metadata → association → view/download → delete → reconciliation |
| 9 | Reminders | deadline → derivation → scheduled job → idempotency → send abstraction → audit → retry/reschedule |
| 10 | Golden path | the complete MVP path, plus the adversarial cross-user path |

## Cross-engine rule

Every engine consumes the **real** preceding engine. Domain logic is never
duplicated:

- The planner *uses* the budget engine; it does not calculate budgets.
- The dashboard *uses* the readiness engine; it does not calculate readiness.
- Reminders *use* real deadlines; they do not keep a second deadline model.
- Country rules come from country intelligence; they are not restated in prompts.
- UI *consumes* domain results; it does not recreate business rules client-side.

The AI may orchestrate and explain. It may **not** reproduce or recalculate
authoritative country rules, readiness decisions, or budget figures. Certification
must show model output preserves tool values exactly where required.

## Engine contract

Document each engine as:

```
INPUT → VALIDATION → PROCESSING → SOURCE OF TRUTH → OUTPUT → PERSISTENCE → CONSUMERS
```

Avoid unnecessary abstraction; make ownership explicit.

## Certification per iteration

| Layer | Requirement |
| --- | --- |
| Unit | Core deterministic logic |
| Integration | Real dependencies, not stubs |
| Database | Migrations, persistence, RLS where applicable |
| Browser E2E | Real user flow wherever a UI exists |
| Replay | Refresh or re-run produces stable persisted behaviour |
| Negative path | Invalid and unauthorized usage fails correctly |
| Cross-engine | The previous engine is actually consumed |

## No false certification

Do **not** report an iteration certified when any of these hold:

- browser UI uses mocks while a backend exists
- an API returns fixture data on the production path
- database writes are never read back
- RLS is untested
- the only integration test replaces a service dependency with a stub
- AI fabricates deterministic values
- UI duplicates backend rules
- refresh loses state
- cross-user isolation is untested
- the happy path works but the dependency chain does not

Report `ENGINE_PARTIAL` or `BLOCKED` instead, naming the specific gap.

## Report block

Every `GOAL_REPORT` carries:

```
E2E_ENGINE_CERTIFICATION
- Input path:
- Validation:
- Domain engine:
- Source of truth:
- Persistence:
- Authorization:
- Consumer/UI:
- Refresh/replay:
- Negative path:
- Cross-engine dependency:
- Browser E2E:
- Result: PASS / PARTIAL / BLOCKED
```

An iteration may be declared complete only when
`E2E_ENGINE_CERTIFICATION = PASS`.

## Status

| # | Engine | Result | Gap |
| --- | --- | --- | --- |
| 0 | Phase 0 landing page | PASS | Waitlist submit is local-only; no backend exists yet to integrate with |
| 1 | Platform | **ENGINE_PARTIAL** | Hosted DB certified: migrations `0001`–`0003` applied to the project, and hosted schema (6/6), RLS (6/6) and API (6/6) all pass against it — including two signed-in users isolated through PostgREST. Still unproven: the `app route → lib/supabase/server.ts → Supabase → row → rendered UI` path and cookie session refresh, which need Iteration 2's auth UI |
| 2 | Trip onboarding | Not started | Unblocked — the hosted database is certified. The remaining work is the iteration's own: auth UI, trip form, and the server-side read path |
| 3–10 | — | Not started | Each blocked on its predecessor |

### Why Iteration 1 is partial

Its tests reach Postgres directly through `pg`, executing the real policies with
Supabase's own `auth.uid()`. That proves the database half of the chain
honestly. It does not exercise the application's own client, PostgREST, or
GoTrue, so "server access" and "refresh/session" in the Iteration 1 path remain
unproven.

`.github/workflows/hosted-db.yml` has now run against the real project. It
applied the migrations and proved the resulting state — schema, forced RLS,
policy coverage, grants, and two-user isolation executed through the project's
own `auth.uid()`.

The signed-in half of the HTTP path is proven too. The probes create two
confirmed users through the Auth admin API, exchange their credentials for real
sessions, and drive PostgREST with those tokens: one user's trip is visible to
its owner, absent for the other, and an insert forging the other's `user_id` is
refused. GoTrue, PostgREST and the policies are all in that path.

What remains unproven is the application's own half. Nothing yet reaches
Supabase through `lib/supabase/server.ts` from a rendered route, and no cookie
session is issued or refreshed by the app's middleware — the probes use bearer
tokens directly. Those are Iteration 2's to build and to certify, and until a
route exercises them the Iteration 1 path is partial.

### The local/hosted distinction

A green local suite means the migrations and policies are **correct**. It does
not mean they were **applied** anywhere. Those are different claims, and only
the hosted tier supports the second one.

This distinction is the most common way an iteration gets falsely certified: the
tests are real, the database is real, and the conclusion is still wrong because
the real database is not the one the application talks to.
