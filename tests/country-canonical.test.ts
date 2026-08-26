import { describe, expect, it } from "vitest";
import {
  canonicalCountryKey,
  knownCountryKeys,
  normalise,
} from "@/lib/country/canonical";

describe("canonical country lookup", () => {
  it("round-trips a key that is already canonical", () => {
    for (const key of knownCountryKeys()) {
      expect(canonicalCountryKey(key), key).toBe(key);
    }
  });

  it.each([
    ["Nigeria", "nigeria"],
    ["NIGERIA", "nigeria"],
    ["  nigeria  ", "nigeria"],
    ["Federal Republic of Nigeria", "nigeria"],
    ["NG", "nigeria"],
    ["South Africa", "south-africa"],
    ["south africa", "south-africa"],
    ["RSA", "south-africa"],
    ["Sierra Leone", "sierra-leone"],
    ["sierra-leone", "sierra-leone"],
    ["Ivory Coast", "ivory-coast"],
    ["Côte d'Ivoire", "ivory-coast"],
    ["cote d ivoire", "ivory-coast"],
    ["COTE-DIVOIRE", "ivory-coast"],
    ["Sénégal", "senegal"],
    ["Cameroun", "cameroon"],
  ])("resolves %s", (input, expected) => {
    expect(canonicalCountryKey(input)).toBe(expected);
  });

  it("strips accents so one spelling does not miss another", () => {
    expect(normalise("Côte d'Ivoire")).toBe("cote d ivoire");
    expect(normalise("Sénégal")).toBe("senegal");
  });

  it.each([[null], [undefined], [""], ["   "]])(
    "returns null for %s",
    (input) => {
      expect(canonicalCountryKey(input as string | null)).toBeNull();
    },
  );

  it("returns null rather than guessing at an unknown destination", () => {
    // The load-bearing case. Resolving to the nearest match is how someone
    // reads Ghana's requirements before flying to Guinea.
    for (const unknown of ["Guinea", "Atlantis", "Nigerien", "South", "Niger"]) {
      expect(canonicalCountryKey(unknown), unknown).toBeNull();
    }
  });

  it("does not resolve a prefix of a known country", () => {
    expect(canonicalCountryKey("Nig")).toBeNull();
    expect(canonicalCountryKey("Sierra")).toBeNull();
  });

  it("covers every launch country the PRD names", () => {
    // Eleven, in the PRD's order. A country in the seed with no alias entry
    // would be unreachable from anything but its exact key.
    expect(knownCountryKeys()).toEqual([
      "nigeria",
      "ghana",
      "kenya",
      "uganda",
      "south-africa",
      "liberia",
      "cameroon",
      "sierra-leone",
      "senegal",
      "ivory-coast",
      "ethiopia",
    ]);
  });
});
