import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getCountryGuide } from "@/lib/country/service";
import type { DocumentRecordRow, TravelerRow, TripRow } from "@/lib/supabase/types";
import { deriveReadiness, type Readiness } from "./engine";

/**
 * Assembles the readiness engine's inputs from the real preceding engines.
 *
 * The trip and its travellers come from Iteration 2's tables, and the
 * destination's verification status comes from Iteration 3's Country Data
 * Service — not from a second reading of `country_profiles` here. That matters
 * more than it looks: the service is where "partial provenance is not
 * provenance" is decided, and a direct query would quietly disagree with it.
 *
 * Nothing is cached and nothing is stored. Readiness is derived on every read,
 * so it cannot go stale against the rows it describes.
 */
export async function getTripReadiness(
  trip: TripRow,
  travelers: TravelerRow[],
): Promise<Readiness> {
  const supabase = await createClient();

  const { data: documents, error } = await supabase
    .from("document_records")
    .select("*")
    .eq("trip_id", trip.id);

  if (error) {
    throw new Error(`Could not load documents: ${error.message}`);
  }

  const guide = await getCountryGuide(trip.destination_country_key);

  return deriveReadiness({
    departOn: trip.depart_on,
    returnOn: trip.return_on,
    destinationName: guide?.name ?? null,
    // The service's own judgement, not a re-derivation. A guide with partial
    // provenance returns no requirements, and that is what "unverified" means
    // here too.
    destinationVerified: guide?.requirements !== null && guide !== null,
    travelers: travelers.map((t) => ({
      id: t.id,
      fullName: t.full_name,
      passportExpiresOn: t.passport_expires_on,
    })),
    documents: ((documents ?? []) as DocumentRecordRow[]).map((d) => ({
      id: d.id,
      travelerId: d.traveler_id,
      kind: d.kind,
      state: d.state,
      dueOn: d.due_on,
      note: d.note,
    })),
    today: new Date().toISOString().slice(0, 10),
  });
}
