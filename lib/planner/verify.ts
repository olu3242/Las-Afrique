import type { PlannerTools, TripPlan } from "./contract";

/**
 * The guard that makes an AI planner safe to ship.
 *
 * A language model asked to plan a trip will, unprompted and fluently, produce
 * a flight price and a visa rule. Both will look right. Neither is allowed
 * here — the engines are the source of truth and the model relays them.
 *
 * So rather than trusting a prompt to hold the line, this checks the output:
 *
 *   1. Every ref a plan cites must exist in the tool snapshot. A dangling ref
 *      is a fabricated citation.
 *   2. No number may appear in the prose unless it matches a tool figure, or
 *      is small enough to be ordinary language ("3 travellers", "2 weeks").
 *      This is the one that catches an invented $1,450 airfare.
 *   3. A plan may not state an entry requirement for a destination the
 *      Country Data Service has not verified — the case where a hallucination
 *      makes someone miss a flight.
 *
 * A plan that fails is not shown. Not repaired, not shown with a warning:
 * the failure means the model disregarded the contract, and the next sentence
 * is no more trustworthy than the one that broke it.
 */

export interface Violation {
  kind: "unknown_ref" | "unsourced_figure" | "unverified_requirement";
  detail: string;
}

export interface VerificationResult {
  ok: boolean;
  violations: Violation[];
}

/**
 * Numbers below this are treated as ordinary language rather than as figures:
 * counts of people, nights, steps. Money in this product is never this small,
 * and the alternative — banning all digits — makes readable prose impossible.
 */
const INCIDENTAL_NUMBER_CEILING = 100;

/** Phrases that assert a requirement rather than describing a process. */
const REQUIREMENT_LANGUAGE =
  /\b(you (?:will )?need|requires?|required|must have|mandatory|visa[- ]free|no visa|eligible for)\b/i;

export function verifyPlan(
  plan: TripPlan,
  tools: PlannerTools,
): VerificationResult {
  const violations: Violation[] = [];

  const figureRefs = new Set(tools.figures.map((f) => f.ref));
  const factRefs = new Set(tools.facts.map((f) => f.ref));
  const allowedNumbers = new Set(tools.figures.map((f) => f.value));

  for (const step of plan.steps) {
    for (const ref of step.figureRefs) {
      if (!figureRefs.has(ref)) {
        violations.push({
          kind: "unknown_ref",
          detail: `Step "${step.title}" cites figure ${ref}, which no engine produced.`,
        });
      }
    }
    for (const ref of step.factRefs) {
      if (!factRefs.has(ref)) {
        violations.push({
          kind: "unknown_ref",
          detail: `Step "${step.title}" cites fact ${ref}, which no engine produced.`,
        });
      }
    }
  }

  for (const { text, where } of proseOf(plan)) {
    for (const found of numbersIn(text)) {
      if (found <= INCIDENTAL_NUMBER_CEILING) continue;
      if (allowedNumbers.has(found)) continue;
      violations.push({
        kind: "unsourced_figure",
        detail: `${where} contains the figure ${found}, which no engine produced.`,
      });
    }

    if (!tools.destinationVerified && REQUIREMENT_LANGUAGE.test(text)) {
      violations.push({
        kind: "unverified_requirement",
        detail:
          `${where} states a requirement, but ` +
          `${tools.destinationName ?? "this destination"} has no verified guide.`,
      });
    }
  }

  return { ok: violations.length === 0, violations };
}

function proseOf(plan: TripPlan): Array<{ text: string; where: string }> {
  return [
    { text: plan.summary, where: "The summary" },
    ...plan.steps.flatMap((step) => [
      { text: step.title, where: `Step "${step.title}" title` },
      { text: step.body, where: `Step "${step.title}"` },
    ]),
  ];
}

/**
 * Every number in a string, with separators and decimals normalised so
 * "$1,450.00" is compared as 1450 rather than slipping through as "1" and
 * "450".
 */
function numbersIn(text: string): number[] {
  const matches = text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  return matches
    .map((raw) => Number(raw.replace(/,/g, "")))
    .filter((n) => Number.isFinite(n));
}
