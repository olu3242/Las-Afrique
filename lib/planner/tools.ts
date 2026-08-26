import "server-only";

import type { TripRow, TravelerRow } from "@/lib/supabase/types";
import { getCountryGuide } from "@/lib/country/service";
import { getTripReadiness } from "@/lib/readiness/service";
import { getTripBudget } from "@/lib/budget/service";
import type { PlannerTools, ToolFact, ToolFigure } from "./contract";

/**
 * Builds the snapshot a plan may be made of.
 *
 * Every value comes from the real engine that owns it — the budget from the
 * Cost Estimation Engine, requirements from the Country Data Service,
 * readiness from its own engine. Nothing is recomputed here, and nothing is
 * added that no engine produced, because the verifier treats this snapshot as
 * the complete set of things a plan is allowed to say.
 */
export async function buildPlannerTools(
  trip: TripRow,
  travelers: TravelerRow[],
): Promise<PlannerTools> {
  const [guide, readiness, budget] = await Promise.all([
    getCountryGuide(trip.destination_country_key),
    getTripReadiness(trip, travelers),
    getTripBudget(trip),
  ]);

  const figures: ToolFigure[] = [];
  const currency = budget.estimate.currency;

  if (!budget.estimate.unavailableReason) {
    figures.push(
      {
        ref: "budget.planningTarget",
        value: budget.estimate.planningTarget,
        currency,
        label: "Planning target",
      },
      {
        ref: "budget.low",
        value: budget.estimate.estimateLow,
        currency,
        label: "Low estimate",
      },
      {
        ref: "budget.high",
        value: budget.estimate.estimateHigh,
        currency,
        label: "High estimate",
      },
      ...budget.estimate.categories.flatMap((line) => [
        {
          ref: `budget.${line.category}.low`,
          value: line.low,
          currency,
          label: `${line.category} (low)`,
        },
        {
          ref: `budget.${line.category}.high`,
          value: line.high,
          currency,
          label: `${line.category} (high)`,
        },
      ]),
    );

    if (budget.savings) {
      figures.push({
        ref: "savings.remaining",
        value: budget.savings.amountRemaining,
        currency,
        label: "Still to save",
      });
      if (budget.savings.monthlyTarget !== null) {
        figures.push({
          ref: "savings.monthlyTarget",
          value: budget.savings.monthlyTarget,
          currency,
          label: "Monthly savings target",
        });
      }
    }
  }

  const facts: ToolFact[] = [
    // Readiness items are statements the readiness engine is entitled to make.
    ...readiness.items.map((item) => ({
      ref: `readiness.${item.id}`,
      statement: `${item.title} — ${item.detail}`,
    })),
    // The guide's own freshness sentence, which already says what may be
    // relied on and what may not.
    ...(guide
      ? [
          {
            ref: "country.freshness",
            statement: `${guide.name}: ${guide.freshness.label}. ${guide.freshness.detail}`,
          },
        ]
      : []),
  ];

  if (readiness.nextAction) {
    facts.push({
      ref: "readiness.nextAction",
      statement: `${readiness.nextAction.title} — ${readiness.nextAction.detail}`,
    });
  }

  return {
    tripId: trip.id,
    destinationName: guide?.name ?? null,
    // Exactly the Country Data Service's judgement, not a second opinion.
    destinationVerified: guide !== null && guide.requirements !== null,
    figures,
    facts,
  };
}
