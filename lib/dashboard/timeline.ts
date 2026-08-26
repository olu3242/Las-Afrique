import type { Readiness } from "@/lib/readiness/engine";
import type { TripBudget } from "@/lib/budget/service";
import type { TripRow } from "@/lib/supabase/types";

/**
 * The route motif's four stages, as trip state.
 *
 * Pure and derived. A stored stage is one that keeps saying "Prepare" after
 * the traveller has finished preparing, and the same reasoning that keeps
 * freshness derived applies here.
 *
 * Each stage's status comes from the engine that owns the underlying question
 * — this file asks "is readiness clear?" rather than deciding what clear
 * means.
 */

export type TimelineStageId = "plan" | "prepare" | "budget" | "go-home";

export interface TimelineStage {
  id: TimelineStageId;
  title: string;
  status: "done" | "current" | "todo";
  /** Why it is in that state, in one line the traveller can act on. */
  detail: string;
}

export interface TimelineInput {
  trip: TripRow;
  readiness: Readiness;
  budget: TripBudget;
  // No country guide parameter, deliberately. Readiness already consumed the
  // Country Data Service and carries its verdict as `requirementsUnknown`;
  // taking the guide again here would be a second reading that could disagree
  // with the first, which is the duplication the cross-engine rule forbids.
}

export function deriveTimeline(input: TimelineInput): TimelineStage[] {
  const { trip, readiness, budget } = input;

  const planned =
    trip.destination_country_key !== null &&
    trip.depart_on !== null &&
    (trip.party_size ?? 0) > 0;

  // "Prepared" deliberately excludes verify_required. Nothing can be called
  // prepared while the destination's requirements are unknown, and treating
  // unknown as done is exactly the decay this project refuses.
  const blocking =
    readiness.counts.action_needed +
    readiness.counts.missing +
    readiness.counts.expiring;
  const prepared = blocking === 0 && !readiness.requirementsUnknown;

  const budgeted = budget.estimate.unavailableReason === null;
  const departed = hasDeparted(trip.depart_on);

  const stages: TimelineStage[] = [
    {
      id: "plan",
      title: "Plan",
      status: planned ? "done" : "current",
      detail: planned
        ? "Destination, dates and party size are set."
        : "Add your destination, dates and how many are travelling.",
    },
    {
      id: "prepare",
      title: "Prepare",
      status: prepared ? "done" : planned ? "current" : "todo",
      detail: prepared
        ? "Nothing outstanding that we can check."
        : readiness.nextAction
          ? readiness.nextAction.title
          : "Add travellers and their documents.",
    },
    {
      id: "budget",
      title: "Budget",
      status: budgeted && prepared ? "done" : budgeted ? "current" : "todo",
      detail: budget.estimate.unavailableReason ?? "An estimate is ready.",
    },
    {
      id: "go-home",
      title: "Go home",
      status: departed ? "done" : "todo",
      detail: trip.depart_on
        ? departed
          ? "Safe travels."
          : "Your departure date is set."
        : "Set a departure date.",
    },
  ];

  // Exactly one stage may be current, and it is the earliest unfinished one —
  // otherwise the motif shows two "you are here" markers.
  const firstCurrent = stages.findIndex((s) => s.status === "current");
  return stages.map((stage, index) =>
    stage.status === "current" && index !== firstCurrent
      ? { ...stage, status: "todo" as const }
      : stage,
  );
}

function hasDeparted(departOn: string | null): boolean {
  if (!departOn) return false;
  const depart = Date.parse(`${departOn}T00:00:00Z`);
  return !Number.isNaN(depart) && depart <= Date.now();
}
