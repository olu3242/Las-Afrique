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
| 1 | Platform | **PASS** | Hosted DB certified, and Iteration 2 now closes the half that was open: a rendered route reaches Supabase through `lib/supabase/server.ts`, and the middleware issues and refreshes the cookie session. Proven in a browser against the real project |
| 2 | Trip onboarding | **PASS** | Certified against the live project: the whole path driven in a browser, plus the adversarial cross-user case. Run [32999396356](https://github.com/olu3242/Las-Afrique/actions/runs/32999396356) on `6e3c08b` |
| 3 | Country intelligence | **PASS** | Certified against the live project — run [33021885473](https://github.com/olu3242/Las-Afrique/actions/runs/33021885473) on `6a1738f`. `0007` makes a requirement claim unstorable without a named source and a checked date |
| 4 | Travel readiness | **PASS** | Certified — run [33021885473](https://github.com/olu3242/Las-Afrique/actions/runs/33021885473) on `6a1738f`. Measures what we hold; reports requirement satisfaction as explicitly unknown while no destination is verified |
| 5 | Budget | **PASS** | Certified — run [33021885473](https://github.com/olu3242/Las-Afrique/actions/runs/33021885473) on `6a1738f`. Deterministic over stated rates; every figure resting on a placeholder says so on screen |
| 6 | AI planner | **ENGINE_PARTIAL** | Tool snapshot, contract, verifier, refusal path and UI are real and tested. The model call is not: no provider is configured for this project — no SDK, no key — so `planTrip` reports unavailable rather than returning a stub plan |
| 7 | Dashboard | **PASS** | Certified — run [33021885473](https://github.com/olu3242/Las-Afrique/actions/runs/33021885473) on `6a1738f`. Composes every preceding engine and computes none of them |
| 8 | Vault | **PASS** | The metadata half was always certified: `vault_files` through PostgREST, RLS, and ownership by object path. The storage half now is too — run [33024396183](https://github.com/olu3242/Las-Afrique/actions/runs/33024396183) on `66e13e2`. It stores an object under its owner's folder and reads the bytes back, resolves a signed URL with no `Authorization` header at all, and is refused on every crossing — anonymous read, another user's read, another user's *signing*, another user's write into the owner's folder, another user's delete — with the write and delete probes checking `storage.objects` afterwards rather than trusting the status code. The browser journey uploads a real PDF through the shipped form, reloads, follows the signed link to its bytes, and deletes it. Raised in review on #11, where the row said PASS on strictly less evidence than that word implies |
| 9 | Reminders | **PASS** | Certified — run [33023307266](https://github.com/olu3242/Las-Afrique/actions/runs/33023307266) on `4f8eb8d`. Scheduling fires on the mutations that change a deadline, and the journey now proves a reminder is actually written rather than asserting the empty state it used to agree with. Deadlines come from the readiness engine; idempotency is a unique constraint on a deadline-derived key |
| 10 | Golden path | **PASS** | Certified — run [33021885473](https://github.com/olu3242/Las-Afrique/actions/runs/33021885473) on `6a1738f`. Complete MVP path, adversarial second signed-in user on every surface, and the signed-out path |

### Iteration 2 — what was observed

Written down before the hosted run, so the gap between "built" and "certified"
stayed visible rather than being closed by assertion. It has since been closed
by a run, not by an edit.

| Path stage | Proven by | Where it ran |
| --- | --- | --- |
| UI / input | `e2e/trip-onboarding.spec.ts` | Browser, real project |
| Validation | `tests/trip-validation.test.ts` (26) + the same rules driven through the form | Local + browser |
| Domain logic | `lib/trips/validation.ts`, consumed by the action — not restated in the form | Local |
| Persistence | Trip and traveller rows read back after a reload | Browser, real project |
| Authorization | RLS suites (local + hosted) and Bob's 404 on Alice's trip URL | All three |
| Output / consumer | Trip detail and dashboard rendering database rows | Browser, real project |
| Refresh / replay | `page.reload()` after each mutation; cookie session refreshed by middleware | Browser, real project |

**Result.** `2 passed (19.3s)`, and the workflow's own guard reported *"The
signed-in journey ran for real."* — the step that fails the run if the spec
skipped rather than executed.

It took four hosted runs, and each failure is worth keeping because none of
them was the schema:

| Run | Failed on | What it actually was |
| --- | --- | --- |
| 1 | Two hosted schema probes | My queries. `proconfig` holds `search_path=""`; `regclass::text` drops the schema when `public` is on the search path. Both were hosted-*only* assertions, so nothing local could run them — they now run in both suites |
| 2 | Trip never saved | A real defect. React re-syncs an `<input>`'s `defaultValue` after its action, but not a `<select>`'s, so a trip refused for a bad date came back with the destination silently cleared |
| 3 | Traveller assertion | My locator. `getByText` matched both the list entry and the remove button's `sr-only` label — correct markup, imprecise test |
| 4 | — | Green |

### Why Iteration 6 is partial

The dependency genuinely does not exist. There is no model SDK in
`package.json` and no provider key in the environment, so there is nothing to
call. Per the rule at the top of this document, that is reported rather than
worked around.

What a stub would have bought is the appearance of a finished iteration, and
it would have proved nothing about the only question that matters here:
whether a *real* model's output survives the verifier. So `planTrip` returns
`unavailable`, and the trip page says so.

What is real, and tested against the failures a model actually produces:

- the tool snapshot, assembled from the real budget, readiness and country
  engines, which is the complete set of things a plan may say;
- the verifier, which rejects a figure no engine produced (including
  `1,450` written with a separator, and `4,800` against a target of `4,820`),
  a citation to a ref that does not exist, and any requirement language at all
  for a destination with no verified guide;
- the refusal path — a plan that fails is discarded, not shown with a warning,
  because a model that broke the contract once is not more trustworthy in its
  next sentence.

Wiring a provider in is a small change behind `setPlannerProvider`. Certifying
it needs a key this project does not have.

Two things are still deliberately *not* claimed:

- **Sign-up through the browser** is not in the journey spec. The project has
  email confirmation on, so signup returns no session and the action says so
  rather than pretending. The spec creates its users through the Auth admin
  API and proves sign-in onward. Sign-up's own logic is covered by the action
  and by the profile trigger tests, not by a browser run.
- **A skipped journey is not a pass.** The spec skips itself where no project
  is configured, and the hosted workflow fails the run if it skipped. Without
  that step a green job would mean nothing.

### Why Iteration 1 was partial, and what closed it

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

That application half is no longer missing. Iteration 2's routes reach Supabase
through `lib/supabase/server.ts` from rendered pages, and the middleware issues
and refreshes the cookie session that carries them — exercised in a browser
against the real project rather than with bearer tokens. That is what moved
Iteration 1 from `ENGINE_PARTIAL` to `PASS`, and it is why the heading above is
kept: the reasoning that made it partial is worth not losing.

### The local/hosted distinction

A green local suite means the migrations and policies are **correct**. It does
not mean they were **applied** anywhere. Those are different claims, and only
the hosted tier supports the second one.

This distinction is the most common way an iteration gets falsely certified: the
tests are real, the database is real, and the conclusion is still wrong because
the real database is not the one the application talks to.
