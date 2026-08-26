"use client";

import { useActionState } from "react";
import { addTraveler } from "@/lib/trips/actions";
import type { TravelerField } from "@/lib/trips/validation";
import { IDLE } from "@/lib/forms";
import { Field, inputClass } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { SubmitButton } from "@/components/ui/submit-button";
import { useFormValues } from "@/components/ui/use-form-values";

export function AddTravelerForm({ tripId }: { tripId: string }) {
  const [state, action] = useActionState(addTraveler, IDLE);
  const { bind } = useFormValues<TravelerField>(state.values);
  // No manual reset. The fields are controlled from the action's echoed
  // values, so a success — which returns no values — clears them, and a
  // failure puts back exactly what was typed. form.reset() would not have
  // touched a controlled field anyway.

  return (
    <form
      action={action}
      className="mt-8 flex flex-col gap-5 rounded-2xl border border-ivory/15 bg-indigo-900/30 p-5 sm:p-6"
      noValidate
    >
      <h3 className="font-display text-lg text-ivory">Add a traveller</h3>
      <input type="hidden" name="tripId" value={tripId} />
      <FormError message={state.message} />

      <Field id="fullName" label="Full name" error={state.errors?.fullName}>
        {(props) => (
          <input
            {...props}
            name="fullName"
            type="text"
            autoComplete="off"
            {...bind("fullName")}
            className={inputClass}
          />
        )}
      </Field>

      <Field
        id="relationship"
        label="Relationship"
        hint="How you would describe them — sister, son, friend."
        optional
        error={state.errors?.relationship}
      >
        {(props) => (
          <input
            {...props}
            name="relationship"
            type="text"
            {...bind("relationship")}
            className={inputClass}
          />
        )}
      </Field>

      <Field
        id="passportLast4"
        label="Last four of passport"
        hint="Four characters. We never store the whole number."
        optional
        error={state.errors?.passportLast4}
      >
        {(props) => (
          <input
            {...props}
            {...bind("passportLast4")}
            name="passportLast4"
            type="text"
            maxLength={4}
            autoComplete="off"
            className={`${inputClass} text-data`}
          />
        )}
      </Field>

      <Field
        id="passportExpiresOn"
        label="Passport expires"
        optional
        error={state.errors?.passportExpiresOn}
      >
        {(props) => (
          <input
            {...props}
            {...bind("passportExpiresOn")}
            name="passportExpiresOn"
            type="date"
            className={inputClass}
          />
        )}
      </Field>

      <div className="mt-1">
        <SubmitButton variant="secondary" pendingLabel="Adding…">
          Add traveller
        </SubmitButton>
      </div>
    </form>
  );
}
