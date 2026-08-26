"use client";

import { useActionState } from "react";
import { signUp, type AuthField } from "@/lib/auth/actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/policy";
import { IDLE } from "@/lib/forms";
import { Field, inputClass } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { SubmitButton } from "@/components/ui/submit-button";
import { useFormValues } from "@/components/ui/use-form-values";

export function SignUpForm({ next }: { next: string }) {
  const [state, action] = useActionState(signUp, IDLE);
  const { bind } = useFormValues<AuthField>(state.values);

  return (
    <form action={action} className="mt-8 flex flex-col gap-5" noValidate>
      <input type="hidden" name="next" value={next} />
      <FormError message={state.message} />

      <Field
        id="displayName"
        label="Your name"
        optional
        error={state.errors?.displayName}
      >
        {(props) => (
          <input
            {...props}
            name="displayName"
            type="text"
            autoComplete="name"
            {...bind("displayName")}
            className={inputClass}
          />
        )}
      </Field>

      <Field id="email" label="Email address" error={state.errors?.email}>
        {(props) => (
          <input
            {...props}
            name="email"
            type="email"
            autoComplete="email"
            {...bind("email")}
            className={inputClass}
          />
        )}
      </Field>

      <Field
        id="password"
        label="Password"
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        error={state.errors?.password}
      >
        {(props) => (
          <input
            {...props}
            name="password"
            type="password"
            autoComplete="new-password"
            className={inputClass}
          />
        )}
      </Field>

      <div className="mt-2">
        <SubmitButton pendingLabel="Creating your account…">
          Create account
        </SubmitButton>
      </div>
    </form>
  );
}
