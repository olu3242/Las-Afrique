import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { TravelerRow, TripRow } from "@/lib/supabase/types";

/**
 * Reads for the trip engine.
 *
 * Every query here goes through `lib/supabase/server.ts`, which carries the
 * publishable key and the caller's session — so RLS applies and these
 * functions cannot read another user's rows even if a caller passed someone
 * else's trip id. The authorization is the database's, not a filter written
 * here that could be forgotten on the next query.
 */

export interface CountryOption {
  key: string;
  name: string;
  majorCities: string[];
}

/** Destinations trip intake may offer, in the product's display order. */
export async function listCountryOptions(): Promise<CountryOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("country_profiles")
    .select("key, name, major_cities")
    .order("sort_order", { ascending: true });

  if (error) throw new Error(`Could not load destinations: ${error.message}`);

  return (data ?? []).map((row) => ({
    key: row.key,
    name: row.name,
    majorCities: row.major_cities ?? [],
  }));
}

export interface TripListItem extends TripRow {
  destination_name: string | null;
  traveler_count: number;
}

/** The signed-in user's trips, newest first. */
export async function listTrips(): Promise<TripListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trips")
    .select("*, country_profiles(name), travelers(id)")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Could not load your trips: ${error.message}`);

  type Joined = TripRow & {
    country_profiles: { name: string } | null;
    travelers: { id: string }[] | null;
  };

  return ((data ?? []) as Joined[]).map((row) => {
    const { country_profiles, travelers, ...trip } = row;
    return {
      ...trip,
      destination_name: country_profiles?.name ?? null,
      traveler_count: travelers?.length ?? 0,
    };
  });
}

export interface TripDetail {
  trip: TripRow;
  destinationName: string | null;
  travelers: TravelerRow[];
}

/**
 * One trip with its travellers, or null.
 *
 * Null covers both "no such trip" and "not yours" — RLS returns no row either
 * way, and the caller renders a 404 for both. Telling the caller which of the
 * two it was would confirm the existence of another user's trip.
 */
export async function getTrip(id: string): Promise<TripDetail | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("trips")
    .select("*, country_profiles(name)")
    .eq("id", id)
    .maybeSingle();

  // A malformed uuid is a 400 from PostgREST rather than an empty result. It
  // is still just a trip that does not exist.
  if (error || !data) return null;

  const { country_profiles, ...trip } = data as TripRow & {
    country_profiles: { name: string } | null;
  };

  const { data: travelers, error: travelerError } = await supabase
    .from("travelers")
    .select("*")
    .eq("trip_id", id)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });

  if (travelerError) {
    throw new Error(`Could not load travellers: ${travelerError.message}`);
  }

  return {
    trip,
    destinationName: country_profiles?.name ?? null,
    travelers: (travelers ?? []) as TravelerRow[],
  };
}
