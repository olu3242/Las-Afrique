/**
 * Trip intake validation.
 *
 * The one place trip and traveler input rules are defined. The server action
 * calls this; the form renders the errors it returns. Neither restates a rule,
 * because a rule stated twice is a rule that will disagree with itself.
 *
 * These checks sit *in front of* the database constraints in
 * `0001_initial_schema.sql`, they do not replace them. The constraints are the
 * backstop that holds even if something reaches the table by another route.
 *
 * Nothing here encodes an entry requirement. Whether a passport is valid for a
 * given country on a given date is the Country Data Service's business
 * (Iteration 3), not a rule invented in a validator.
 */

import type {
  AccommodationTier,
  TripPurpose,
} from "@/lib/supabase/types";

export const TRIP_PURPOSES: ReadonlyArray<{
  value: TripPurpose;
  label: string;
}> = [
  { value: "homecoming", label: "Homecoming" },
  { value: "family_visit", label: "Family visit" },
  { value: "ceremony", label: "Ceremony" },
  { value: "business", label: "Business" },
  { value: "other", label: "Other" },
];

export const ACCOMMODATION_TIERS: ReadonlyArray<{
  value: AccommodationTier;
  label: string;
  hint: string;
}> = [
  {
    value: "staying_with_family",
    label: "Staying with family",
    hint: "No nightly accommodation cost",
  },
  { value: "budget", label: "Budget", hint: "Guesthouses and hostels" },
  { value: "midrange", label: "Mid-range", hint: "Standard hotels and rentals" },
  { value: "premium", label: "Premium", hint: "Upper-tier hotels" },
];

/**
 * An upper bound on party size. Not a legal or airline limit — a guard so a
 * mistyped number cannot become 900 traveler rows. Trips larger than this are
 * group coordination, which is Phase 2.
 */
export const MAX_PARTY_SIZE = 20;

export const MAX_NAME_LENGTH = 120;
export const MAX_CITY_LENGTH = 120;

/** How far ahead a trip may be planned. A departure beyond this is a typo. */
export const MAX_YEARS_AHEAD = 5;

export type FieldErrors<Field extends string> = Partial<Record<Field, string>>;

export type ValidationResult<Value, Field extends string> =
  | { ok: true; value: Value }
  | { ok: false; errors: FieldErrors<Field> };

export type TripField =
  | "destinationCountryKey"
  | "destinationCity"
  | "originCountry"
  | "originCity"
  | "departOn"
  | "returnOn"
  | "purpose"
  | "partySize"
  | "accommodationTier";

export interface TripInput {
  destinationCountryKey: string;
  destinationCity: string | null;
  originCountry: string | null;
  originCity: string | null;
  departOn: string | null;
  returnOn: string | null;
  purpose: TripPurpose | null;
  partySize: number | null;
  accommodationTier: AccommodationTier | null;
}

/**
 * Raw form values. Every field arrives as a string or is absent, which is what
 * FormData gives us — the parsing is part of validation rather than something
 * the caller is trusted to have done first.
 */
export type RawTripInput = Partial<Record<TripField, string | null>>;

export interface TripValidationContext {
  /**
   * Destination keys the Country Data Service actually knows about, read from
   * `country_profiles` by the caller. Passed in rather than hardcoded: the set
   * of supported countries is data, and a validator that keeps its own copy
   * would drift from the table the foreign key points at.
   */
  allowedCountryKeys: readonly string[];
  /** Today, as an ISO date. Injected so the rules are testable without clocks. */
  today: string;
}

