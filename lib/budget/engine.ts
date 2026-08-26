import type {
  AssumptionBasis,
  CostCategory,
  CostUnit,
} from "@/lib/supabase/types";

/**
 * The Cost Estimation Engine.
 *
 * Deterministic and pure. Every figure is arithmetic over rates that are
 * passed in — there is no clock, no database, no network, and above all no
 * model. The PRD is unambiguous about the last one: the LLM does not produce
 * cost figures. It may explain these numbers and surface the assumptions
 * behind them; it may not invent them.
 *
 * Traceability is the design goal. Each category in the output names the rate
 * that produced it, the quantity it was multiplied by, and whether that rate
 * was illustrative or sourced. Given an estimate and this module you can
 * re-derive every number by hand.
 *
 * `ENGINE_VERSION` is stamped on every estimate and persisted with it, so an
 * old figure can always be traced to the rules that generated it rather than
 * to whatever the rules say today.
 */
export const ENGINE_VERSION = "cost-engine/1.0.0";

export interface CostRate {
  category: CostCategory;
  unit: CostUnit;
  currency: string;
  amountLow: number;
  amountHigh: number;
  basis: AssumptionBasis;
  note: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
}

export interface BudgetInput {
  /** Travellers on the trip. A trip with none cannot be costed. */
  partySize: number | null;
  departOn: string | null;
  returnOn: string | null;
  /** Where they are staying, which zeroes accommodation when it is family. */
  accommodationTier: string | null;
  rates: CostRate[];
}

export interface CostLine {
  category: CostCategory;
  low: number;
  high: number;
  /** What the rate was multiplied by, and why — the audit trail. */
  basisOfCalculation: string;
  rateBasis: AssumptionBasis;
  note: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
}

export type Confidence = "low" | "medium" | "high";

export interface BudgetEstimate {
  currency: string;
  categories: CostLine[];
  estimateLow: number;
  estimateHigh: number;
  /**
   * The figure to budget against. The midpoint would be a coin flip; this sits
   * deliberately above it, because under-budgeting a homecoming is the failure
   * that strands someone.
   */
  planningTarget: number;
  assumptions: string[];
  confidence: Confidence;
  /** True when any line rests on an illustrative rate. */
  restsOnIllustrativeRates: boolean;
  engineVersion: string;
  /** Non-null when no estimate could be produced, saying what is missing. */
  unavailableReason: string | null;
}

