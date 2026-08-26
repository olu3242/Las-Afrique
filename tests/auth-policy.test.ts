import { describe, expect, it } from "vitest";
import {
  DEFAULT_DESTINATION,
  safeDestination,
} from "@/lib/auth/policy";
import { isProtectedPath, PROTECTED_PREFIXES } from "@/lib/supabase/middleware";

describe("post-sign-in destination", () => {
  it("keeps a same-origin path", () => {
    expect(safeDestination("/trips/abc")).toBe("/trips/abc");
  });

  it("keeps a path with a query string", () => {
    expect(safeDestination("/trips?filter=upcoming")).toBe(
      "/trips?filter=upcoming",
    );
  });

  it.each<[string | null | undefined, string]>([
    ["https://elsewhere.example/steal", "an absolute URL"],
    ["//elsewhere.example/steal", "a protocol-relative URL"],
    ["/\\elsewhere.example", "a backslash the browser may normalise"],
    ["javascript:alert(1)", "a javascript: URL"],
    ["", "an empty string"],
    [null, "a missing value"],
    [undefined, "an absent value"],
  ])("refuses %s (%s)", (value, _description) => {
    // An open redirect out of a sign-in page is a phishing primitive: the
    // victim really did sign in to the real site, and lands somewhere else.
    expect(safeDestination(value)).toBe(DEFAULT_DESTINATION);
  });
});

describe("protected routes", () => {
  it("gates the product routes", () => {
    expect(isProtectedPath("/dashboard")).toBe(true);
    expect(isProtectedPath("/trips/new")).toBe(true);
    expect(isProtectedPath("/trips/8f2c-abc")).toBe(true);
    expect(isProtectedPath("/countries")).toBe(true);
    expect(isProtectedPath("/countries/nigeria")).toBe(true);
  });

  it("leaves the public routes open", () => {
    // The sign-in page must not be behind the sign-in gate.
    expect(isProtectedPath("/")).toBe(false);
    expect(isProtectedPath("/login")).toBe(false);
    expect(isProtectedPath("/signup")).toBe(false);
  });

  it("does not gate a path that merely starts with the same letters", () => {
    // "/trips" must not make "/tripsomething" protected — or, worse, leave a
    // real product route open because the prefix matched loosely.
    expect(isProtectedPath("/tripsomething")).toBe(false);
    expect(isProtectedPath("/countriesomething")).toBe(false);
    expect(isProtectedPath("/dashboards-public")).toBe(false);
  });

  it("keeps every declared prefix gated", () => {
    for (const prefix of PROTECTED_PREFIXES) {
      expect(isProtectedPath(prefix), prefix).toBe(true);
    }
  });
});
