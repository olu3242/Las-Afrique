"use client";

import { useActionState } from "react";
import { uploadDocument } from "@/lib/vault/actions";
import { IDLE } from "@/lib/forms";
import { Field, inputClass } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { SubmitButton } from "@/components/ui/submit-button";
import { ALLOWED_MIME_TYPES } from "@/lib/vault/constants";

export function UploadForm({ tripId }: { tripId: string | null }) {
  const [state, action] = useActionState(uploadDocument, IDLE);

  return (
    <form
      action={action}
      className="flex flex-col gap-4 rounded-2xl border border-ivory/15 bg-indigo-900/30 p-5"
      noValidate
    >
      <h3 className="font-display text-lg text-ivory">Add a document</h3>
      {tripId ? <input type="hidden" name="tripId" value={tripId} /> : null}
      <FormError message={state.message} />

      <Field
        id="file"
        label="File"
        hint="A PDF or a photo, up to 15 MB."
        error={state.errors?.file}
      >
        {(props) => (
          <input
            {...props}
            name="file"
            type="file"
            accept={ALLOWED_MIME_TYPES.join(",")}
            className={inputClass}
          />
        )}
      </Field>

      <div>
        <SubmitButton variant="secondary" pendingLabel="Uploading…">
          Upload
        </SubmitButton>
      </div>
    </form>
  );
}
