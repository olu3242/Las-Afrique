# Take Me Home — Product Requirements

> **Provenance.** This document was written from the project brief that
> commissioned the Phase 0 design foundation. It is a reconstruction, not a
> transcription of an earlier PRD — no prior PRD was present in this repository or
> anywhere in the working environment when the foundation was built. Treat it as
> the working product authority and correct it wherever it diverges from the
> founder's intent.

## 1. Product

Take Me Home helps members of the African diaspora plan a trip home.

The trip home is not a holiday booking. It is a long-horizon commitment with
document deadlines, a savings runway, family obligations and a departure date
that slips when any one of those goes unmanaged. Existing travel tools price
flights. None of them tell you whether you are *ready*.

## 2. The organising idea: Homecoming Readiness

Every surface answers the same seven questions:

| Question | Answered by |
| --- | --- |
| Where am I going? | Trip destination |
| When am I going? | Travel window and countdown |
| What do I need to do next? | Next action |
| Are my passport and documents ready? | Document checklist |
| What will this trip cost? | Cost Estimation Engine |
| Am I financially on track? | Savings progress |
| How ready am I overall? | Readiness score |

Readiness is a single number a traveller can watch move. It is the product's
spine: the marketing site previews it, the authenticated dashboard delivers it.

## 3. Phases

### Phase 0 — Landing page and waitlist *(current)*

A public marketing site that demonstrates the product model and collects
waitlist signups. No accounts, no database, no AI.

**Done when:** the landing page communicates Homecoming Readiness, and the
waitlist captures addresses.

### Phase 1 — The core product

- Authentication and user accounts
- AI Trip Planner
- Deterministic Budget Calculator
- Document checklist and deadline reminders
- Country intelligence
- Document vault
- Trip timeline

### Phase 2 — Later

- Group trip coordination
- Referral and rewards
- Native mobile applications
- Post-arrival AI concierge

Phase 2 capabilities must not be claimed on the Phase 0 site.

## 4. Architecture principle: three sources of truth

This separation is the most important constraint in the product, and it must
remain visible in the interface.

```
Cost Engine            →  the numerical source of truth
Country Data Service   →  the compliance and requirements source of truth
AI                     →  planner and explainer, never a source of truth
```

**The LLM does not produce cost figures.** A deterministic Cost Estimation
Engine computes every number from structured inputs — dates, travellers,
destination, trip length. The assistant explains those numbers, surfaces the
assumptions behind them and answers questions about them. It never invents them.

The same holds for entry requirements. The Country Data Service supplies them
with a source and a verification date attached. The AI relays; it does not rule.

### Why it matters

A hallucinated flight price loses trust. A hallucinated visa requirement makes
someone miss a flight, or worse. Determinism here is a safety property, not a
architectural preference.

## 5. Cost Estimation Engine

Categories:

Flights · Accommodation · Food · Local transportation · Visa and documents ·
Travel insurance · Activities · Family and shopping allowance · Contingency

Every estimate carries:

- an estimated **range** (low to high)
- a **planning target** — the figure to budget against
- the **assumptions** the estimate rests on
- a **confidence** level, driven by how much the traveller has specified
- **savings state**: amount saved, amount remaining, months remaining, monthly target

The engine's output shape is the contract. Presentation components consume it;
they never recompute it.

## 6. Country intelligence

Launch countries, in order. **Nigeria is the primary product example.**

1. Nigeria
2. Ghana
3. Kenya
4. Uganda
5. South Africa
6. Liberia
7. Cameroon
8. Sierra Leone
9. Senegal
10. Ivory Coast
11. Ethiopia

Each country guide can carry: currency, entry requirements, visa information,
passport considerations, major cities, emergency information, customs,
advisories, last-verified date and source.

**Constraint.** Take Me Home surfaces requirements; it is not the authority on
them. Every guide shows when it was last checked and tells the traveller to
verify before travel. Phase 0 mockups state that a guide *exists* — they never
state its contents.

## 7. Document readiness

Tracked per traveller: passport, visa or entry permit, required documents,
travel and vaccination requirements, deadlines, and the next action.

States: **Ready · Action needed · Upcoming · Missing · Expiring**

State is never communicated by colour alone.

Take Me Home does not give immigration, legal or medical advice.

## 8. Non-goals

Take Me Home does not book flights or accommodation, does not process passport
or visa applications, does not determine visa eligibility, and does not hold
money.

## 9. Quality bar

- **WCAG 2.1 AA.** Non-negotiable.
- **Mobile first.** The primary audience is mobile-first and often on
  constrained connections.
- **Reduced motion respected** throughout.
- Honest interfaces: illustrative data is always labelled as illustrative.
