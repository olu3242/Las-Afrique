/**
 * How old a country guide is, and what may be said about it.
 *
 * Derived, never stored: a stored freshness label is one that keeps claiming
 * "checked recently" long after it stopped being true. The inputs are the
 * verification state and the date it was last checked; the output is a state,
 * a glyph and a sentence.
 *
 * Every state carries a glyph and a text label as well as a tone, because
 * state is never conveyed by colour alone.
 */

export type FreshnessState =
  | "unverified"
  | "fresh"
  | "aging"
  | "stale";

export interface Freshness {
  state: FreshnessState;
  /** Paired with the label so the state survives without colour. */
  glyph: string;
  label: string;
  /** One sentence a traveller can act on. */
  detail: string;
  /** Days since the check, or null when never checked. */
  ageInDays: number | null;
  /** Whether the guide's contents may be shown at all. */
  showsRequirements: boolean;
}

/**
 * Thresholds in days.
 *
 * Not derived from any regulation — entry rules change on no schedule, so any
 * number here is a review cadence rather than a claim about validity. They are
 * named and exported so the choice is visible instead of buried as a literal.
 */
export const FRESH_THROUGH_DAYS = 30;
export const AGING_THROUGH_DAYS = 90;

export function deriveFreshness(
  verificationState: string,
  lastVerifiedAt: string | Date | null,
  now: Date = new Date(),
): Freshness {
  // No source, or never checked: there is nothing to be fresh *about*. This
  // takes precedence over any date, because 0007 permits a date without a
  // verified state but the guide still carries no verified claim.
  if (verificationState !== "verified" || !lastVerifiedAt) {
    return {
      state: "unverified",
      glyph: "◌",
      label: "Not yet verified",
      detail:
        "We have a guide for this country but have not verified its entry " +
        "requirements yet. Check the official source before you travel.",
      ageInDays: null,
      showsRequirements: false,
    };
  }

  const checked =
    lastVerifiedAt instanceof Date ? lastVerifiedAt : new Date(lastVerifiedAt);

  if (Number.isNaN(checked.getTime())) {
    // An unparseable date is not a recent one. Fail towards saying less.
    return {
      state: "unverified",
      glyph: "◌",
      label: "Not yet verified",
      detail:
        "We could not read when this guide was last checked. Treat it as " +
        "unverified and check the official source.",
      ageInDays: null,
      showsRequirements: false,
    };
  }

  const ageInDays = Math.max(
    0,
    Math.floor((now.getTime() - checked.getTime()) / 86_400_000),
  );

  if (ageInDays <= FRESH_THROUGH_DAYS) {
    return {
      state: "fresh",
      glyph: "✓",
      label: `Checked ${describeAge(ageInDays)}`,
      detail: "Requirements can change at any time. Verify before you travel.",
      ageInDays,
      showsRequirements: true,
    };
  }

  if (ageInDays <= AGING_THROUGH_DAYS) {
    return {
      state: "aging",
      glyph: "•",
      label: `Checked ${describeAge(ageInDays)}`,
      detail:
        "This guide has not been re-checked recently. Confirm each " +
        "requirement against the official source before you travel.",
      ageInDays,
      showsRequirements: true,
    };
  }

  return {
    state: "stale",
    glyph: "!",
    label: `Last checked ${describeAge(ageInDays)}`,
    detail:
      "This guide is old enough that we would not rely on it. Treat the " +
      "official source as authoritative.",
    ageInDays,
    showsRequirements: true,
  };
}

function describeAge(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return "a month ago";
  if (months < 12) return `${months} months ago`;
  const years = Math.floor(days / 365);
  return years === 1 ? "over a year ago" : `over ${years} years ago`;
}
