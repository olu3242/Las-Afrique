import "server-only";

import { createClient } from "@/lib/supabase/server";
import { listTrips, type TripListItem } from "@/lib/trips/service";
import { getCountryGuide } from "@/lib/country/service";
import { getTripReadiness } from "@/lib/readiness/service";
import { getTripBudget } from "@/lib/budget/service";
import { deriveTimeline, type TimelineStage } from "./timeline";
import type { TravelerRow, TripRow } from "@/lib/supabase/types";
import type { Readiness } from "@/lib/readiness/engine";
import type { TripBudget } from "@/lib/budget/service";
import type { CountryGuide } from "@/lib/country/service";

/**
 * The dashboard's composition layer.
 *
 * It calls each engine and arranges the results. It computes nothing itself —
 * no readiness rule, no cost figure, no freshness judgement is re-derived
 * here. That is the cross-engine rule from the iteration standard: the
 * dashboard *uses* the readiness engine, it does not calculate readiness.
 *
 * The only thing this layer decides is the timeline stage, and that is
 * derived from the other engines' outputs rather than from the rows.
 */

export interface TripOverview {
  trip: TripRow;
  destination: CountryGuide | null;
  readiness: Readiness;
  budget: TripBudget;
  timeline: TimelineStage[];
  travelerCount: number;
}

export interface Dashboard {
  trips: TripListItem[];
  /** Fully composed view of the trip the traveller is most likely working on. */
  focus: TripOverview | null;
}

/**
 * The trip to lead with: the next one departing, or the most recently created
 * when none has dates. Deterministic, so the dashboard does not reshuffle
 * itself between reloads.
 */
export function focusTrip(trips: TripListItem[]): TripListItem | null {
  if (trips.length === 0) return null;
  const dated = trips
    .filter((t) => t.depart_on !== null)
    .sort((a, b) => (a.depart_on ?? "").localeCompare(b.depart_on ?? ""));
  return dated[0] ?? trips[0];
}

export async function getDashboard(): Promise<Dashboard> {
  const trips = await listTrips();
  const focus = focusTrip(trips);
  if (!focus) return { trips, focus: null };

  const supabase = await createClient();
  const { data: travelers } = await supabase
    .from("travelers")
    .select("*")
    .eq("trip_id", focus.id);

  const travelerRows = (travelers ?? []) as TravelerRow[];

  // Each from the engine that owns it. Run together because none depends on
  // another's result — the composition is a fan-out, not a pipeline.
  const [destination, readiness, budget] = await Promise.all([
    getCountryGuide(focus.destination_country_key),
    getTripReadiness(focus, travelerRows),
    getTripBudget(focus),
  ]);

  return {
    trips,
    focus: {
      trip: focus,
      destination,
      readiness,
      budget,
      timeline: deriveTimeline({ trip: focus, readiness, budget }),
      travelerCount: travelerRows.length,
    },
  };
}
