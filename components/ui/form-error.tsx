/**
 * The form-level failure notice: a rejected sign-in, a service that did not
 * answer — anything that belongs to the submission rather than to one field.
 *
 * `role="alert"` so it is announced when it appears after a submission, and a
 * glyph beside the text so the state is not carried by colour alone.
 */
export function FormError({ message }: { message?: string }) {
  if (!message) return null;

  return (
    <p
      role="alert"
      className="flex gap-3 rounded-xl border border-sunset/40 bg-sunset/10 px-4 py-3 text-sm leading-relaxed text-ivory"
    >
      <span aria-hidden="true" className="text-sunset">
        !
      </span>
      <span>{message}</span>
    </p>
  );
}
