import { describe, expect, it } from "vitest";
import {
  deriveReadiness,
  type ReadinessInput,
} from "@/lib/readiness/engine";

const TODAY = "2026-06-01";

function input(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    departOn: "2026-12-18",
    returnOn: "2027-01-08",
    destinationName: "Nigeria",
    destinationVerified: false,
    travelers: [],
    documents: [],
    today: TODAY,
    ...overrides,
  };
}

const ama = { id: "t1", fullName: "Ama Mensah", passportExpiresOn: "2029-04-12" };

describe("readiness engine", () => {
  describe("what it refuses to claim", () => {
    it("never reports requirement satisfaction for an unverified destination", () => {
      const r = deriveReadiness(input({ travelers: [ama] }));
      expect(r.requirementsUnknown).toBe(true);
      const destination = r.items.find((i) => i.kind === "destination");
      expect(destination?.state).toBe("verify_required");
      expect(destination?.detail).toMatch(/not verified/i);
    });

    it("still says it is not the authority even when the guide is verified", () => {
      // A verified guide makes the information better sourced. It does not
      // make Take Me Home the authority on immigration.
      const r = deriveReadiness(
        input({ destinationVerified: true, travelers: [ama] }),
      );
      const destination = r.items.find((i) => i.kind === "destination");
      expect(destination?.state).toBe("verify_required");
      expect(destination?.detail).toMatch(/not the\s+authority/i);
    });

    it("does not call a valid passport 'ready to travel'", () => {
      // The distinction the whole engine rests on: we know the passport
      // covers the dates, not that it satisfies the destination.
      const r = deriveReadiness(input({ travelers: [ama] }));
      const passport = r.items.find((i) => i.id === "passport-t1");
      expect(passport?.state).toBe("ready");
      expect(passport?.title).toMatch(/recorded/i);
      expect(passport?.title).not.toMatch(/ready to travel/i);
      expect(passport?.detail).toMatch(/check the country guide/i);
    });

    it("states no validity rule of its own", () => {
      // "Six months beyond return" is a real rule in many places and an
      // invented one in others. This engine states neither.
      const r = deriveReadiness(input({ travelers: [ama] }));
      const text = r.items.map((i) => `${i.title} ${i.detail}`).join(" ");
      expect(text).not.toMatch(/six months|6 months|90 days beyond/i);
    });
  });

  describe("mechanical facts it may assert", () => {
    it("flags a passport that already expired", () => {
      const r = deriveReadiness(
        input({
          travelers: [{ ...ama, passportExpiresOn: "2026-01-01" }],
        }),
      );
      const passport = r.items.find((i) => i.id === "passport-t1");
      expect(passport?.state).toBe("action_needed");
      expect(passport?.detail).toMatch(/expired on 1 January 2026/);
    });

    it("flags a passport that expires during the trip", () => {
      // Two dates compared. Not a claim about policy.
      const r = deriveReadiness(
        input({
          travelers: [{ ...ama, passportExpiresOn: "2026-12-25" }],
        }),
      );
      const passport = r.items.find((i) => i.id === "passport-t1");
      expect(passport?.state).toBe("action_needed");
      expect(passport?.detail).toMatch(/before the trip ends/i);
    });

    it("uses departure when there is no return date", () => {
      const r = deriveReadiness(
        input({
          returnOn: null,
          travelers: [{ ...ama, passportExpiresOn: "2026-12-01" }],
        }),
      );
      expect(r.items.find((i) => i.id === "passport-t1")?.state).toBe(
        "action_needed",
      );
    });

    it("records a missing expiry as missing, not as a problem with the passport", () => {
      const r = deriveReadiness(
        input({ travelers: [{ ...ama, passportExpiresOn: null }] }),
      );
      const passport = r.items.find((i) => i.id === "passport-t1");
      expect(passport?.state).toBe("missing");
      expect(passport?.detail).toMatch(/cannot check it/i);
    });

    it("says nothing about passports when the trip has no dates", () => {
      const r = deriveReadiness(
        input({ departOn: null, returnOn: null, travelers: [ama] }),
      );
      // Nothing to compare against, so the record stands as recorded.
      expect(r.items.find((i) => i.id === "passport-t1")?.state).toBe("ready");
    });
  });

  describe("the figure it reports", () => {
    it("excludes unknowable items from the denominator", () => {
      // The destination item can never be 'ready', so counting it would cap
      // every trip below 100% for a reason the traveller cannot act on.
      const r = deriveReadiness(input({ travelers: [ama] }));
      expect(r.checkableCount).toBe(1);
      expect(r.readyCount).toBe(1);
      expect(r.percent).toBe(100);
      expect(r.requirementsUnknown).toBe(true);
    });

    it("returns null rather than a misleading number when nothing is checkable", () => {
      const r = deriveReadiness(input({ travelers: [] }));
      expect(r.checkableCount).toBe(0);
      expect(r.percent).toBeNull();
    });

    it("counts each state", () => {
      const r = deriveReadiness(
        input({
          travelers: [
            ama,
            { id: "t2", fullName: "Kofi", passportExpiresOn: null },
            { id: "t3", fullName: "Yaa", passportExpiresOn: "2026-01-01" },
          ],
        }),
      );
      expect(r.counts.ready).toBe(1);
      expect(r.counts.missing).toBe(1);
      expect(r.counts.action_needed).toBe(1);
      expect(r.counts.verify_required).toBe(1);
      expect(r.percent).toBe(33);
    });
  });

  describe("next action", () => {
    it("picks the expired passport over everything else", () => {
      const r = deriveReadiness(
        input({
          travelers: [
            ama,
            { id: "t2", fullName: "Kofi", passportExpiresOn: null },
            { id: "t3", fullName: "Yaa", passportExpiresOn: "2026-01-01" },
          ],
        }),
      );
      expect(r.nextAction?.travelerName).toBe("Yaa");
      expect(r.nextAction?.state).toBe("action_needed");
    });

    it("prefers verifying the destination over chasing a missing record", () => {
      // Knowing what a country requires changes which missing things matter,
      // so it is the more useful next step.
      const r = deriveReadiness(
        input({
          travelers: [{ id: "t2", fullName: "Kofi", passportExpiresOn: null }],
        }),
      );
      expect(r.nextAction?.kind).toBe("destination");
    });

    it("orders same-state items by nearest deadline", () => {
      const r = deriveReadiness(
        input({
          destinationName: null,
          travelers: [
            { id: "a", fullName: "A", passportExpiresOn: "2026-03-01" },
            { id: "b", fullName: "B", passportExpiresOn: "2026-01-01" },
          ],
        }),
      );
      expect(r.nextAction?.travelerName).toBe("B");
    });

    it("is null when everything checkable is ready and nothing needs verifying", () => {
      const r = deriveReadiness(
        input({ destinationName: null, travelers: [ama] }),
      );
      expect(r.nextAction).toBeNull();
    });
  });

  describe("documents the traveller recorded", () => {
    it("carries a recorded document through without overruling it", () => {
      // The engine has no basis to second-guess the user's own record.
      const r = deriveReadiness(
        input({
          travelers: [ama],
          documents: [
            {
              id: "d1",
              travelerId: "t1",
              kind: "visa",
              state: "upcoming",
              dueOn: "2026-10-01",
              note: "Appointment booked",
            },
          ],
        }),
      );
      const doc = r.items.find((i) => i.id === "document-d1");
      expect(doc?.state).toBe("upcoming");
      expect(doc?.title).toBe("Visa for Ama Mensah");
      expect(doc?.detail).toBe("Appointment booked");
    });

    it("recomputes when a document is added", () => {
      // Recompute-on-change, as a property: the engine is a pure function of
      // its inputs, so a changed input is a changed result by construction.
      const before = deriveReadiness(input({ travelers: [ama] }));
      const after = deriveReadiness(
        input({
          travelers: [ama],
          documents: [
            {
              id: "d1",
              travelerId: "t1",
              kind: "visa",
              state: "missing",
              dueOn: null,
              note: null,
            },
          ],
        }),
      );
      expect(before.counts.missing).toBe(0);
      expect(after.counts.missing).toBe(1);
      expect(before.percent).toBe(100);
      expect(after.percent).toBe(50);
      expect(after.items.length).toBe(before.items.length + 1);

      // nextAction does NOT move, and that is correct: verifying the
      // destination still outranks a missing visa. Asserted rather than
      // assumed, because the first version of this test expected it to change
      // and was wrong about the engine rather than finding a bug in it.
      expect(before.nextAction?.kind).toBe("destination");
      expect(after.nextAction?.kind).toBe("destination");
    });

    it("moves the next action once the more urgent item outranks it", () => {
      const before = deriveReadiness(input({ travelers: [ama] }));
      const after = deriveReadiness(
        input({
          travelers: [ama],
          documents: [
            {
              id: "d1",
              travelerId: "t1",
              kind: "visa",
              state: "action_needed",
              dueOn: "2026-09-01",
              note: "Refused — reapply",
            },
          ],
        }),
      );
      expect(before.nextAction?.kind).toBe("destination");
      expect(after.nextAction?.kind).toBe("visa");
    });

    it("is deterministic — same input, same output", () => {
      const once = deriveReadiness(input({ travelers: [ama] }));
      const twice = deriveReadiness(input({ travelers: [ama] }));
      expect(JSON.stringify(once)).toBe(JSON.stringify(twice));
    });
  });
});

