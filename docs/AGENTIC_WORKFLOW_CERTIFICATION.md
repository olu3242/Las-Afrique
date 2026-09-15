# Agentic Trip Workflow Certification

Branch: `feat/agentic-trip-workflow-e2e`

## Outcome boundary

Intent → Outcome Contract → Context → Plan → Governed Tools → Validation → Exception/Approval → Evidence → State Transition → Next Best Action → Verified Outcome.

This work extends the existing certified Take Me Home engines; it does not replace readiness, country intelligence, budget, planner, vault, reminders, dashboard, group coordination, or the existing golden path.

## Certification matrix

| Capability | Unit | Integration | DB | Browser | Live | Status |
|---|---|---|---|---|---|---|
| Canonical state machine | added | pending CI | n/a | pending | n/a | BLOCKED |
| Outcome contract/context | type contract | pending | persisted JSONB | pending | n/a | BLOCKED |
| Evidence/event ledger | pending | pending | migration 0016 | pending | pending hosted migration | BLOCKED |
| Exception/approval boundary | added | pending | migration 0016 | pending | provider unavailable | BLOCKED |
| Governed tool registry | added | pending | execution ledger | pending | provider unavailable | BLOCKED |
| Deterministic budget/replan | added + existing engine | pending | existing + workflow | pending | n/a | BLOCKED |
| Readiness/country/planner | existing | existing | existing | existing | AI provider unavailable | ENGINE_PARTIAL |
| Booking execution | approval boundary only | pending | ledger | pending | no booking/payment provider | NOT_IMPLEMENTED |
| Full E2E outcome | pending | pending | pending | pending | external providers | BLOCKED |

## Non-negotiable invariants

1. Invalid workflow state transitions fail closed.
2. Blocking requirements outrank booking actions.
3. Over-budget plans become `REPLAN_REQUIRED`.
4. External tools must be registered and validated.
5. Financial tools require a current explicit approval.
6. Workflow truth is persisted; chat history is never authoritative state.
7. Hosted/live status remains BLOCKED until the hosted Supabase migration and external provider evidence actually run.

## Remaining execution

The repository's prior certification reports 445 tests and 41/41 journeys per local Docker pass at main `2c2fad0`. This branch must run the same full certification plus the new workflow tests before merge. The hosted database gate must apply migration 0016. Booking/search/payment providers and an AI provider are external blockers; do not represent their paths as live until configured and certified.
