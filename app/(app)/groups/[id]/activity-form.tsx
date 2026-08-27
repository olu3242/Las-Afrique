"use client";

import { useActionState } from "react";
import { createGroupActivity } from "@/lib/groups/actions";
import { IDLE } from "@/lib/forms";
import { Field, inputClass } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { SubmitButton } from "@/components/ui/submit-button";

export function ActivityForm({ groupId }: { groupId: string }) {
  const [state, action] = useActionState(createGroupActivity, IDLE);

  return (
    <form
      action={action}
      className="flex flex-col gap-4 rounded-2xl border border-ivory/15 bg-indigo-900/30 p-5"
      noValidate
    >
      <h3 className="font-display text-lg text-ivory">Add an activity</h3>
      <input type="hidden" name="groupId" value={groupId} />
      <FormError message={state.message} />

      <Field id="activity-title" label="What is it" error={state.errors?.title}>
        {(props) => (
          <input {...props} name="title" type="text" className={inputClass} />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="activity-happensOn" label="When" optional error={state.errors?.happensOn}>
          {(props) => (
            <input {...props} name="happensOn" type="date" className={inputClass} />
          )}
        </Field>

        <Field id="activity-location" label="Where" optional>
          {(props) => (
            <input {...props} name="location" type="text" className={inputClass} />
          )}
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="activity-estimatedCost"
          label="Estimated cost"
          optional
          hint="An estimate for planning. Nothing is charged or held."
          error={state.errors?.estimatedCost}
        >
          {(props) => (
            <input
              {...props}
              name="estimatedCost"
              type="number"
              min="0"
              step="0.01"
              className={inputClass}
            />
          )}
        </Field>

        <Field
          id="activity-costCurrency"
          label="Currency"
          optional
          error={state.errors?.costCurrency}
        >
          {(props) => (
            <input
              {...props}
              name="costCurrency"
              type="text"
              maxLength={3}
              placeholder="NGN"
              className={inputClass}
            />
          )}
        </Field>
      </div>

      <div>
        <SubmitButton variant="secondary" pendingLabel="Adding…">
          Add activity
        </SubmitButton>
      </div>
    </form>
  );
}