function text(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** ISO calendar date, and a real one — `2025-02-30` parses but is not a date. */
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

function addYears(isoDate: string, years: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

export function validateTripInput(
  raw: RawTripInput,
  context: TripValidationContext,
): ValidationResult<TripInput, TripField> {
  const errors: FieldErrors<TripField> = {};

  const destinationCountryKey = text(raw.destinationCountryKey);
  if (!destinationCountryKey) {
    errors.destinationCountryKey = "Choose where you are travelling to.";
  } else if (!context.allowedCountryKeys.includes(destinationCountryKey)) {
    errors.destinationCountryKey =
      "We do not have a country guide for that destination yet.";
  }

  const destinationCity = text(raw.destinationCity);
  if (destinationCity && destinationCity.length > MAX_CITY_LENGTH) {
    errors.destinationCity = `Keep the city under ${MAX_CITY_LENGTH} characters.`;
  }

  const originCountry = text(raw.originCountry);
  const originCity = text(raw.originCity);
  if (originCity && originCity.length > MAX_CITY_LENGTH) {
    errors.originCity = `Keep the city under ${MAX_CITY_LENGTH} characters.`;
  }

  const departRaw = text(raw.departOn);
  let departOn: string | null = null;
  if (departRaw) {
    if (!isCalendarDate(departRaw)) {
      errors.departOn = "Enter the departure date as a real date.";
    } else if (departRaw < context.today) {
      errors.departOn = "The departure date is in the past.";
    } else if (departRaw > addYears(context.today, MAX_YEARS_AHEAD)) {
      errors.departOn = `Departure has to be within ${MAX_YEARS_AHEAD} years.`;
    } else {
      departOn = departRaw;
    }
  }

  const returnRaw = text(raw.returnOn);
  let returnOn: string | null = null;
  if (returnRaw) {
    if (!isCalendarDate(returnRaw)) {
      errors.returnOn = "Enter the return date as a real date.";
    } else if (departOn && returnRaw < departOn) {
      errors.returnOn = "The return date is before the departure date.";
    } else {
      returnOn = returnRaw;
    }
  }

  const purposeRaw = text(raw.purpose);
  let purpose: TripPurpose | null = null;
  if (purposeRaw) {
    const match = TRIP_PURPOSES.find((p) => p.value === purposeRaw);
    if (!match) errors.purpose = "Choose one of the listed reasons.";
    else purpose = match.value;
  }

  const partySizeRaw = text(raw.partySize);
  let partySize: number | null = null;
  if (partySizeRaw) {
    // Deliberately strict. Number("3 people") is NaN but Number("") is 0 and
    // parseInt("3x") is 3 — neither is a party size the user typed.
    if (!/^\d+$/.test(partySizeRaw)) {
      errors.partySize = "Enter the number of travellers as a whole number.";
    } else {
      const parsed = Number(partySizeRaw);
      if (parsed < 1) errors.partySize = "A trip needs at least one traveller.";
      else if (parsed > MAX_PARTY_SIZE) {
        errors.partySize = `Take Me Home plans trips of up to ${MAX_PARTY_SIZE} travellers.`;
      } else partySize = parsed;
    }
  }

  const tierRaw = text(raw.accommodationTier);
  let accommodationTier: AccommodationTier | null = null;
  if (tierRaw) {
    const match = ACCOMMODATION_TIERS.find((t) => t.value === tierRaw);
    if (!match) errors.accommodationTier = "Choose one of the listed options.";
    else accommodationTier = match.value;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      // Non-null by construction: an empty key produced an error above.
      destinationCountryKey: destinationCountryKey as string,
      destinationCity,
      originCountry,
      originCity,
      departOn,
      returnOn,
      purpose,
      partySize,
      accommodationTier,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Travelers                                                                   */
/* -------------------------------------------------------------------------- */

export type TravelerField =
  | "fullName"
  | "relationship"
  | "passportLast4"
  | "passportExpiresOn";

export interface TravelerInput {
  fullName: string;
  relationship: string | null;
  passportLast4: string | null;
  passportExpiresOn: string | null;
}

export type RawTravelerInput = Partial<
  Record<TravelerField, string | null>
>;

/**
 * No context parameter, deliberately. Traveller input has no rule that depends
 * on today's date: whether a passport expiry is a problem depends on the
 * destination's requirements, which is the Country Data Service's call in
 * Iteration 4 — not a date comparison invented here.
 */
export function validateTravelerInput(
  raw: RawTravelerInput,
): ValidationResult<TravelerInput, TravelerField> {
  const errors: FieldErrors<TravelerField> = {};

  const fullName = text(raw.fullName);
  if (!fullName) {
    errors.fullName = "Enter the traveller's name.";
  } else if (fullName.length > MAX_NAME_LENGTH) {
    errors.fullName = `Keep the name under ${MAX_NAME_LENGTH} characters.`;
  }

  const relationship = text(raw.relationship);
  if (relationship && relationship.length > MAX_NAME_LENGTH) {
    errors.relationship = `Keep this under ${MAX_NAME_LENGTH} characters.`;
  }

  // Four characters, and only ever four. Take Me Home has no reason to hold a
  // whole passport number, so the column cannot store one and neither can this.
  const passportLast4 = text(raw.passportLast4);
  if (passportLast4 && !/^[A-Za-z0-9]{4}$/.test(passportLast4)) {
    errors.passportLast4 = "Enter the last four characters only.";
  }

  const expiresRaw = text(raw.passportExpiresOn);
  let passportExpiresOn: string | null = null;
  if (expiresRaw) {
    if (!isCalendarDate(expiresRaw)) {
      errors.passportExpiresOn = "Enter the expiry date as a real date.";
    } else {
      // An expired passport is recorded, not rejected. Knowing it expired is
      // the point — readiness (Iteration 4) is what acts on that, and only the
      // Country Data Service can say what a given country requires.
      passportExpiresOn = expiresRaw;
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      fullName: fullName as string,
      relationship,
      passportLast4: passportLast4 ? passportLast4.toUpperCase() : null,
      passportExpiresOn,
    },
  };
}

/** Today as an ISO date, in UTC. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
