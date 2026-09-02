"use client";

import { useActionState } from "react";
import { EXAMPLE_TRIP } from "@/lib/mock-data";
import {
  joinWaitlist,
  type WaitlistState,
} from "@/lib/waitlist/actions";

/**
 * Phase 0 conversion surface.
 *
 * Joining the waitlist does not create an account. The server action writes
 * through the anon role, whose policy can insert but cannot read the list.
 */
export function Waitlist() {
  const initialState: WaitlistState = { status: "idle" };
  const [state, action, pending] = useActionState(joinWaitlist, initialState);

  return (
    <section id="waitlist" className="scroll-mt-20">
      <div className="mx-auto max-w-content px-5 py-16 sm:px-8 sm:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-label">Early access</p>
          <h2 className="mt-4 font-display text-3xl leading-tight text-ivory sm:text-4xl">
            Put a date on it.
          </h2>
          <p className="mt-5 text-base leading-relaxed text-ivory/70">
            Take Me Home is being built now, starting with{" "}
            {EXAMPLE_TRIP.country} and ten more countries. Join the waitlist and
            we&rsquo;ll tell you when planning opens.
          </p>

          {state.status === "success" ? (
            <p
              role="status"
              className="mt-9 rounded-2xl border border-baobab/40 bg-baobab/10 px-6 py-5 text-base text-ivory"
            >
              <span aria-hidden="true" className="mr-2 text-baobab-light">
                ✓
              </span>
              Thanks — we&rsquo;ve got your address. We&rsquo;ll be in touch when
              Take Me Home opens.
            </p>
          ) : (
            <form
              action={action}
              className="mx-auto mt-9 flex max-w-md flex-col gap-3 sm:flex-row"
            >
              <div className="flex-1 text-left">
                <label htmlFor="waitlist-email" className="sr-only">
                  Email address
                </label>
                <input
                  id="waitlist-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  maxLength={254}
                  defaultValue={state.status === "error" ? state.email : ""}
                  aria-describedby={state.status === "error" ? "waitlist-error" : undefined}
                  placeholder="you@example.com"
                  className="w-full rounded-full border border-ivory/20 bg-indigo-900/70 px-5 py-3 text-base text-ivory placeholder:text-muted focus-visible:border-sunset"
                />
              </div>
              <button
                type="submit"
                disabled={pending}
                className="rounded-full bg-sunset px-6 py-3 text-base font-medium text-indigo-950 transition-colors hover:bg-sunset/90"
              >
                {pending ? "Joining…" : "Join the waitlist"}
              </button>
            </form>
          )}

          {state.status === "error" ? (
            <p id="waitlist-error" role="alert" className="mt-3 text-sm text-sunset">
              {state.message}
            </p>
          ) : null}

          <p className="mt-5 text-xs leading-relaxed text-muted">
            We&rsquo;ll only email you about Take Me Home. Joining the waitlist
            doesn&rsquo;t create an account.
          </p>
        </div>
      </div>
    </section>
  );
}
