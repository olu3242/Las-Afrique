/**
 * Resolving what a traveller typed to the one country a guide is keyed on.
 *
 * A destination arrives as a stored key, a name off a form, or a phrase from a
 * planner request. All three have to land on the same row or the guide shown
 * is not the guide for the country asked about — which, for entry
 * requirements, is worse than showing nothing.
 *
 * The alias table holds only *naming* facts: what a country is also called,
 * how it is spelled elsewhere, its ISO codes. Nothing here says anything about
 * what a country requires.
 */

/**
 * Aliases per canonical key.
 *
 * Deliberately conservative. An alias that is merely *plausible* is how
 * "Guinea" quietly resolves to "Guinea-Bissau", so only names, established
 * alternates and ISO codes are listed. An unrecognised destination resolves to
 * null and the caller says so.
 */
const ALIASES: Record<string, readonly string[]> = {
  nigeria: ["nigeria", "ng", "nga", "federal republic of nigeria"],
  ghana: ["ghana", "gh", "gha", "republic of ghana"],
  kenya: ["kenya", "ke", "ken", "republic of kenya"],
  uganda: ["uganda", "ug", "uga", "republic of uganda"],
  "south-africa": [
    "south africa",
    "southafrica",
    "za",
    "zaf",
    "rsa",
    "republic of south africa",
  ],
  liberia: ["liberia", "lr", "lbr", "republic of liberia"],
  cameroon: ["cameroon", "cameroun", "cm", "cmr", "republic of cameroon"],
  "sierra-leone": ["sierra leone", "sierraleone", "sl", "sle"],
  senegal: ["senegal", "sénégal", "sn", "sen", "republic of senegal"],
  "ivory-coast": [
    "ivory coast",
    "ivorycoast",
    "cote d'ivoire",
    "côte d'ivoire",
    "cote divoire",
    "ci",
    "civ",
  ],
  ethiopia: ["ethiopia", "et", "eth", "federal republic of ethiopia"],
};

/**
 * Lowercase, strip accents, collapse punctuation and whitespace.
 *
 * "Côte d'Ivoire", "cote d ivoire" and "COTE-DIVOIRE" are the same request
 * typed by three people.
 */
export function normalise(input: string): string {
  return input
    .normalize("NFD")
    // Combining marks: é -> e, so an accented spelling matches an unaccented
    // alias without listing both.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const LOOKUP: ReadonlyMap<string, string> = new Map(
  Object.entries(ALIASES).flatMap(([key, aliases]) => [
    // The key itself, so a value already canonical round-trips.
    [normalise(key), key] as [string, string],
    ...aliases.map((alias) => [normalise(alias), key] as [string, string]),
  ]),
);

/**
 * The canonical country key for a destination, or null.
 *
 * Null is a real answer and callers must handle it: an unrecognised
 * destination means Take Me Home has no guide, and saying so is correct.
 * Guessing the nearest match is how a traveller reads Ghana's requirements
 * before flying to Guinea.
 */
export function canonicalCountryKey(input: string | null | undefined): string | null {
  if (!input) return null;
  return LOOKUP.get(normalise(input)) ?? null;
}

/** Every canonical key the lookup knows, for tests and for validation. */
export function knownCountryKeys(): string[] {
  return Object.keys(ALIASES);
}
