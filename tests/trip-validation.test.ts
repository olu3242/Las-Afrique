import { describe, expect, it } from "vitest";
import {
  MAX_PARTY_SIZE,
  MAX_YEARS_AHEAD,
  validateTravelerInput,
  validateTripInput,
  type RawTripInput,
} from "@/lib/trips/validation";

const CONTEXT = {
  allowedCountryKeys: ["nigeria", "ghana", "kenya"],
  today: "2026-06-01",
};

/** A submission that should pass, so each case can vary one field. */
function submission(overrides: RawTripInput = {}): RawTripInput {
  return {
    destinationCountryKey: "nigeria",
    destinationCity: "Lagos",
    originCountry: "United Kingdom",
    originCity: "London",
    departOn: "2026-12-18",
    returnOn: "2027-01-08",
    purpose: "homecoming",
    partySize: "3",
    accommodationTier: "staying_with_family",
    ...overrides,
  };
}

describe("trip intake validation", () => {
  it("accepts a complete submission and returns typed values", () => {
    const result = validateTripInput(submission(), CONTEXT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toEqual({
      destinationCountryKey: "nigeria",
      destinationCity: "Lagos",
      originCountry: "United Kingdom",
      originCity: "London",
      departOn: "2026-12-18",
      returnOn: "2027-01-08",
      purpose: "homecoming",
      partySize: 3,
      accommodationTier: "staying_with_family",
    });
  });

  it("accepts a submission carrying only a destination", () => {
    // The intake form asks for one thing before it asks for anything else.
    // Requiring more than the destination would make the first step a wall.
    const result = validateTripInput(
      { destinationCountryKey: "ghana" },
      CONTEXT,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.departOn).toBeNull();
    expect(result.value.partySize).toBeNull();
  });

  it("requires a destination", () => {
    const result = validateTripInput(
      submission({ destinationCountryKey: "  " }),
      CONTEXT,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.destinationCountryKey).toBeTruthy();
  });

  it("refuses a destination the country service does not know", () => {
    // The column is a foreign key onto country_profiles, so this would fail at
    // the database anyway — as a constraint violation the user cannot read.
    const result = validateTripInput(
      submission({ destinationCountryKey: "atlantis" }),
      CONTEXT,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.destinationCountryKey).toMatch(/country guide/i);
  });

  it("rejects a departure date in the past", () => {
    const result = validateTripInput(
      submission({ departOn: "2026-05-31" }),
      CONTEXT,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.departOn).toMatch(/past/i);
  });

  it("accepts a departure date of today", () => {
    const result = validateTripInput(
      submission({ departOn: CONTEXT.today, returnOn: null }),
      CONTEXT,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a departure beyond the planning horizon", () => {
    const result = validateTripInput(
      submission({ departOn: `${2026 + MAX_YEARS_AHEAD + 1}-01-01`, returnOn: null }),
      CONTEXT,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.departOn).toBeTruthy();
  });

  it("rejects a return before departure", () => {
    const result = validateTripInput(
      submission({ departOn: "2026-12-18", returnOn: "2026-12-01" }),
      CONTEXT,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.returnOn).toMatch(/before the departure/i);
  });

  it("rejects a date that looks like one but is not", () => {
    const result = validateTripInput(
      submission({ departOn: "2027-02-30" }),
      CONTEXT,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.departOn).toBeTruthy();
  });

  it.each([["0"], ["-2"], ["3.5"], ["3 people"], [String(MAX_PARTY_SIZE + 1)]])(
    "rejects %s as a party size",
    (value) => {
      const result = validateTripInput(submission({ partySize: value }), CONTEXT);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.partySize).toBeTruthy();
    },
  );

  it("rejects a purpose outside the enum", () => {
    const result = validateTripInput(
      submission({ purpose: "vacation" }),
      CONTEXT,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.purpose).toBeTruthy();
  });

  it("rejects an accommodation tier outside the enum", () => {
    const result = validateTripInput(
      submission({ accommodationTier: "penthouse" }),
      CONTEXT,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.accommodationTier).toBeTruthy();
  });

  it("trims surrounding whitespace and treats blank as absent", () => {
    const result = validateTripInput(
      submission({ destinationCity: "  Lagos  ", originCity: "   " }),
      CONTEXT,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.destinationCity).toBe("Lagos");
    expect(result.value.originCity).toBeNull();
  });

  it("reports every bad field at once, not just the first", () => {
    // A form that surfaces one error per submission makes the user pay a round
    // trip per mistake.
    const result = validateTripInput(
      submission({ destinationCountryKey: "", partySize: "0", purpose: "nope" }),
      CONTEXT,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual([
      "destinationCountryKey",
      "partySize",
      "purpose",
    ]);
  });
});

describe("traveller validation", () => {
  it("accepts a full traveller record", () => {
    const result = validateTravelerInput(
      {
        fullName: "Ama Mensah",
        relationship: "Mother",
        passportLast4: "8f2c",
        passportExpiresOn: "2029-04-12",
      }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.fullName).toBe("Ama Mensah");
    // Stored uppercase so two spellings of one passport do not read as two.
    expect(result.value.passportLast4).toBe("8F2C");
  });

  it("requires a name", () => {
    const result = validateTravelerInput({ fullName: "   " });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.fullName).toBeTruthy();
  });

  it.each([["123"], ["12345"], ["12 4"], ["ab-c"]])(
    "rejects %s as passport last four",
    (value) => {
      const result = validateTravelerInput(
        { fullName: "Ama Mensah", passportLast4: value },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.passportLast4).toBeTruthy();
    },
  );

  it("records an already-expired passport rather than refusing it", () => {
    // Whether an expiry date is a problem depends on the destination's rules,
    // which live in the Country Data Service. Refusing the input here would be
    // this module inventing a requirement.
    const result = validateTravelerInput(
      { fullName: "Ama Mensah", passportExpiresOn: "2020-01-01" }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.passportExpiresOn).toBe("2020-01-01");
  });

  it("accepts a traveller with a name and nothing else", () => {
    const result = validateTravelerInput({ fullName: "Kofi" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.passportLast4).toBeNull();
    expect(result.value.relationship).toBeNull();
  });
});
