import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { CostAssumptionRow, TripRow } from "@/lib/supabase/types";
import {
  ENGINE_VERSION,
  estimateBudget,
  nightsBetween,
  type BudgetEstimate,
  type CostRate,
} from "./engine";

/**
 * Assembles the engine's inputs and persists what it produced.
 *
 * The estimate is recomputed on read and *also* written to `cost_estimates`,
 * which looks redundant until you ask what the saved row is for: it is the
 * record of what the traveller was shown, stamped with the engine version that
 * produced it. When the rules change, an old figure still traces to the rules
 * that generated it. The screen always shows a fresh computation.
 */

/**
 * Rates for a destination: the country's own where it has them, the defaults
 * otherwise. A country-specific row overrides the default for its category.
 */
export async function ratesForCountry(
  countryKey: string | null,
): Promise<CostRate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cost_assumptions")
    .select("*")
    .or(countryKey ? `country_key.is.null,country_key.eq.${countryKey}` : "country_key.is.null");

  if (error) throw new Error(`Could not load cost assumptions: ${error.message}`);

  const rows = (data ?? []) as CostAssumptionRow[];

  // Country-specific wins. Reduced into a map keyed by category so the
  // override is explicit rather than depending on row order.
  const byCategory = new Map<string, CostAssumptionRow>();
  for (const row of rows) {
    const existing = byCategory.get(row.category);
    if (!existing || (row.country_key !== null && existing.country_key === null)) {
      byCategory.set(row.category, row);
    }
  }

  return [...byCategory.values()].map((row) => ({
    category: row.category,
    unit: row.unit,
    currency: row.currency,
    amountLow: Number(row.amount_low),
    amountHigh: Number(row.amount_high),
    basis: row.basis,
    note: row.note,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
  }));
}

export interface SavingsPlan {
  targetAmount: number;
  amountSaved: number;
  amountRemaining: number;
  monthsRemaining: number | null;
  monthlyTarget: number | null;
}

export interface TripBudget {
  estimate: BudgetEstimate;
  savings: SavingsPlan | null;
  nights: number | null;
}

export async function getTripBudget(trip: TripRow): Promise<TripBudget> {
  const rates = await ratesForCountry(trip.destination_country_key);

  const estimate = estimateBudget({
    partySize: trip.party_size,
    departOn: trip.depart_on,
    returnOn: trip.return_on,
    accommodationTier: trip.accommodation_tier,
    rates,
  });

  const savings = estimate.unavailableReason
    ? null
    : await savingsFor(trip, estimate);

  if (!estimate.unavailableReason) await persist(trip, estimate);

  return {
    estimate,
    savings,
    nights: nightsBetween(trip.depart_on, trip.return_on),
  };
}

async function savingsFor(
  trip: TripRow,
  estimate: BudgetEstimate,
): Promise<SavingsPlan> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("savings_plans")
    .select("*")
    .eq("trip_id", trip.id)
    .maybeSingle();

  const amountSaved = data ? Number(data.amount_saved) : 0;
  const targetAmount = estimate.planningTarget;
  const amountRemaining = Math.max(0, targetAmount - amountSaved);

  const monthsRemaining = monthsUntil(trip.depart_on);
  return {
    targetAmount,
    amountSaved,
    amountRemaining,
    monthsRemaining,
    // Undefined rather than infinity when the trip is imminent: "save
    // £4,000/month" for a trip in nine days is not a plan.
    monthlyTarget:
      monthsRemaining && monthsRemaining > 0
        ? Math.round(amountRemaining / monthsRemaining)
        : null,
  };
}

function monthsUntil(departOn: string | null): number | null {
  if (!departOn) return null;
  const depart = Date.parse(`${departOn}T00:00:00Z`);
  if (Number.isNaN(depart)) return null;
  const days = Math.floor((depart - Date.now()) / 86_400_000);
  if (days <= 0) return null;
  return Math.max(1, Math.round(days / 30));
}

/**
 * Writes the estimate as a record of what was shown.
 *
 * Best-effort on purpose: a failure to record history must not stop the
 * traveller seeing their budget. The figure on screen came from the engine
 * either way.
 */
async function persist(trip: TripRow, estimate: BudgetEstimate): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.from("cost_estimates").insert({
      trip_id: trip.id,
      user_id: trip.user_id,
      currency: estimate.currency,
      estimate_low: estimate.estimateLow,
      estimate_high: estimate.estimateHigh,
      planning_target: estimate.planningTarget,
      categories: estimate.categories,
      assumptions: estimate.assumptions,
      confidence: estimate.confidence,
      engine_version: ENGINE_VERSION,
    });
  } catch {
    // Deliberately swallowed. See above.
  }
}
