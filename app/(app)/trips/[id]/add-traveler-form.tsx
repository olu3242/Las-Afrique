"use client";

import { useActionState, useEffect, useRef } from "react";
import { addTraveler } from "@/lib/trips/actions";
import { IDLE } from "@/lib/forms";
import { Field, inputClass } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { SubmitButton } from "@/components/ui/submit-button";

export function AddTravelerForm({ tripId }: { tripId: string }) {
  const [state, action] = useActionState(addTraveler, IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const previousState = useRef(state);

  // Clear the fields once a traveller has actually been added, so the next one
  // starts from an empty form. Keyed on the transition into `idle` rather than
  // on `idle` itself, or a failed submission that leaves state idle-by-default
  // would wipe what the user typed.
  useEffect(() => {
    if (previousState.current !== state && state.status === "idle") {
      formRef.current?.reset();
    }
    previousState.current = state;
  }, [state]);

  return (
    <form
      ref={formRef}
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
            defaultValue={state.values?.fullName}
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
            defaultValue={state.values?.relationship}
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