describe("passport item copy", () => {
  /**
   * The exact wording of every passport branch, pinned locally.
   *
   * These strings were previously asserted only in the hosted browser suite,
   * where a mismatch costs a full run to discover and the test data decides
   * which branch is even reachable. The engine is pure, so the copy belongs
   * here — every branch checked on every commit, in milliseconds.
   *
   * The default trip runs to 2027-01-08, so "during the trip" means an expiry
   * after today and before that.
   */
  function titlesFor(passportExpiresOn: string | null): string[] {
    return deriveReadiness(
      input({ travelers: [{ ...ama, passportExpiresOn }] }),
    ).items.map((i) => i.title);
  }

  it("says what is missing when there is no expiry date", () => {
    expect(titlesFor(null)).toContain("Passport expiry for Ama Mensah");
  });

  it("says so when the passport has already expired", () => {
    expect(titlesFor("2020-01-01")).toContain(
      "Ama Mensah's passport has expired",
    );
  });

  it("says so when it expires during the trip", () => {
    expect(titlesFor("2026-12-20")).toContain(
      "Ama Mensah's passport expires during this trip",
    );
  });

  it("records it when it covers the whole trip", () => {
    expect(titlesFor("2030-01-01")).toContain(
      "Passport recorded for Ama Mensah",
    );
  });

  it("never calls a covering passport ready to travel", () => {
    // The engine checks arithmetic, not entry rules. Many destinations require
    // validity beyond the return date and it does not know which.
    const r = deriveReadiness(
      input({ travelers: [{ ...ama, passportExpiresOn: "2030-01-01" }] }),
    );
    const passport = r.items.find((i) => i.kind === "passport");
    expect(passport?.detail).not.toMatch(/ready to travel/i);
    expect(passport?.detail).toMatch(/check the country guide/i);
  });
});
