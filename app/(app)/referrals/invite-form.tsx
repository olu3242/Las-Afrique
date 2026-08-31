"use client";

import { useActionState } from "react";
import { inviteByEmail, type InviteResult } from "@/lib/referrals/actions";
import { Field, inputClass } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { SubmitButton } from "@/components/ui/submit-button";
import { useFormValues } from "@/components/ui/use-form-values";

const IDLE: InviteResult = { status: "idle" };

export function ReferralInviteForm() {
  const [state, action] = useActionState(inviteByEmail, IDLE);
  const values = useFormValues(state.values);

  return (
    <form
      action={action}
      className="flex flex-col gap-4 rounded-2xl border border-ivory/15 bg-indigo-900/30 p-5"
      noValidate
    >
      <h2 className="font-display text-lg text-ivory">Invite someone</h2>
      <p className="text-sm leading-relaxed text-muted">
        They will see your invitation, not your account. You will see whether
        they joined — never anything about their trip.
      </p>

      <FormError message={state.message} />

      <Field id="referral-email" label="Email address" error={state.errors?.email}>
        {(props) => (
          <input
            {...props}
            name="email"
            type="email"
            autoComplete="off"
            {...values.bind("email")}
            className={inputClass}
          />
        )}
      </Field>

      <div>
        <SubmitButton variant="secondary" pendingLabel="Creating…">
          Create invitation
        </SubmitButton>
      </div>

      {state.link ? (
        <div className="rounded-xl border border-baobab/40 bg-baobab/10 px-4 py-3">
          <p className="text-sm text-baobab-light">
            <span aria-hidden="true">✓</span> Invitation created. Send them this
            link — it is shown once.
          </p>
          {/*
            Rendered as text rather than an anchor. The token is a credential:
            a link the referrer can click by accident would consume their own
            invitation, and a prefetch would do it without a click.
          */}
          <p className="mt-2 break-all text-data text-xs text-ivory/80">
            {state.link}
          </p>
        </div>
      ) : null}
    </form>
  );
}
