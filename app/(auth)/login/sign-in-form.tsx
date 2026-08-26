"use client";

import { useActionState } from "react";
import { signIn } from "@/lib/auth/actions";
import { IDLE } from "@/lib/forms";
import { Field, inputClass } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { SubmitButton } from "@/components/ui/submit-button";

export function SignInForm({ next }: { next: string }) {
  const [state, action] = useActionState(signIn, IDLE);

  return (
    <form action={action} className="mt-8 flex flex-col gap-5" noValidate>
      <input type="hidden" name="next" value={next} />
      <FormError message={state.message} />

      <Field id="email" label="Email address" error={state.errors?.email}>
        {(props) => (
          <input
            {...props}
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={state.values?.email}
            className={inputClass}
          />
        )}
      </Field>

      <Field id="password" label="Password" error={state.errors?.password}>
        {(props) => (
          <input
            {...props}
            name="password"
            type="password"
            autoComplete="current-password"
            className={inputClass}
          />
        )}
      </Field>

      <div className="mt-2">
        <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
      </div>
    </form>
  );
}
