import type { ReactNode } from "react";

/**
 * A labelled form control with its error message.
 *
 * Exists so the accessibility wiring is done once rather than per form: every
 * control gets a real `<label>`, and an invalid one is marked `aria-invalid`
 * and pointed at its message with `aria-describedby`. A screen reader reaches
 * the same information a sighted user gets from the red text.
 *
 * The message is passed in — this component never decides what is valid. The
 * rules live in `lib/trips/validation.ts` and run on the server.
 */
export function Field({
  id,
  label,
  hint,
  error,
  optional,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  children: (props: {
    id: string;
    "aria-invalid"?: true;
    "aria-describedby"?: string;
  }) => ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium text-ivory">
        {label}
        {optional ? (
          <span className="ml-2 text-xs font-normal text-muted">Optional</span>
        ) : null}
      </label>

      {hint ? (
        <p id={hintId} className="text-xs leading-relaxed text-muted">
          {hint}
        </p>
      ) : null}

      {children({
        id,
        ...(error ? { "aria-invalid": true as const } : {}),
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
      })}

      {error ? (
        // Paired with a glyph, not colour alone.
        <p id={errorId} className="flex gap-2 text-sm text-sunset">
          <span aria-hidden="true">!</span>
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

/** Shared input styling, so every control in the product looks like one product. */
export const inputClass =
  "w-full rounded-xl border border-ivory/20 bg-indigo-900/70 px-4 py-3 text-base text-ivory placeholder:text-muted focus-visible:border-sunset aria-[invalid]:border-sunset";
