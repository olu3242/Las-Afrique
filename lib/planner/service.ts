import "server-only";

import type { PlannerTools, TripPlan } from "./contract";
import { PLANNER_CONTRACT_VERSION } from "./contract";
import { verifyPlan, type Violation } from "./verify";

/**
 * Orchestration for the AI planner.
 *
 * What is real here: the tool snapshot, the contract, the verifier, and the
 * refusal path. What is not: the model call itself. No model provider is
 * configured for this project — there is no SDK in package.json and no key in
 * the environment — so `generate` has no implementation to call.
 *
 * That gap is reported rather than papered over. A stub that returns a
 * hand-written plan would make this iteration look finished and would prove
 * nothing about the thing that actually matters: whether a real model's output
 * survives the verifier. The verifier is fully built and fully tested against
 * the failures a model actually produces, so wiring a provider in is a small,
 * well-defended change.
 */

export interface PlannerProvider {
  /** Produces a plan from the tool snapshot. Never trusted; always verified. */
  generate(tools: PlannerTools): Promise<TripPlan>;
}

export type PlannerOutcome =
  | { status: "ok"; plan: TripPlan }
  | { status: "unavailable"; reason: string }
  | { status: "rejected"; violations: Violation[] };

let provider: PlannerProvider | null = null;

/** Registers a provider. Called from composition, not from a route. */
export function setPlannerProvider(next: PlannerProvider | null): void {
  provider = next;
}

export function plannerConfigured(): boolean {
  return provider !== null;
}

export async function planTrip(tools: PlannerTools): Promise<PlannerOutcome> {
  if (!provider) {
    return {
      status: "unavailable",
      reason:
        "The trip planner needs a language model provider, and none is " +
        "configured for this project yet. Your budget, readiness and country " +
        "guide are computed without it and are unaffected.",
    };
  }

  const plan = await provider.generate(tools);
  const verification = verifyPlan(plan, tools);

  // Not shown, not repaired. A plan that broke the contract once is not more
  // trustworthy in its next sentence.
  if (!verification.ok) {
    return { status: "rejected", violations: verification.violations };
  }

  return { status: "ok", plan: { ...plan, toolsVersion: PLANNER_CONTRACT_VERSION } };
}
