"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { field, type ActionState } from "@/lib/forms";
import { listCountryOptions } from "./service";
import {
  todayIso,
  validateTravelerInput,
  validateTripInput,
  type TravelerField,
  type TripField,
} from "./validation";

/**
 * Trip mutations.
 *
 * Shape of each one, and the order matters:
 *
 *   session → validation → persistence (under RLS) → revalidate → navigate
 *
 * The session check is first and is not decorative. RLS would refuse the write
 * anyway — `auth.uid()` is null without one — but the user gets a sign-in page
 * rather than a database error, and `user.id` is read from the verified session
 * rather than from the form, so a submitted `user_id` cannot claim another
 * user's ownership.
 */

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?reason=required");
  return { supabase, user };
}

export async function createTrip(
  _previous: ActionState<TripField>,
  form: FormData,
): Promise<ActionState<TripField>> {
  const { supabase, user } = await requireUser();

  const raw = {
    destinationCountryKey: field(form, "destinationCountryKey"),
    destinationCity: field(form, "destinationCity"),
    originCountry: field(form, "originCountry"),
    originCity: field(form, "originCity"),
    departOn: field(form, "departOn"),
    returnOn: field(form, "returnOn"),
    purpose: field(form, "purpose"),
    partySize: field(form, "partySize"),
    accommodationTier: field(form, "accommodationTier"),
  };

  // The allowed destinations come from country_profiles, the same table the
  // foreign key points at — not from a list kept in the validator.
  const countries = await listCountryOptions();
  const result = validateTripInput(raw, {
    allowedCountryKeys: countries.map((c) => c.key),
    today: todayIso(),
  });

  if (!result.ok) {
    return {
      status: "error",
      errors: result.errors,
      values: Object.fromEntries(
        Object.entries(raw).filter(([, v]) => v !== null),
      ) as Partial<Record<TripField, string>>,
    };
  }

  const { data, error } = await supabase
    .from("trips")
    .insert({
      user_id: user.id,
      destination_country_key: result.value.destinationCountryKey,
      destination_city: result.value.destinationCity,
      origin_country: result.value.originCountry,
      origin_city: result.value.originCity,
      depart_on: result.value.departOn,
      return_on: result.value.returnOn,
      purpose: result.value.purpose,
      party_size: result.value.partySize,
      accommodation_tier: result.value.accommodationTier,
      status: "planning",
    })
    .select("id")
    .single();

  if (error || !data) {
    return {
      status: "error",
      message: "We could not save that trip. Try again.",
    };
  }

  revalidatePath("/dashboard");
  redirect(`/trips/${data.id}`);
}

export async function addTraveler(
  _previous: ActionState<TravelerField>,
  form: FormData,
): Promise<ActionState<TravelerField>> {
  const { supabase, user } = await requireUser();

  const tripId = field(form, "tripId");
  if (!tripId) {
    return { status: "error", message: "That trip could not be identified." };
  }

  const result = validateTravelerInput({
    fullName: field(form, "fullName"),
    relationship: field(form, "relationship"),
    passportLast4: field(form, "passportLast4"),
    passportExpiresOn: field(form, "passportExpiresOn"),
  });

  if (!result.ok) {
    return {
      status: "error",
      errors: result.errors,
      // All four, not just the text ones. Losing a typed passport expiry to a
      // mistyped name is the same defect as losing the name.
      values: {
        fullName: field(form, "fullName") ?? "",
        relationship: field(form, "relationship") ?? "",
        passportLast4: field(form, "passportLast4") ?? "",
        passportExpiresOn: field(form, "passportExpiresOn") ?? "",
      },
    };
  }

  // No ownership check on tripId here, on purpose — but not for the reason it
  // first appears. The insert policy alone would NOT stop a row naming someone
  // else's trip: `user_id = auth.uid()` is satisfied by owning the traveller
  // row, and the trip does exist. Probing that assumption is what turned it up.
  //
  // What refuses it is the composite foreign key added in 0006: travelers
  // references trips (id, user_id), so the traveller's owner must equal the
  // trip's owner. That holds in the schema, for every code path, rather than
  // in a check here that a future caller could forget.
  const { error } = await supabase.from("travelers").insert({
    trip_id: tripId,
    user_id: user.id,
    full_name: result.value.fullName,
    relationship: result.value.relationship,
    passport_last4: result.value.passportLast4,
    passport_expires_on: result.value.passportExpiresOn,
  });

  if (error) {
    return {
      status: "error",
      message: "We could not add that traveller. Try again.",
    };
  }

  revalidatePath(`/trips/${tripId}`);
  revalidatePath("/dashboard");
  return { status: "idle" };
}

export async function removeTraveler(form: FormData): Promise<void> {
  const { supabase } = await requireUser();

  const travelerId = field(form, "travelerId");
  const tripId = field(form, "tripId");
  if (!travelerId || !tripId) return;

  // Matches nothing when the row is another user's — the delete policy's
  // `using (user_id = auth.uid())` is what makes that true.
  await supabase.from("travelers").delete().eq("id", travelerId);

  revalidatePath(`/trips/${tripId}`);
  revalidatePath("/dashboard");
}
