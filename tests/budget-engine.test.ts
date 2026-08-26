import { describe, expect, it } from "vitest";
import {
  ENGINE_VERSION,
  estimateBudget,
  nightsBetween,
  type BudgetInput,
  type CostRate,
} from "@/lib/budget/engine";

function rate(over: Partial<CostRate> = {}): CostRate {
  return {
    category: "flights",
    unit: "per_person_per_trip",
    currency: "USD",
    amountLow: 100,
    amountHigh: 200,
    basis: "illustrative",
    note: null,
    sourceName: null,
    sourceUrl: null,
    ...over,
  };
}

function input(over: Partial<BudgetInput> = {}): BudgetInput {
  return {
    partySize: 2,
    departOn: "2026-12-18",
    returnOn: "2026-12-28",
    accommodationTier: "midrange",
    rates: [rate()],
    ...over,
  };
}

describe("cost estimation engine", () => {
  describe("what it refuses to do", () => {
    it("declines rather than assuming a party size", () => {
      // A default of 1 would put a confident-looking number on screen for a
      // trip nobody described.
      const e = estimateBudget(input({ partySize: null }));
      expect(e.unavailableReason).toMatch(/how many people/i);
      expect(e.estimateHigh).toBe(0);
      expect(e.categories).toEqual([]);
    });

    it("declines when it has no rates", () => {
      const e = estimateBudget(input({ rates: [] }));
      expect(e.unavailableReason).toMatch(/no cost assumptions/i);
    });

    it("omits nightly costs rather than inventing a trip length", () => {
      const e = estimateBudget(
        input({
          departOn: null,
          returnOn: null,
          rates: [rate({ category: "food", unit: "per_person_per_night" })],
        }),
      );
      expect(e.categories).toEqual([]);
      expect(e.assumptions.join(" ")).toMatch(/no dates set/i);
    });

    it("never reports high confidence on illustrative rates alone", () => {
      // The arithmetic being certain does not make the inputs so.
      const e = estimateBudget(input());
      expect(e.restsOnIllustrativeRates).toBe(true);
      expect(e.confidence).not.toBe("high");
    });

    it("says out loud that it rests on placeholders", () => {
      const e = estimateBudget(input());
      expect(e.assumptions.join(" ")).toMatch(/illustrative planning placeholders/i);
    });
  });

  describe("arithmetic anyone can redo by hand", () => {
    it("multiplies a per-person rate by the party", () => {
      const e = estimateBudget(input({ partySize: 3 }));
      expect(e.categories[0].low).toBe(300);
      expect(e.categories[0].high).toBe(600);
      expect(e.categories[0].basisOfCalculation).toBe("per person × 3");
    });

    it("multiplies a nightly rate by party and nights", () => {
      const e = estimateBudget(
        input({
          partySize: 2,
          departOn: "2026-12-18",
          returnOn: "2026-12-28",
          rates: [
            rate({
              category: "food",
              unit: "per_person_per_night",
              amountLow: 10,
              amountHigh: 20,
            }),
          ],
        }),
      );
      // 10 nights × 2 travellers.
      expect(e.categories[0].low).toBe(200);
      expect(e.categories[0].high).toBe(400);
      expect(e.categories[0].basisOfCalculation).toBe(
        "per person per night × 2 × 10",
      );
    });

    it("applies a percentage to the subtotal, not to itself", () => {
      const e = estimateBudget(
        input({
          partySize: 1,
          rates: [
            rate({ amountLow: 100, amountHigh: 200 }),
            rate({
              category: "contingency",
              unit: "percent_of_subtotal",
              amountLow: 10,
              amountHigh: 10,
            }),
          ],
        }),
      );
      const contingency = e.categories.find((c) => c.category === "contingency");
      expect(contingency?.low).toBe(10);
      expect(contingency?.high).toBe(20);
      expect(e.estimateLow).toBe(110);
      expect(e.estimateHigh).toBe(220);
    });

    it("drops accommodation when staying with family", () => {
      const e = estimateBudget(
        input({
          accommodationTier: "staying_with_family",
          rates: [rate({ category: "accommodation", unit: "per_person_per_night" })],
        }),
      );
      expect(e.categories).toEqual([]);
      expect(e.assumptions.join(" ")).toMatch(/no accommodation cost/i);
    });

    it("puts the planning target above the midpoint", () => {
      // Over-budgeting leaves money spare; under-budgeting strands someone in
      // another country. The two are not symmetric.
      const e = estimateBudget(input({ partySize: 1 }));
      const midpoint = (e.estimateLow + e.estimateHigh) / 2;
      expect(e.planningTarget).toBeGreaterThan(midpoint);
      expect(e.planningTarget).toBeLessThanOrEqual(e.estimateHigh);
    });

    it("keeps every line traceable to its rate", () => {
      const e = estimateBudget(
        input({
          rates: [
            rate({
              basis: "verified",
              sourceName: "Airline fare survey",
              sourceUrl: "https://example.org/fares",
              note: "Return economy",
            }),
          ],
        }),
      );
      const line = e.categories[0];
      expect(line.rateBasis).toBe("verified");
      expect(line.sourceName).toBe("Airline fare survey");
      expect(line.note).toBe("Return economy");
      expect(e.restsOnIllustrativeRates).toBe(false);
    });

    it("stamps the engine version on every estimate", () => {
      // So an old figure traces to the rules that produced it, not to
      // whatever the rules say today.
      expect(estimateBudget(input()).engineVersion).toBe(ENGINE_VERSION);
    });

    it("is deterministic", () => {
      const a = estimateBudget(input());
      const b = estimateBudget(input());
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });
  });

  describe("confidence", () => {
    it("rises with what the traveller specified", () => {
      const sparse = estimateBudget(
        input({ departOn: null, returnOn: null, accommodationTier: null }),
      );
      const full = estimateBudget(input());
      expect(sparse.confidence).toBe("low");
      expect(full.confidence).toBe("medium");
    });

    it("reaches high only on sourced rates and a fully described trip", () => {
      const e = estimateBudget(
        input({ rates: [rate({ basis: "verified" })] }),
      );
      expect(e.confidence).toBe("high");
    });
  });

  describe("nightsBetween", () => {
    it.each([
      ["2026-12-18", "2026-12-28", 10],
      ["2026-12-18", "2026-12-19", 1],
      // Same day out and back still incurs a day's costs.
      ["2026-12-18", "2026-12-18", 1],
    ])("%s to %s is %s nights", (from, to, expected) => {
      expect(nightsBetween(from, to)).toBe(expected);
    });

    it.each([
      [null, "2026-12-28"],
      ["2026-12-18", null],
      // Return before departure is not a trip length.
      ["2026-12-28", "2026-12-18"],
      ["nonsense", "2026-12-28"],
    ])("returns null for %s / %s", (from, to) => {
      expect(nightsBetween(from, to)).toBeNull();
    });
  });
});
