# Iteration 12 — Referral Engine

**Status: APPROVED and BUILT.** Implemented in migration `0012_referrals.sql`
and `lib/referrals/`.

The six **[DECISION]** items below were resolved as proposed. Where the
approval pointed at "the proposed value in the scope" and this document did not
actually contain one, that is recorded honestly in §14 rather than papered
over.

The rest of this document is the proposal as it was approved. §14 records where
the implementation refined it and why — the proposal is the record of what was
agreed, so it is not silently rewritten to match the code.

---

## 1. The separation this engine rests on

Referral and reward are two mechanisms, and conflating them is what makes
referral programmes turn into money-transmission systems by accident.

```
Referral        who introduced whom, and did it count
Reward          what someone earned for it, and how that is honoured
```

This iteration builds the first and the *entitlement boundary* of the second.
It does not build fulfilment.

`RewardEntitlement` means **"this person earned something under a configured
reward policy."** It does not mean "Take Me Home owes them money," and it must
never come to mean that by accretion. PRD §8 is unambiguous: the product
**does not hold money**. Fulfilment — recognition, a partner-funded benefit, a
discount, a credit — is an adapter behind this boundary and a separate,
separately-authorised piece of work.

### The non-custodial invariant

Stated so it can be tested rather than remembered:

> No table in this engine may record a monetary balance, an amount owed, a
> transfer, or a settlement state.

An entitlement references *which policy* was satisfied and *when*. It carries
no amount and no currency. If a policy's benefit has a monetary value, that
value is a property of the policy description, not a liability recorded against
a user.

Enforced the way Iteration 11 enforced the same class of drift: a schema test
that fails on any column matching
`balance|escrow|wallet|payout|settle|transfer|ledger|owed|held_`. That drift
arrives one innocuous column at a time, and a review will not reliably catch
the third one.

---

## 2. Engine path

To be added to the per-engine table in `ITERATION-STANDARD.md` on approval:

```
program → code → invitation → attribution → qualification → entitlement
```

Read as a sentence: a programme defines the rules, a member gets a code, the
code carries an invitation, a signup is attributed to it inside a window, the
referred person eventually does the thing that counts, and the referrer becomes
entitled under the policy that was in force.

---

## 3. Domain objects

| Object | Owns | Notes |
| --- | --- | --- |
| `ReferralProgram` | The rules in force | Reference data, not tenant data. Versioned, never edited in place — an entitlement must be interpretable against the policy that applied when it was earned |
| `ReferralCode` | A member's code or link | One active code per user per programme |
| `ReferralInvitation` | An outbound invite | Optional: a code can be shared without an invitation record |
| `Referral` | The attributed relationship | The spine. One per referred user, ever |
| `RewardEntitlement` | "Earned under policy X at time T" | No amount, no currency, no balance |

`Referral` is deliberately the centre rather than `ReferralInvitation`.
Attribution can arise from a shared link with no invitation behind it, and
modelling the invitation as the spine would make that the awkward case rather
than the ordinary one.

---

## 4. State machine

Two machines, kept separate because they answer different questions.

### Invitation lifecycle

```
PENDING ──accept──> ACCEPTED
   │
   ├──revoke──> REVOKED
   └──expire──> EXPIRED
```

### Referral lifecycle — the one the referrer sees

```
INVITED ──signup within window──> JOINED ──policy predicate──> QUALIFIED
                                    │                              │
                                    └──────────> DISQUALIFIED <────┘
```

`QUALIFIED` is terminal for attribution purposes and is what an entitlement
hangs off. `DISQUALIFIED` is reachable from either state and is how fraud
controls and reversals are expressed without deleting history.

**[DECISION] What qualification means.** Options, in increasing strength and
increasing disclosure:

1. Account created and verified — weakest, easiest to game
2. First trip created
3. First trip with a destination and dates
4. Some engagement threshold

I would propose **(2)**, on the grounds that it is the first action that
demonstrates genuine product intent and is a single, unambiguous domain event.
But this is a product decision with commercial consequences and is left open.

Note the disclosure each option implies — see §5.

---

## 5. Privacy boundary

