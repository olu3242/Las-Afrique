import { describe, expect, it } from "vitest";
import { verifyPlan } from "@/lib/planner/verify";
import type { PlannerTools, TripPlan } from "@/lib/planner/contract";

function tools(over: Partial<PlannerTools> = {}): PlannerTools {
  return {
    tripId: "trip-1",
    destinationName: "Nigeria",
    destinationVerified: false,
    figures: [
      {
        ref: "budget.planningTarget",
        value: 4820,
        currency: "USD",
        label: "Planning target",
      },
      { ref: "budget.low", value: 3600, currency: "USD", label: "Low" },
    ],
    facts: [
      { ref: "readiness.next", statement: "Verify entry requirements first." },
    ],
    ...over,
  };
}

function plan(over: Partial<TripPlan> = {}): TripPlan {
  return {
    summary: "A plan for your homecoming.",
    steps: [
      {
        title: "Set your budget",
        body: "Aim for the planning target below.",
        figureRefs: ["budget.planningTarget"],
        factRefs: [],
      },
    ],
    toolsVersion: "v1",
    ...over,
  };
}

describe("plan verification", () => {
  it("accepts a plan that only references what the engines produced", () => {
    expect(verifyPlan(plan(), tools()).ok).toBe(true);
  });

  it("accepts a figure quoted in prose when it matches a tool value exactly", () => {
    const result = verifyPlan(
      plan({ summary: "Budget around 4820 for this trip." }),
      tools(),
    );
    expect(result.ok).toBe(true);
  });

  describe("invented figures", () => {
    it("rejects a number no engine produced", () => {
      // The case this whole guard exists for: a model will produce a fluent,
      // plausible airfare unprompted.
      const result = verifyPlan(
        plan({ summary: "Flights are about $1,450 return." }),
        tools(),
      );
      expect(result.ok).toBe(false);
      expect(result.violations[0].kind).toBe("unsourced_figure");
      expect(result.violations[0].detail).toMatch(/1450/);
    });

    it("catches a figure formatted with separators", () => {
      // "1,450" must not slip through as the numbers 1 and 450.
      const result = verifyPlan(
        plan({ summary: "Set aside 12,300 dollars." }),
        tools(),
      );
      expect(result.ok).toBe(false);
      expect(result.violations[0].detail).toMatch(/12300/);
    });

    it("catches an invented figure in a step body, not just the summary", () => {
      const result = verifyPlan(
        plan({
          steps: [
            {
              title: "Book flights",
              body: "Expect to pay 980 per person.",
              figureRefs: [],
              factRefs: [],
            },
          ],
        }),
        tools(),
      );
      expect(result.ok).toBe(false);
      expect(result.violations[0].kind).toBe("unsourced_figure");
    });

    it("allows ordinary small numbers so prose stays readable", () => {
      const result = verifyPlan(
        plan({ summary: "3 travellers, 2 weeks, 4 things to sort out." }),
        tools(),
      );
      expect(result.ok).toBe(true);
    });

    it("rejects a figure that is close but not exact", () => {
      // "About 4,800" against a target of 4,820 is the subtle failure: it
      // reads as the engine's number and is not.
      const result = verifyPlan(
        plan({ summary: "Budget about 4800." }),
        tools(),
      );
      expect(result.ok).toBe(false);
    });
  });

  describe("fabricated citations", () => {
    it("rejects a reference to a figure that does not exist", () => {
      const result = verifyPlan(
        plan({
          steps: [
            {
              title: "Flights",
              body: "See below.",
              figureRefs: ["budget.flights.exact"],
              factRefs: [],
            },
          ],
        }),
        tools(),
      );
      expect(result.ok).toBe(false);
      expect(result.violations[0].kind).toBe("unknown_ref");
    });

    it("rejects a reference to a fact that does not exist", () => {
      const result = verifyPlan(
        plan({
          steps: [
            {
              title: "Documents",
              body: "See below.",
              figureRefs: [],
              factRefs: ["country.visaFree"],
            },
          ],
        }),
        tools(),
      );
      expect(result.ok).toBe(false);
      expect(result.violations[0].kind).toBe("unknown_ref");
    });
  });

  describe("requirements for an unverified destination", () => {
    it.each([
      "You will need a visa for this trip.",
      "A return ticket is required.",
      "Nigeria is visa-free for most travellers.",
      "You must have six months of passport validity.",
    ])("rejects %s", (sentence) => {
      // The failure the PRD singles out: a hallucinated visa requirement makes
      // someone miss a flight, or worse.
      const result = verifyPlan(plan({ summary: sentence }), tools());
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.kind === "unverified_requirement")).toBe(
        true,
      );
    });

    it("allows process language that asserts nothing", () => {
      const result = verifyPlan(
        plan({
          summary:
            "Check the country guide for entry rules, then book once you know them.",
        }),
        tools(),
      );
      expect(result.ok).toBe(true);
    });

    it("permits requirement language once the destination is verified", () => {
      const result = verifyPlan(
        plan({ summary: "A return ticket is required." }),
        tools({ destinationVerified: true }),
      );
      expect(result.ok).toBe(true);
    });
  });

  it("reports every violation, not only the first", () => {
    // A plan that broke the contract twice tells you more than one that
    // broke it once.
    const result = verifyPlan(
      plan({
        summary: "Flights cost 1450 and you will need a visa.",
        steps: [
          {
            title: "Go",
            body: "Set aside 9999.",
            figureRefs: ["nope"],
            factRefs: [],
          },
        ],
      }),
      tools(),
    );
    expect(result.violations.length).toBeGreaterThanOrEqual(4);
    expect(new Set(result.violations.map((v) => v.kind))).toEqual(
      new Set(["unsourced_figure", "unverified_requirement", "unknown_ref"]),
    );
  });
});
