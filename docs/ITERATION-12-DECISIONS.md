# Iteration 12 — Approved Product Decisions

**Status: APPROVED**

This record resolves the six product-owner decisions left open by `ITERATION-12-SCOPE.md`. Together, the scope proposal and this decision record are the authoritative implementation contract for Iteration 12.

## Resolved decisions

1. **Qualification predicate:** first trip created.
2. **Attribution window:** 30 days from referral-code resolution to signup.
3. **Attribution model:** last touch within the attribution window.
4. **Invitation rate limit:** 10 invitation attempts per referrer per rolling hour. Refused attempts count toward the limit so invalid-address probing cannot bypass it. This is an abuse-control ceiling, not a product engagement target, and can be versioned later without changing attribution history.
5. **Disposable-address policy:** do not police disposable email addresses in this engine. Qualification and attribution invariants remain the anti-abuse boundary; no third-party blocklist is introduced.
6. **Analytics destination:** no external analytics destination in Iteration 12. Preserve the event contract defined by the scope, but do not invent or add an analytics vendor/sink. Analytics emission becomes a separately authorized adapter when a destination exists.

## Harmonized implementation boundary

Iteration 12 is implementation-ready. The engine remains deterministic and non-custodial:

`program → code → invitation → attribution → qualification → entitlement`

`RewardEntitlement` records that a configured policy was satisfied; it records no amount, currency, balance, payout, transfer, settlement, or money owed. Reward value and fulfillment remain outside Iteration 12 and are not certification dependencies.

The privacy boundary remains unchanged: a referrer may see referral lifecycle status (`INVITED`, `JOINED`, `QUALIFIED`) and their own entitlements, but no referred user's trip, destination, dates, travelers, budget, documents, vault contents, readiness, activity, or login behavior. Identity beyond inherent referral disclosure remains opt-in by the referred user.

## Certification boundary

Implementation must satisfy `docs/ITERATION-STANDARD.md` using the real engine path, persistence, RLS/authorization, browser E2E where UI exists, replay/reload durability, negative paths, concurrency, privacy/consent boundaries, and cross-engine regression. Mocks or stubs may not substitute for an existing dependency.

Iteration 6 remains independently `ENGINE_PARTIAL` until a real AI provider is configured. Iteration 12 has no AI-provider dependency.
