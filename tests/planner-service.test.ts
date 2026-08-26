import { afterEach, describe, expect, it } from "vitest";
import {
  planTrip,
  plannerConfigured,
  setPlannerProvider,
} from "@/lib/planner/service";
import type { PlannerTools, TripPlan } from "@/lib/planner/contract";

const TOOLS: PlannerTools = {
  tripId: "trip-1",
  destinationName: "Nigeria",
  destinationVerified: false,
  figures: [
    { ref: "budget.planningTarget", value: 4820, currency: "USD", label: "Target" },
  ],
  facts: [{ ref: "readiness.next", statement: "Verify entry requirements." }],
};

const GOOD: TripPlan = {
  summary: "A plan for your homecoming.",
  steps: [
    {
      title: "Set your budget",
      body: "Work towards the planning target.",
      figureRefs: ["budget.planningTarget"],
      factRefs: ["readiness.next"],
    },
  ],
  toolsVersion: "unset",
};

afterEach(() => setPlannerProvider(null));

describe("planner orchestration", () => {
  it("reports unavailable rather than inventing a plan", () => {
    // The honest state for this project right now: no model provider exists.
    // A stub returning a hand-written plan would make the iteration look
    // finished and prove nothing.
    expect(plannerConfigured()).toBe(false);
  });

  it("says the other engines are unaffected", async () => {
    const outcome = await planTrip(TOOLS);
    expect(outcome.status).toBe("unavailable");
    if (outcome.status !== "unavailable") return;
    expect(outcome.reason).toMatch(/unaffected/i);
  });

  it("returns a verified plan when a provider produces a clean one", async () => {
    setPlannerProvider({ generate: async () => GOOD });
    const outcome = await planTrip(TOOLS);
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.plan.toolsVersion).toMatch(/planner-contract/);
  });

  it("rejects a plan carrying an invented figure", async () => {
    setPlannerProvider({
      generate: async () => ({
        ...GOOD,
        summary: "Flights are around $1,450 return.",
      }),
    });
    const outcome = await planTrip(TOOLS);
    expect(outcome.status).toBe("rejected");
    if (outcome.status !== "rejected") return;
    expect(outcome.violations[0].kind).toBe("unsourced_figure");
  });

  it("rejects a plan asserting a requirement for an unverified destination", async () => {
    setPlannerProvider({
      generate: async () => ({
        ...GOOD,
        summary: "You will need a visa before you fly.",
      }),
    });
    const outcome = await planTrip(TOOLS);
    expect(outcome.status).toBe("rejected");
  });

  it("does not fall back to showing a rejected plan", async () => {
    // The failure mode worth guarding: "show it with a warning" is how an
    // invented visa rule reaches a traveller anyway.
    setPlannerProvider({
      generate: async () => ({ ...GOOD, summary: "You must have 9999 dollars." }),
    });
    const outcome = await planTrip(TOOLS);
    expect(outcome.status).toBe("rejected");
    expect("plan" in outcome).toBe(false);
  });
});
