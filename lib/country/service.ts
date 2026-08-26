import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { CountryProfileRow } from "@/lib/supabase/types";
import { canonicalCountryKey } from "./canonical";
import { deriveFreshness, type Freshness } from "./freshness";

/**
 * The Country Data Service.
 *
 * The compliance and requirements source of truth, per the PRD — and, just as
 * importantly, the thing that decides when there is no truth to report.
 *
 * Two rules it enforces, both of which the database also enforces in 0007.
 * Stating them twice is deliberate: the constraint stops bad data being
 * written, this stops bad data being *shown* if it ever arrives another way.
 *
 *   A requirement is never returned without its provenance attached.
 *   A guide whose freshness derivation says it carries nothing verified
 *   returns no requirement content at all, whatever the columns hold.
 */

export interface Provenance {
  sourceName: string;
  sourceUrl: string;
  lastVerifiedAt: string;
}

export interface CountryGuide {
  key: string;
  name: string;
  currency: string;
  majorCities: string[];
  freshness: Freshness;
  /**
   * Null whenever the guide is unverified. Not an empty object — the caller
   * has to distinguish "no requirements apply" from "we do not know", and
   * only one of those is ever true here.
   */
  provenance: Provenance | null;
  /**
   * Requirement sections, present only alongside provenance. Content is
   * whatever the verified source supplied; this service does not interpret it
   * and never supplies a default.
   */
  requirements: CountryRequirements | null;
}

export interface CountryRequirements {
  visaEntry: unknown | null;
  passportConsiderations: unknown | null;
  emergency: unknown | null;
  customs: unknown | null;
  advisories: unknown | null;
}

/**
 * Look a country up by anything a caller might hold — a stored key, a name off
 * a form, a phrase from a planner request.
 *
 * Returns null for a destination with no guide. That is a real answer: the
 * product not covering a country is a fact worth stating, and it is safer than
 * resolving to the nearest match.
 */
export async function getCountryGuide(
  destination: string | null | undefined,
): Promise<CountryGuide | null> {
  const key = canonicalCountryKey(destination);
  if (!key) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("country_profiles")
    .select("*")
    .eq("key", key)
    .maybeSingle();

  if (error || !data) return null;
  return toGuide(data);
}

/** Every country with a guide, in the product's display order. */
export async function listCountryGuides(): Promise<CountryGuide[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("country_profiles")
    .select("*")
    .order("sort_order", { ascending: true });

  if (error) throw new Error(`Could not load country guides: ${error.message}`);
  return (data ?? []).map(toGuide);
}

function toGuide(row: CountryProfileRow): CountryGuide {
  const freshness = deriveFreshness(
    row.verification_state,
    row.last_verified_at,
  );

  // Provenance is all-or-nothing. A partial record — a name with no URL, a URL
  // with no date — is not something a traveller can go and check, so it is not
  // provenance and the guide is treated as unverified.
  const provenance: Provenance | null =
    row.source_name && row.source_url && row.last_verified_at
      ? {
          sourceName: row.source_name,
          sourceUrl: row.source_url,
          lastVerifiedAt: row.last_verified_at,
        }
      : null;

  const mayShow = freshness.showsRequirements && provenance !== null;

  return {
    key: row.key,
    name: row.name,
    currency: row.currency,
    majorCities: row.major_cities ?? [],
    freshness,
    provenance: mayShow ? provenance : null,
    requirements: mayShow
      ? {
          visaEntry: row.visa_entry_info ?? null,
          passportConsiderations: row.passport_considerations ?? null,
          emergency: row.emergency_info ?? null,
          customs: row.customs_notes ?? null,
          advisories: row.advisories ?? null,
        }
      : null,
  };
}