/** Nights between two dates, or null. Same-day return is one night's costs. */
export function nightsBetween(
  departOn: string | null,
  returnOn: string | null,
): number | null {
  if (!departOn || !returnOn) return null;
  const from = Date.parse(`${departOn}T00:00:00Z`);
  const to = Date.parse(`${returnOn}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return null;
  return Math.max(1, Math.round((to - from) / 86_400_000));
}

const EMPTY: Omit<BudgetEstimate, "unavailableReason"> = {
  currency: "USD",
  categories: [],
  estimateLow: 0,
  estimateHigh: 0,
  planningTarget: 0,
  assumptions: [],
  confidence: "low",
  restsOnIllustrativeRates: false,
  engineVersion: ENGINE_VERSION,
};

export function estimateBudget(input: BudgetInput): BudgetEstimate {
  const nights = nightsBetween(input.departOn, input.returnOn);
  const party = input.partySize;

  // Refuses rather than guesses. A default party size of 1 would produce a
  // confident-looking number for a trip nobody described.
  if (!party || party < 1) {
    return {
      ...EMPTY,
      unavailableReason:
        "Add how many people are travelling and we can estimate the cost.",
    };
  }
  if (input.rates.length === 0) {
    return {
      ...EMPTY,
      unavailableReason: "We have no cost assumptions for this destination yet.",
    };
  }

  const currency = input.rates[0].currency;
  const stayingWithFamily = input.accommodationTier === "staying_with_family";

  const assumptions: string[] = [
    `${party} ${party === 1 ? "traveller" : "travellers"}.`,
    nights
      ? `${nights} ${nights === 1 ? "night" : "nights"}, from the trip's dates.`
      : "No dates set, so nightly costs are not included.",
  ];

  if (stayingWithFamily) {
    assumptions.push("Staying with family, so no accommodation cost.");
  }

  const lines: CostLine[] = [];
  let subtotalLow = 0;
  let subtotalHigh = 0;

  // Percentage rates apply to everything else, so they are held back and
  // applied after the subtotal is known.
  const percentRates = input.rates.filter(
    (r) => r.unit === "percent_of_subtotal",
  );
  const absoluteRates = input.rates.filter(
    (r) => r.unit !== "percent_of_subtotal",
  );

  for (const rate of absoluteRates) {
    if (rate.category === "accommodation" && stayingWithFamily) continue;

    const quantity = quantityFor(rate.unit, party, nights);
    // A nightly rate on a trip with no dates has no quantity to multiply, and
    // inventing one would put a number on screen the traveller never implied.
    if (quantity === null) continue;

    const low = round(rate.amountLow * quantity);
    const high = round(rate.amountHigh * quantity);
    subtotalLow += low;
    subtotalHigh += high;

    lines.push({
      category: rate.category,
      low,
      high,
      basisOfCalculation: describeQuantity(rate.unit, party, nights),
      rateBasis: rate.basis,
      note: rate.note,
      sourceName: rate.sourceName,
      sourceUrl: rate.sourceUrl,
    });
  }

  for (const rate of percentRates) {
    const low = round((subtotalLow * rate.amountLow) / 100);
    const high = round((subtotalHigh * rate.amountHigh) / 100);
    lines.push({
      category: rate.category,
      low,
      high,
      basisOfCalculation: `${rate.amountLow}–${rate.amountHigh}% of everything above`,
      rateBasis: rate.basis,
      note: rate.note,
      sourceName: rate.sourceName,
      sourceUrl: rate.sourceUrl,
    });
    subtotalLow += low;
    subtotalHigh += high;
  }

  const restsOnIllustrativeRates = lines.some(
    (l) => l.rateBasis === "illustrative",
  );
  if (restsOnIllustrativeRates) {
    assumptions.push(
      "Some rates are illustrative planning placeholders, not researched " +
        "prices. Treat the range as a starting point.",
    );
  }

  return {
    currency,
    categories: lines,
    estimateLow: round(subtotalLow),
    estimateHigh: round(subtotalHigh),
    planningTarget: planningTarget(subtotalLow, subtotalHigh),
    assumptions,
    confidence: confidenceFor(input, nights, restsOnIllustrativeRates),
    restsOnIllustrativeRates,
    engineVersion: ENGINE_VERSION,
    unavailableReason: null,
  };
}

/**
 * Three quarters of the way up the range, not the midpoint.
 *
 * The two failure modes are not symmetric: over-budgeting means money left
 * over, under-budgeting means being short in another country. This leans
 * towards the first.
 */
function planningTarget(low: number, high: number): number {
  return round(low + (high - low) * 0.75);
}

function quantityFor(
  unit: CostUnit,
  party: number,
  nights: number | null,
): number | null {
  switch (unit) {
    case "per_person_per_trip":
      return party;
    case "per_trip":
      return 1;
    case "per_person_per_night":
      return nights === null ? null : party * nights;
    case "percent_of_subtotal":
      return null;
  }
}

function describeQuantity(
  unit: CostUnit,
  party: number,
  nights: number | null,
): string {
  switch (unit) {
    case "per_person_per_trip":
      return `per person × ${party}`;
    case "per_trip":
      return "once per trip";
    case "per_person_per_night":
      return `per person per night × ${party} × ${nights}`;
    case "percent_of_subtotal":
      return "percentage of the subtotal";
  }
}

/**
 * Driven by how much the traveller has specified, and by whether the rates
 * behind the figure are sourced.
 *
 * An estimate built entirely on illustrative placeholders is never `high`,
 * however completely the trip is described — the arithmetic being certain does
 * not make the inputs so.
 */
function confidenceFor(
  input: BudgetInput,
  nights: number | null,
  illustrative: boolean,
): Confidence {
  let specified = 0;
  if (input.partySize) specified += 1;
  if (nights !== null) specified += 1;
  if (input.accommodationTier) specified += 1;

  if (illustrative) return specified >= 3 ? "medium" : "low";
  if (specified >= 3) return "high";
  if (specified === 2) return "medium";
  return "low";
}

/** Whole units. Cents are noise at planning altitude and invite false precision. */
function round(value: number): number {
  return Math.round(value);
}
