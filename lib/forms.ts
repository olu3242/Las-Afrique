import type { FieldErrors } from "@/lib/trips/validation";

/**
 * What every form server action returns.
 *
 * One shape for auth, trip intake and travellers, so the form components that
 * render errors are written once. `errors` is keyed by field so a message can
 * sit beside the control it belongs to rather than in a heap at the top —
 * `message` carries the failures that belong to no single field (a rejected
 * sign-in, a service that did not answer).
 */
export type ActionState<Field extends string = string> = {
  status: "idle" | "error";
  message?: string;
  errors?: FieldErrors<Field>;
  /**
   * What the user typed, echoed back so a failed submission does not empty the
   * form. Never includes a password.
   *
   * Bound through `useFormValues` rather than passed as `defaultValue`.
   * React 19 resets an uncontrolled form after its action runs; inputs survive
   * that, but a `<select>` reverts to its mount-time default — which silently
   * cleared the destination country on any trip that failed validation on some
   * other field.
   */
  values?: Partial<Record<Field, string>>;
};

export const IDLE: ActionState = { status: "idle" };

/** Reads a form field as a trimmed string, or null when absent or blank. */
export function field(form: FormData, name: string): string | null {
  const value = form.get(name);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