The part most likely to be got wrong, and the part I got wrong in my first
verbal proposal by suggesting the referrer see the referred user's trip
readiness. That is sensitive behavioural data, it is not needed to prove
attribution, and it would have reintroduced exactly the inference-leak class
Iteration 11 exists to prevent.

### What the referrer sees

| Visible | Not visible |
| --- | --- |
| Referral status: `INVITED` / `JOINED` / `QUALIFIED` | Anything about the referred user's trip |
| The address they themselves invited | Destination, dates, travellers, budget |
| Their own entitlements | Documents, vault contents, readiness |
| Counts across their own referrals | Group memberships, activity, login behaviour |

The referred user controls anything beyond status. If they wish to be visible
to their referrer by name, that is an opt-in on their side, defaulting off —
the same shape as `shares_readiness` in Iteration 11.

### Disclosures this engine inherently makes, stated rather than glossed

Honesty here matters more than a claim of zero knowledge:

- A referrer who invited a specific address and later sees `JOINED` learns that
  the person at that address created an account. That is intrinsic to referral
  and cannot be removed without removing the feature.
- `QUALIFIED` additionally reveals that the person took whatever action the
  policy names. The stronger the qualification predicate, the more it reveals —
  which is a reason to prefer a predicate that is coarse and early.
- Aggregate counts over a referrer's *own* referrals leak nothing further,
  because the referrer already knows who they invited. This is unlike the
  Iteration 11 group case, where the aggregate spanned people the viewer did
  not enumerate.

Everything past those three lines is a leak and must be refused.

### Tenancy

`Referral` rows are readable by the referrer and by the referred user, and by
nobody else. The referred user can always see who was credited for introducing
them — being the subject of an attribution you cannot inspect is not a position
to put someone in.

---

## 6. Attribution

### Window

**[DECISION]** Proposed: **30 days** from code resolution to signup.

### Model

**[DECISION]** Proposed: **last touch within the window**, on the grounds that
it is what the referred person most recently acted on and is the easier of the
two to explain to a disappointed referrer.

### Invariants

- **One attribution per referred user, for all time.** A unique constraint on
  the referred user id, not a rule in application code. A second attribution
  attempt is refused by the database.
- **Self-referral is refused** on: same user id; same normalised email
  (lower-cased, plus-addressing stripped, dots normalised for providers that
  ignore them).
- **Attribution is immutable once `QUALIFIED`.** It may be `DISQUALIFIED`, but
  it may not be re-pointed at a different referrer.

### Abuse controls

| Control | Mechanism |
| --- | --- |
| Duplicate attribution | Unique constraint on referred user |
| Self-referral | Identity and normalised-email comparison, refused at write |
| Invitation flooding | Rate limit per referrer per window **[DECISION: limit]** |
| Disposable addresses | **[DECISION]** — a blocklist is a maintenance burden with real false-positive costs for legitimate users; I would rather rely on the qualification predicate than police addresses |
| Ring referral | Qualification requiring genuine product use makes rings expensive; detection beyond that is out of scope |

Fraud controls that *reverse* an entitlement mark it `DISQUALIFIED` and leave
the history intact. Nothing is deleted — an entitlement that silently vanishes
is indistinguishable from a bug, to the user and to us.

---

## 7. Reward policy abstraction

```
ReferralProgram
  ├─ qualification_predicate   what counts
  ├─ attribution_window_days   how long a touch lasts
  ├─ reward_policy_key         which benefit applies
  └─ effective_from / to       versioning
```

`reward_policy_key` names a policy; it does not describe a payment. Fulfilment
reads the key and does whatever that policy means — display a recognition
badge, apply a partner benefit, issue a discount code. That adapter is **not in
this iteration**, and the engine is complete and certifiable without it.

Programmes are versioned and never edited in place, so an entitlement earned in
March remains interpretable in September against the rules that were actually
in force.

---

## 8. Persistence model

Migration `0012_referrals.sql`. New tables only; no existing migration is
touched, no destructive operation, canonical ordering preserved.

