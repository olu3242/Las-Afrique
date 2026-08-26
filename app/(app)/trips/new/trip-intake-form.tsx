"use client";

import { useActionState } from "react";
import { createTrip } from "@/lib/trips/actions";
import {
  ACCOMMODATION_TIERS,
  MAX_PARTY_SIZE,
  TRIP_PURPOSES,
} from "@/lib/trips/validation";
import type { CountryOption } from "@/lib/trips/service";
import { IDLE } from "@/lib/forms";
import { Field, inputClass } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { SubmitButton } from "@/components/ui/submit-button";

/**
 * Trip intake.
 *
 * `noValidate` is deliberate: the browser's own validation would stop the
 * submission before the server rules ran, which would make the two disagree
 * about what is acceptable. Every message rendered here came back from
 * `validateTripInput`, so there is exactly one set of rules.
 */
export function TripIntakeForm({ countries }: { countries: CountryOption[] }) {
  const [state, action] = useActionState(createTrip, IDLE);
  const errors = state.errors;

  return (
    <form action={action} className="mt-10 flex flex-col gap-6" noValidate>
      <FormError message={state.message} />

      <Field
        id="destinationCountryKey"
        label="Destination country"
        error={errors?.destinationCountryKey}
      >
        {(props) => (
          <select
            {...props}
            name="destinationCountryKey"
            defaultValue={state.values?.destinationCountryKey ?? ""}
            className={inputClass}
          >
            <option value="">Choose a country</option>
            {countries.map((country) => (
              <option key={country.key} value={country.key}>
                {country.name}
              </option>
            ))}
          </select>
        )}
      </Field>

      <Field
        id="destinationCity"
        label="Destination city"
        optional
        error={errors?.destinationCity}
      >
        {(props) => (
          <input
            {...props}
            name="destinationCity"
            type="text"
            defaultValue={state.values?.destinationCity}
            className={inputClass}
          />
        )}
      </Field>

      <fieldset className="flex flex-col gap-6 border-t border-ivory/10 pt-6">
        <legend className="text-label">Travelling from</legend>

        <Field
          id="originCountry"
          label="Country"
          optional
          error={errors?.originCountry}
        >
          {(props) => (
            <input
              {...props}
              name="originCountry"
              type="text"
              autoComplete="country-name"
              defaultValue={state.values?.originCountry}
              className={inputClass}
            />
          )}
        </Field>

        <Field id="originCity" label="City" optional error={errors?.originCity}>
          {(props) => (
            <input
              {...props}
              name="originCity"
              type="text"
              defaultValue={state.values?.originCity}
              className={inputClass}
            />
          )}
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-6 border-t border-ivory/10 pt-6">
        <legend className="text-label">When</legend>

        <Field id="departOn" label="Departure" optional error={errors?.departOn}>
          {(props) => (
            <input
              {...props}
              name="departOn"
              type="date"
              defaultValue={state.values?.departOn}
              className={inputClass}
            />
          )}
        </Field>

        <Field id="returnOn" label="Return" optional error={errors?.returnOn}>
          {(props) => (
            <input
              {...props}
              name="returnOn"
              type="date"
              defaultValue={state.values?.returnOn}
              className={inputClass}
            />
          )}
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-6 border-t border-ivory/10 pt-6">
        <legend className="text-label">Details</legend>

        <Field id="purpose" label="Reason for the trip" optional error={errors?.purpose}>
          {(props) => (
            <select
              {...props}
              name="purpose"
              defaultValue={state.values?.purpose ?? ""}
              className={inputClass}
            >
              <option value="">Not sure yet</option>
              {TRIP_PURPOSES.map((purpose) => (
                <option key={purpose.value} value={purpose.value}>
                  {purpose.label}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field
          id="partySize"
          label="How many people are travelling"
          hint={`Up to ${MAX_PARTY_SIZE}. Add each traveller's details after the trip is created.`}
          optional
          error={errors?.partySize}
        >
          {(props) => (
            <input
              {...props}
              name="partySize"
              type="number"
              min={1}
              max={MAX_PARTY_SIZE}
              inputMode="numeric"
              defaultValue={state.values?.partySize}
              className={inputClass}
            />
          )}
        </Field>

        <Field
          id="accommodationTier"
          label="Where you will stay"
          optional
          error={errors?.accommodationTier}
        >
          {(props) => (
            <select
              {...props}
              name="accommodationTier"
              defaultValue={state.values?.accommodationTier ?? ""}
              className={inputClass}
            >
              <option value="">Not sure yet</option>
              {ACCOMMODATION_TIERS.map((tier) => (
                <option key={tier.value} value={tier.value}>
                  {tier.label} — {tier.hint}
                </option>
              ))}
            </select>
          )}
        </Field>
      </fieldset>

      <div className="mt-2">
        <SubmitButton pendingLabel="Saving your trip…">Save trip</SubmitButton>
      </div>
    </form>
  );
}
