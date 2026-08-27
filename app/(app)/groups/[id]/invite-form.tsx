"use client";

import { useActionState } from "react";
import { inviteToGroup } from "@/lib/groups/actions";
import { IDLE } from "@/lib/forms";
import { Field, inputClass } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { SubmitButton } from "@/components/ui/submit-button";
import { GROUP_ROLE_OPTIONS } from "@/lib/groups/validation";

export function InviteForm({ groupId }: { groupId: string }) {
  const [state, action] = useActionState(inviteToGroup, IDLE);

  return (
    <form
      action={action}
      className="flex flex-col gap-4 rounded-2xl border border-ivory/15 bg-indigo-900/30 p-5"
      noValidate
    >
      <h3 className="font-display text-lg text-ivory">Invite someone</h3>
      <input type="hidden" name="groupId" value={groupId} />
      <FormError message={state.message} />

      <Field id="invite-email" label="Email address" error={state.errors?.email}>
        {(props) => (
          <input
            {...props}
            name="email"
            type="email"
            autoComplete="off"
            className={inputClass}
          />
        )}
      </Field>

      <Field id="invite-role" label="Role" error={state.errors?.role}>
        {(props) => (
          <select {...props} name="role" defaultValue="member" className={inputClass}>
            {GROUP_ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )}
      </Field>

      <div>
        <SubmitButton variant="secondary" pendingLabel="Inviting…">
          Send invitation
        </SubmitButton>
      </div>
    </form>
  );
}
