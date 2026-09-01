# MVP gap assessment

Assessment date: 2026-09-01  
Baseline: `main` at `2c2fad0`

## MVP outcome

A traveller can move from “I want to go home” to a saved, understandable plan
covering destination, dates, readiness, budget, next actions and documents.

## Current state

| Capability | State | Evidence / gap | MVP decision |
| --- | --- | --- | --- |
| Public product story | Complete | Marketing route demonstrates Homecoming Readiness | Keep |
| Waitlist conversion | Complete in this change | Submission now persists through insert-only RLS; duplicate-safe and non-enumerable | Deploy migration |
| Accounts and isolation | Complete | Auth, tenant RLS and hosted certification exist | Keep |
| Trip onboarding | Complete | Saved trip and traveller flows are certified | Keep |
| Country discovery | Partial | Eleven country identities exist, but requirement claims remain intentionally unverified | Load sourced Nigeria data first; never fabricate |
| Readiness | Complete for available facts | Deterministic engine and next action exist | Keep |
| Budget | Complete with illustrative assumptions | Deterministic range, target and savings calculations exist | Label illustrative data; source rates after MVP validation |
| AI trip planner | Blocked by configuration | Contract, tool snapshot, verifier and refusal UI exist; no real provider/key exists | Add provider adapter and certify only after a key is supplied |
| Dashboard and timeline | Complete | Real trip services feed the dashboard | Keep |
| Document vault | Complete | Private storage and signed links are certified | Keep |
| Reminders | Partial for delivery | Derivation and in-app persistence exist; email/push sender has no provider | In-app reminders satisfy controlled MVP; external delivery is post-key integration |
| Group coordination | Complete, beyond core MVP | Membership-scoped sharing is certified | Do not expand before validation |
| Referral engine | Complete, beyond core MVP | Attribution and qualification are certified | Do not expand rewards fulfilment before validation |
| Native mobile | Not started | Explicit Phase 2 platform | Exclude from MVP |
| Post-arrival concierge | Blocked | Depends on a real AI provider and travel-state design | Exclude from MVP |

## Remaining release gates

1. Apply `0017_waitlist.sql` to the hosted Supabase project and run the hosted
   schema/API gate.
2. Bind the production deployment to the same certified Supabase project and
   verify signup → trip → dashboard → vault → reminder on the deployed head.
3. Load a provenance-backed Nigeria country guide from official sources. Until
   then, the application must continue to say “verify required.”
4. Supply a server-only AI provider credential, implement the provider adapter,
   and prove a real model response passes the existing verifier. This gate is
   required only if model-backed planning is part of the controlled MVP claim.
5. Run accessibility and mobile browser certification on the exact release
   deployment.

## Release claim before those gates

`MVP_CODE_COMPLETE_WITH_HOSTED_GATES_PENDING`

Do not claim that AI planning, verified entry requirements, or external reminder
delivery are active until their real dependencies and hosted evidence exist.