- `referral_programs` — reference data, world-readable, service-role writable
- `referral_codes` — tenant, owner-scoped
- `referral_invitations` — tenant, owner-scoped, token stored hashed
- `referrals` — dual-visibility (referrer and referred), the only table needing
  a policy shape not already in the codebase
- `reward_entitlements` — tenant, owner-scoped

Every tenant table: RLS `enable`d **and** `force`d, all four verbs, `with
check` alongside `using`, `anon` revoked, `authenticated` granted.

`referrals` needs the one genuinely new policy shape — readable by either of
two parties. It follows the Iteration 11 precedent for anything requiring a
lookup: a `security definer` helper with a pinned empty `search_path`, so a
policy predicate cannot recurse and a schema on the caller's path cannot
substitute a table underneath it.

---

## 9. API contract

Server actions, matching existing convention
(`session → validation → persistence under RLS → revalidate`):

| Action | Actor | Notes |
| --- | --- | --- |
| `ensureReferralCode()` | Member | Idempotent; returns the existing code |
| `inviteByEmail(email)` | Member | Rate limited; refuses self-referral |
| `resolveReferralCode(code)` | Anonymous | Records a touch; must not disclose the referrer |
| `attributeSignup(userId)` | System | Inside signup; refuses duplicates by constraint |
| `evaluateQualification(userId)` | System | Idempotent; fires on the qualifying domain event |
| `listOwnReferrals()` | Member | Status only, per §5 |
| `listOwnEntitlements()` | Member | Policy key and earned-at; no amounts |

`resolveReferralCode` runs for signed-out visitors and must not leak who owns a
code. A referral link is a shareable string, so treating code ownership as
public would let anyone enumerate members.

---

## 10. Analytics events

**[DECISION: destination]** — no analytics sink exists in this codebase today,
so this section defines shape only.

`referral.code_created`, `referral.link_resolved`, `referral.signup_attributed`,
`referral.qualified`, `referral.disqualified`, `referral.entitlement_earned`.

One rule governs all of them: **an analytics event may not become a side
channel around §5.** Events carry pseudonymous identifiers and the programme
key. No event carries the referred user's trip, readiness or behaviour, and no
event is delivered to the referrer.

---

## 11. E2E certification contract

Per the batch standard, and applying the Iteration 11 synchronisation lesson.

```
PRIMARY_ACTOR          A signed-in member with a referral code
STARTING_STATE         No prior referral relationship
USER_INTENT            Introduce someone, and see that it counted
DOMAIN_MUTATION        Invitation created; signup attributed; qualification evaluated
PERSISTED_STATE        referrals row INVITED → JOINED → QUALIFIED; entitlement row
RENDERED_RESULT        Referrer's page shows the status transition
RELOAD_PROOF           Survives reload — the row was written, not the page updated
NEGATIVE_PATH          Self-referral refused; duplicate attribution refused;
                       out-of-window signup not attributed
AUTHORIZATION_BOUNDARY A second signed-in member sees nothing of this referral,
                       and the referrer sees no trip data of the referred user
```

Primary journey shape — note the synchronisation boundary, which is the
Iteration 11 lesson made structural:

```
authenticate
→ obtain referral code
→ invite an address
→ ASSERT POST-ACTION RENDER          ← waits for the action and its revalidation
→ second browser context: sign up through the link
→ perform the qualifying action
→ back to referrer: ASSERT rendered status
→ VERIFY PERSISTED STATE             ← read the row, so a UI/DB disagreement is
                                       localisable rather than a guess
→ RELOAD
→ ASSERT durable outcome
```

`click()` is not proof that a server action completed. Eleven hosted runs in
Iteration 11 went to relearning that, and the sequence above encodes it so the
next engine does not pay for it again.

### Required dimensions

Happy path · authorization · ownership · invalid input · missing resource ·
idempotency (`ensureReferralCode`, `evaluateQualification`) · duplicate
operation (second attribution) · persistence · reload durability · concurrency
(two simultaneous attributions of the same user) · **privacy boundary** (the
referrer sees no trip data) · **consent boundary** (identity beyond status is
opt-in) · lifecycle transitions · reversal behaviour · migration compatibility ·
cross-engine regression (Iterations 1–11 unaffected).

