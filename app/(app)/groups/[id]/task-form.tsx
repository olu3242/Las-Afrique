"use client";

import { useActionState } from "react";
import { createGroupTask } from "@/lib/groups/actions";
import { IDLE } from "@/lib/forms";
import { Field, inputClass } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { SubmitButton } from "@/components/ui/submit-button";

export function TaskForm({ groupId }: { groupId: string }) {
  const [state, action] = useActionState(createGroupTask, IDLE);

  return (
    <form
      action={action}
      className="flex flex-col gap-4 rounded-2xl border border-ivory/15 bg-indigo-900/30 p-5"
      noValidate
    >
      <h3 className="font-display text-lg text-ivory">Add a task</h3>
      <input type="hidden" name="groupId" value={groupId} />
      <FormError message={state.message} />

      <Field id="task-title" label="What needs doing" error={state.errors?.title}>
        {(props) => (
          <input {...props} name="title" type="text" className={inputClass} />
        )}
      </Field>

      <Field id="task-dueOn" label="Due" optional error={state.errors?.dueOn}>
        {(props) => (
          <input {...props} name="dueOn" type="date" className={inputClass} />
        )}
      </Field>

      <div>
        <SubmitButton variant="secondary" pendingLabel="Adding…">
          Add task
        </SubmitButton>
      </div>
    </form>
  );
}
