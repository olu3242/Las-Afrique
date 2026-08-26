import { describe, expect, it } from "vitest";
import {
  AGING_THROUGH_DAYS,
  FRESH_THROUGH_DAYS,
  deriveFreshness,
} from "@/lib/country/freshness";

const NOW = new Date("2026-06-01T12:00:00Z");

/** A date exactly `days` before NOW. */
function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

describe("country guide freshness", () => {
  it("treats an unverified country as carrying no requirements", () => {
    const f = deriveFreshness("unverified", null, NOW);
    expect(f.state).toBe("unverified");
    expect(f.showsRequirements).toBe(false);
    expect(f.detail).toMatch(/official source/i);
  });

  it("stays unverified even when a date is present", () => {
    // 0007 permits a date without a verified state. A date alone is not
    // verification, and reading it as one is how an unchecked guide starts
    // claiming it was checked.
    const f = deriveFreshness("unverified", daysAgo(1), NOW);
    expect(f.state).toBe("unverified");
    expect(f.showsRequirements).toBe(false);
  });

  it("treats a stale verification state as unverified", () => {
    const f = deriveFreshness("stale", daysAgo(1), NOW);
    expect(f.state).toBe("unverified");
  });

  it("treats a verified country with no date as unverified", () => {
    const f = deriveFreshness("verified", null, NOW);
    expect(f.state).toBe("unverified");
    expect(f.showsRequirements).toBe(false);
  });

  it("falls back to unverified on a date it cannot read", () => {
    // Failing towards saying less is the only safe direction here.
    const f = deriveFreshness("verified", "not a date", NOW);
    expect(f.state).toBe("unverified");
    expect(f.showsRequirements).toBe(false);
  });

  it.each([
    [0, "fresh"],
    [1, "fresh"],
    [FRESH_THROUGH_DAYS, "fresh"],
    [FRESH_THROUGH_DAYS + 1, "aging"],
    [AGING_THROUGH_DAYS, "aging"],
    [AGING_THROUGH_DAYS + 1, "stale"],
    [400, "stale"],
  ])("is %s days old -> %s", (days, expected) => {
    expect(deriveFreshness("verified", daysAgo(days), NOW).state).toBe(expected);
  });

  it("still shows requirements when stale, with a warning", () => {
    // Hiding a stale guide would leave the traveller with nothing at all. The
    // honest move is to show it and say plainly not to rely on it.
    const f = deriveFreshness("verified", daysAgo(400), NOW);
    expect(f.showsRequirements).toBe(true);
    expect(f.detail).toMatch(/would not rely on it/i);
  });

  it("never conveys state by colour alone", () => {
    // Every state pairs a glyph with a text label, per the accessibility rule.
    for (const [state, date] of [
      ["unverified", null],
      ["verified", daysAgo(1)],
      ["verified", daysAgo(60)],
      ["verified", daysAgo(400)],
    ] as const) {
      const f = deriveFreshness(state, date, NOW);
      expect(f.glyph.length, `${state} glyph`).toBeGreaterThan(0);
      expect(f.label.length, `${state} label`).toBeGreaterThan(0);
      expect(f.detail.length, `${state} detail`).toBeGreaterThan(0);
    }
  });

  it("always tells the traveller to verify, however fresh", () => {
    // The PRD's constraint: Take Me Home surfaces requirements, it is not the
    // authority on them. Checked an hour ago does not change that.
    const f = deriveFreshness("verified", daysAgo(0), NOW);
    expect(f.detail).toMatch(/verify before you travel/i);
  });

  it("clamps a future date to zero rather than reporting negative age", () => {
    // 0007 refuses to store one, but a clock skew between app and database
    // should not produce "checked -1 days ago".
    const future = new Date(NOW.getTime() + 86_400_000).toISOString();
    const f = deriveFreshness("verified", future, NOW);
    expect(f.ageInDays).toBe(0);
    expect(f.state).toBe("fresh");
  });

  it.each([
    [0, /today/i],
    [1, /yesterday/i],
    [5, /5 days ago/i],
    [45, /a month ago/i],
    [200, /months ago/i],
    [400, /over a year ago/i],
  ])("describes an age of %s days readably", (days, pattern) => {
    expect(deriveFreshness("verified", daysAgo(days), NOW).label).toMatch(
      pattern,
    );
  });
});
