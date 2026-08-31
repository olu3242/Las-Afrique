import type { FieldErrors } from "@/lib/trips/validation";
import { isSameAddress } from "./attribution";

/**
 * Referral input validation. Pure, and the only place these rules live.
 *
 * Same shape as `lib/groups/validation.ts`: the action calls it and the form
 * renders what it returns, so a rule cannot be enforced in one place and
 * forgotten in the other.
 *
 * Nothing here is the enforcement. Self-referral is refused inside
 * `attribute_referral` against the caller's verified identity, the rate limit
 * is a database trigger, and a duplicate invitation is a unique index. These
 * checks exist so a person sees a sentence instead of a constraint name.
 */

export type InviteField = "email";

/** A plausible address, checked structurally. Delivery proves the rest. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Whether a submission is worth spending rate-limit allowance on.
 *
 * The approved limit counts *attempts*, including refused ones, so that
 * probing cannot be free. But a blank field or a typo is not probing, and
 * burning someone's hourly allowance on a mistyped address would make an
 * anti-abuse ceiling into a usability trap.
 *
 * So the line is drawn here: anything that could plausibly reach the database
 * and be refused there — a well-formed address, including one's own — counts.
 * Anything the form itself rejects without asking the database does not.
 */
export function isPlausibleEmail(value: string | null): boolean {
  return typeof value === "string" && value.length <= 254 && EMAIL.test(value);
}

export function validateReferralInvite(input: {
  email: string | null;
  /** The signed-in referrer's own address, to catch the obvious case early. */
  ownEmail: string | null;
}): FieldErrors<InviteField> {
  const errors: FieldErrors<InviteField> = {};

  if (!input.email) {
    errors.email = "Enter an email address.";
    return errors;
  }

  if (!EMAIL.test(input.email)) {
    errors.email = "That does not look like an email address.";
    return errors;
  }

  if (input.email.length > 254) {
    errors.email = "That address is too long.";
    return errors;
  }

  // Said plainly rather than as a policy refusal after the fact. The database
  // refuses it too, under a normalisation this mirrors — a plus-tag on your
  // own address is still your own address.
  if (input.ownEmail && isSameAddress(input.email, input.ownEmail)) {
    errors.email = "That is your own address.";
  }

  return errors;
}
