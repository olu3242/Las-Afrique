"use client";

import { useFormStatus } from "react-dom";

/**
 * Submit button that reports its own pending state.
 *
 * `useFormStatus` reads the enclosing form, so this stays a leaf client
 * component and the form itself does not need to become one.
 *
 * Disabled while pending to stop a double submission, and the label changes
 * with it — a spinner alone leaves a screen-reader user with a button whose
 * name never changed.
 */
export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
}: {
  children: React.ReactNode;
  pendingLabel: string;
  variant?: "primary" | "secondary";
}) {
  const { pending } = useFormStatus();

  const base =
    "inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-70";
  const styles =
    variant === "primary"
      ? "bg-sunset text-indigo-950 hover:bg-sunset/90"
      : "border border-ivory/25 text-ivory hover:border-ivory/50";

  return (
    <button type="submit" disabled={pending} className={`${base} ${styles}`}>
      {pending ? pendingLabel : children}
    </button>
  );
}
