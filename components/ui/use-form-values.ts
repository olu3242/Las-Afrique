"use client";

import { useEffect, useState, type ChangeEvent } from "react";

/**
 * Keeps what the user typed across a failed submission.
 *
 * React 19 resets an uncontrolled form once its action completes. For an
 * `<input>` that is harmless — React re-syncs the `defaultValue` property on
 * re-render, so the reset restores the value the server just echoed back.
 * Verified in a browser: an email survives a failed sign-in with nothing but
 * `defaultValue`.
 *
 * A `<select>` is the exception. React applies `defaultValue` to a select by
 * marking the matching option selected at mount and does not re-apply it
 * afterwards, so the reset returns the select to its *original* default. That
 * is what the hosted run caught: a trip whose only invalid field was the
 * departure date came back with the destination country silently cleared, and
 * the next submission was refused for a field the user had already chosen.
 *
 * Everything is bound through here rather than only the selects. The asymmetry
 * is the hazard — a form where some fields need this and others do not is one
 * where the next field added gets it wrong.
 *
 * Controlled rather than re-keyed on purpose. Remounting the form would also
 * restore the values, but it throws away focus and scroll position at exactly
 * the moment the user is being asked to correct something.
 */
export function useFormValues<F extends string>(
  values: Partial<Record<F, string>> | undefined,
) {
  const [current, setCurrent] = useState<Partial<Record<F, string>>>(
    values ?? {},
  );

  // Re-seed whenever the action returns. `values` is a new object per action
  // result, so this fires once per submission rather than on every render.
  useEffect(() => {
    setCurrent(values ?? {});
  }, [values]);

  return {
    /** Spread onto an input or select to make it controlled. */
    bind(name: F) {
      return {
        value: current[name] ?? "",
        onChange(
          event: ChangeEvent<
            HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
          >,
        ) {
          const next = event.target.value;
          setCurrent((prev) => ({ ...prev, [name]: next }));
        },
      };
    },
  };
}
