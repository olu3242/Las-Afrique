"use client";

import { useActionState } from "react";
import { updateOwnMembership } from "@/lib/groups/actions";
import { IDLE } from "@/lib/forms";
import { Field, inputClass } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { SubmitButton } from "@/components/ui/submit-button";
import type { GroupMembershipRow } from "@/lib/supabase/types";

/**
 * What this member shares with the group.
 *
 * The readiness checkbox is the consent itself, and it is off until turned on.
 * Nobody else can move it — not a coordinator, not the group's owner — because
 * a database trigger reverts any attempt, and the RLS suite proves it does.
 */
export function OwnMembershipForm({
  groupId,
  membership,
}: {
  groupId: string;
  membership: GroupMembershipRow;
}) {
  const [state, action] = useActionState(updateOwnMembership, IDLE);

  return (
    <form
      action={action}
      className="flex flex-col gap-5 rounded-2xl border border-ivory/15 bg-indigo-900/30 p-5"
      noValidate
    >
      <input type="hidden" name="groupId" value={groupId} />
      <FormError message={state.message} />

      <Field
        id="displayName"
        label="What the group calls you"
        optional
        error={state.errors?.displayName}
      >
        {(props) => (
          <input
            {...props}
            name="displayName"
            type="text"
            defaultValue={membership.display_name ?? ""}
            className={inputClass}
          />
        )}
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id="arrivalOn"
          label="You arrive"
          optional
          error={state.errors?.arrivalOn}
        >
          {(props) => (
            <input
              {...props}
              name="arrivalOn"
              type="date"
              defaultValue={membership.arrival_on ?? ""}
              className={inputClass}
            />
          )}
        </Field>

        <Field
          id="departureOn"
          label="You leave"
          optional
          error={state.errors?.departureOn}
        >
          {(props) => (
            <input
              {...props}
              name="departureOn"
              type="date"
              defaultValue={membership.departure_on ?? ""}
              className={inputClass}
            />
          )}
        </Field>
      </div>

      {/*
        What the group currently sees about you.
        
        A member could set a sharing switch and had no way to see its effect —
        they were asked to consent to a disclosure whose content was invisible
        to them, which is a poor thing to ask. Now the exact word the group
        reads is shown back, including when there is not one yet.
      */}
      <p
        className="rounded-xl border border-ivory/15 bg-indigo-800/30 px-4 py-3 text-sm leading-relaxed text-muted"
        data-testid="own-published-state"
      >
        {membership.shares_readiness ? (
          membership.coordination_state ? (
            <>
              The group sees:{" "}
              <span className="text-data text-ivory">
                {membership.coordination_state.replace(/_/g, " ")}
              </span>
            </>
          ) : (
            <>
              The group sees nothing yet. Link a trip that has a traveller on
              it, and your readiness becomes something we can summarise.
            </>
          )
        ) : (
          <>You are sharing nothing with this group.</>
        )}
      </p>

      <div className="flex items-start gap-3 rounded-xl border border-ivory/15 bg-indigo-800/30 px-4 py-3.5">
        <input
          id="sharesReadiness"
          name="sharesReadiness"
          type="checkbox"
          defaultChecked={membership.shares_readiness}
          className="mt-1 h-5 w-5 shrink-0 rounded border-ivory/30 bg-indigo-950"
        />
        <label htmlFor="sharesReadiness" className="text-sm leading-relaxed text-ivory">
          Share my readiness with this group
          <span className="mt-1 block text-muted">
            The group sees one word — ready, or action required. It never sees
            your documents, your dates, your budget, or what is outstanding.
            Turning this off removes what was shared.
          </span>
        </label>
      </div>

      <div>
        <SubmitButton variant="secondary" pendingLabel="Saving…">
          Save
        </SubmitButton>
      </div>
    </form>
  );
}
