import { describe, expect, it } from "vitest";
import { deriveTimeline, type TimelineInput } from "@/lib/dashboard/timeline";
import { focusTrip } from "@/lib/dashboard/service";
import type { Readiness } from "@/lib/readiness/engine";
import type { TripListItem } from "@/lib/trips/service";

function readiness(over: Partial<Readiness> = {}): Readiness {
  return {
    items: [],
    counts: {
      ready: 0,
      action_needed: 0,
      upcoming: 0,
      missing: 0,
      expiring: 0,
      verify_required: 0,
    },
    checkableCount: 0,
    readyCount: 0,
    percent: null,
    nextAction: null,
    requirementsUnknown: false,
    ...over,
  };
}

function input(over: Partial<TimelineInput> = {}): TimelineInput {
  return {
    trip: {
      id: "t1",
      user_id: "u1",
      origin_country: null,
      origin_city: null,
      destination_country_key: "nigeria",
      destination_city: "Lagos",
      depart_on: "2027-12-18",
      return_on: "2028-01-08",
      purpose: "homecoming",
      party_size: 2,
      accommodation_tier: "midrange",
      status: "planning",
      created_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-01T00:00:00Z",
    },
    readiness: readiness(),
    budget: {
      estimate: {
        currency: "USD",
        categories: [],
        estimateLow: 0,
        estimateHigh: 0,
        planningTarget: 0,
        assumptions: [],
        confidence: "low",
        restsOnIllustrativeRates: true,
        engineVersion: "test",
        unavailableReason: null,
      },
      savings: null,
      nights: 21,
    },
    ...over,
  };
}

function stage(t: ReturnType<typeof deriveTimeline>, id: string) {
  return t.find((s) => s.id === id);
}

describe("dashboard timeline", () => {
  it("marks planning done once destination, dates and party are set", () => {
    expect(stage(deriveTimeline(input()), "plan")?.status).toBe("done");
  });

  it("keeps planning current while anything is missing", () => {
    const t = deriveTimeline(
      input({ trip: { ...input().trip, party_size: null } }),
    );
    expect(stage(t, "plan")?.status).toBe("current");
    expect(stage(t, "plan")?.detail).toMatch(/how many are travelling/i);
  });

  it("never calls preparation done while requirements are unknown", () => {
    // The decay this project refuses: unknown must not become done.
    const t = deriveTimeline(
      input({ readiness: readiness({ requirementsUnknown: true }) }),
    );
    expect(stage(t, "prepare")?.status).toBe("current");
  });

  it("never calls preparation done while something is outstanding", () => {
    const t = deriveTimeline(
      input({
        readiness: readiness({
          counts: {
            ready: 1,
            action_needed: 1,
            upcoming: 0,
            missing: 0,
            expiring: 0,
            verify_required: 0,
          },
          nextAction: {
            id: "x",
            travelerId: null,
            travelerName: null,
            kind: "passport",
            state: "action_needed",
            title: "Renew a passport",
            detail: "It expired.",
            dueOn: null,
          },
        }),
      }),
    );
    expect(stage(t, "prepare")?.status).toBe("current");
    // Surfaces the readiness engine's own next action rather than inventing one.
    expect(stage(t, "prepare")?.detail).toBe("Renew a passport");
  });

  it("marks preparation done when nothing is outstanding and requirements are known", () => {
    const t = deriveTimeline(input());
    expect(stage(t, "prepare")?.status).toBe("done");
  });

  it("shows exactly one current stage", () => {
    // Two "you are here" markers on the route motif is worse than none.
    const t = deriveTimeline(
      input({
        trip: { ...input().trip, party_size: null },
        readiness: readiness({ requirementsUnknown: true }),
      }),
    );
    expect(t.filter((s) => s.status === "current")).toHaveLength(1);
    expect(stage(t, "plan")?.status).toBe("current");
  });

  it("reports the budget's own reason when it cannot estimate", () => {
    const base = input();
    const t = deriveTimeline({
      ...base,
      budget: {
        ...base.budget,
        estimate: {
          ...base.budget.estimate,
          unavailableReason: "Add how many people are travelling.",
        },
      },
    });
    expect(stage(t, "budget")?.status).toBe("todo");
    expect(stage(t, "budget")?.detail).toMatch(/how many people/i);
  });

  it("marks departure done only once it has passed", () => {
    const past = deriveTimeline(
      input({ trip: { ...input().trip, depart_on: "2020-01-01" } }),
    );
    expect(stage(past, "go-home")?.status).toBe("done");
    expect(stage(deriveTimeline(input()), "go-home")?.status).toBe("todo");
  });

  it("is deterministic", () => {
    expect(JSON.stringify(deriveTimeline(input()))).toBe(
      JSON.stringify(deriveTimeline(input())),
    );
  });
});

describe("which trip the dashboard leads with", () => {
  function trip(id: string, departOn: string | null): TripListItem {
    return {
      ...input().trip,
      id,
      depart_on: departOn,
      destination_name: "Nigeria",
      traveler_count: 0,
    };
  }

  it("returns null with no trips", () => {
    expect(focusTrip([])).toBeNull();
  });

  it("leads with the next departure, not the newest trip", () => {
    const focus = focusTrip([
      trip("newest", "2028-06-01"),
      trip("soonest", "2027-01-01"),
    ]);
    expect(focus?.id).toBe("soonest");
  });

  it("falls back to the first trip when none has dates", () => {
    expect(focusTrip([trip("a", null), trip("b", null)])?.id).toBe("a");
  });

  it("prefers a dated trip over an undated one", () => {
    expect(focusTrip([trip("undated", null), trip("dated", "2027-01-01")])?.id).toBe(
      "dated",
    );
  });

  it("is stable across calls, so the dashboard does not reshuffle", () => {
    const trips = [trip("a", "2027-05-01"), trip("b", "2027-05-01")];
    expect(focusTrip(trips)?.id).toBe(focusTrip(trips)?.id);
  });
});
