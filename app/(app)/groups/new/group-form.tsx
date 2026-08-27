"use client";

import { useActionState } from "react";
import { createGroup } from "@/lib/groups/actions";
import { IDLE } from "@/lib/forms";
import { Field, inputClass } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { SubmitButton } from "@/components/ui/submit-button";
import { useFormValues } from "@/components/ui/use-form-values";
import type { CountryOption } from "@/lib/trips/service";
import type { GroupField } from "@/lib/groups/validation";

export function GroupForm({ countries }: { countries: CountryOption[] }) {
  const [state, action] = useActionState(createGroup, IDLE);

  // Bound rather than passed as defaultValue: React 19 resets an uncontrolled
  // form after its action runs, and a <select> reverts to its mount-time
  // default — which would silently clear the destination on any submission
  // that failed validation on some other field.
  const { bind } = useFormValues<GroupField>(state.values);

  return (
    <form action={action} className="mt-10 flex flex-col gap-6" noValidate>
      <FormError message={state.message} />

      <Field id="name" label="Group name" error={state.errors?.name}>
        {(props) => (
          <input
            {...props}
            {...bind("name")}
            name="name"
            type="text"
            autoComplete="off"
            className={inputClass}
          />
        )}
      </Field>

      <Field
        id="destinationCountryKey"
        label="Destination country"
        optional
        error={state.errors?.destinationCountryKey}
      >
        {(props) => (
          <select
            {...props}
            {...bind("destinationCountryKey")}
            name="destinationCountryKey"
            className={inputClass}
          >
            <option value="">Not decided yet</option>
            {countries.map((country) => (
              <option key={country.key} value={country.key}>
                {country.name}
              </option>
            ))}
          </select>
        )}
      </Field>

      <div className="grid gap-6 sm:grid-cols-2">
        <Field id="departOn" label="Departure" optional error={state.errors?.departOn}>
          {(props) => (
            <input
              {...props}
              {...bind("departOn")}
              name="departOn"
              type="date"
              className={inputClass}
            />
          )}
        </Field>

        <Field id="returnOn" label="Return" optional error={state.errors?.returnOn}>
          {(props) => (
            <input
              {...props}
              {...bind("returnOn")}
              name="returnOn"
              type="date"
              className={inputClass}
            />
          )}
        </Field>
      </div>

      <p className="text-sm leading-relaxed text-muted">
        These are the group&rsquo;s dates. Anyone arriving or leaving on a
        different day can say so on their own membership.
      </p>

      <div>
        <SubmitButton pendingLabel="Creating…">Create group</SubmitButton>
      </div>
    </form>
  );
}