---

## 12. Open decisions

Blocking approval:

1. **Qualification predicate** (§4) — proposed: first trip created
2. **Attribution window** (§6) — proposed: 30 days
3. **Attribution model** (§6) — proposed: last touch within window
4. **Invitation rate limit** (§6)
5. **Disposable-address policy** (§6) — proposed: do not police addresses
6. **Analytics destination** (§10) — none exists today

Explicitly *not* required to approve this iteration: what the reward actually
is. That is the point of the separation in §1 — the engine is certifiable
without it, and deciding it later cannot invalidate anything built here.

---

## 13. What this iteration does not do

- Hold, transfer, or owe money — PRD §8, enforced by schema test
- Fulfil a reward
- Decide what a reward is worth
- Expose any referred user's trip, readiness, documents or behaviour
- Require an AI provider — deterministic throughout, no dependency on the
  Iteration 6 blocker

---

## 14. As built

The approved decisions, and where the implementation departed from the
proposal.

### The six decisions

| # | Decision | Resolved as | Where it lives |
| --- | --- | --- | --- |
| 1 | Qualification predicate | First trip created | `referral_programs.qualification_predicate` |
| 2 | Attribution window | 30 days | `referral_programs.attribution_window_days` |
| 3 | Attribution model | Last touch within the window | The touch cookie, overwritten per resolution |
| 4 | Invitation rate limit | **20 per referrer per day — see below** | `referral_programs.invitation_rate_limit_per_day` |
| 5 | Disposable addresses | Not policed | No blocklist exists, by design |
| 6 | Analytics destination | **None — shape only, see below** | `lib/referrals/events.ts` |

**Decisions 4 and 6 named a proposed value this document did not contain.**

§6 marked the rate limit `[DECISION: limit]` with no number, and §10 stated
that no analytics sink exists and defined shape only. Rather than block the
whole engine on a constant, both were implemented so that the value is data
rather than a code change:

- **The rate limit is a programme column**, seeded at **20 per referrer per
  day**. It is a starting value chosen so that a person inviting their family
  is never impeded and a script is. Changing it is a programme version — end
  the current one, insert the next — not an edit and not a deploy.
- **Analytics has no destination.** Events are built, validated and discarded
  by `nullEventSink`. That is not a mock standing in for a dependency that
  exists; there is no analytics service in this codebase. When one is chosen it
  implements `ReferralEventSink` and the shapes are already fixed and tested.

### Where the implementation refined the proposal

**The stored states are `joined | qualified | disqualified`, not four.** §4
draws the referrer's lifecycle as `INVITED → JOINED → QUALIFIED`, and that is
exactly what the referrer sees. But a `referrals` row only exists once a signup
has been attributed, so `invited` is a state the table can never hold. Storing
it would have created an unreachable enum value. `INVITED` is composed in
`lib/referrals/lifecycle.ts` from a pending invitation with nothing attributed
to it. The visible lifecycle is unchanged.

**`referrals` needed no definer helper for its read policy.** §8 anticipated
one, following Iteration 11. It turned out not to be required: "readable by
either of two parties" is a disjunction over two columns of the row itself, not
a lookup, so there is no recursion to break. The definer functions that do
exist are there for the *writes*, which is a different problem.

**Attribution also runs at sign-in, not only at signup.** On a project with
email confirmation enabled, `signUp` returns no session at all — so attributing
only at signup would leave the engine silently inert on exactly those projects.
Attempting it at every sign-in needs a guard, or a long-standing user clicking a
friend's link would credit a referrer. `attribute_referral` therefore refuses a
touch that predates the account: `created_at` is not a column a caller can
forge, and the rule states the real requirement — the touch has to come before
the account, or this is not a referral.

**`resolveReferralCode` is reached through a route handler, not a page.** Only a
route handler or a server action may write a cookie, and the touch is a cookie.
`app/r/[token]/route.ts` reads nothing from the database: a public endpoint that
could tell a valid code from an invalid one is an enumeration oracle, and one
that resolved a code to its owner would disclose the referrer to anyone holding
a link. It is also why no referral table grants `anon` a single privilege.
