/**
 * Referral analytics — shape only.
 *
 * No analytics destination exists in this codebase, and the approved scope
 * settled that by approving what was documented: §10 defines event shapes and
 * names no sink. So this module defines the events and ships a sink that
 * discards them. Nothing is sent anywhere.
 *
 * That is not a stub standing in for a dependency that exists — the
 * distinction the iteration standard draws. There is no analytics service to
 * mock. When one is chosen, it implements `ReferralEventSink` and the shape
 * below is already fixed.
 *
 * The rule that governs all of them
 * ---------------------------------
 * An analytics event may not become a side channel around the privacy
 * boundary. An event carries a pseudonymous actor reference and the programme
 * key. It never carries the referred user's trip, readiness or behaviour, and
 * it is never delivered to the referrer. `assertNoLeak` enforces that on the
 * payload rather than trusting each call site, because the leak this guards
 * against is the one somebody adds later "just for debugging".
 */

export type ReferralEventName =
  | "referral.code_created"
  | "referral.link_resolved"
  | "referral.signup_attributed"
  | "referral.qualified"
  | "referral.disqualified"
  | "referral.entitlement_earned";

export interface ReferralEvent {
  name: ReferralEventName;
  /** ISO 8601. */
  at: string;
  programKey: string;
  /**
   * Pseudonymous. A one-way reference minted by the service, never a user id,
   * an email address, or anything that resolves to a person without the
   * database.
   */
  actorRef: string;
}

/**
 * Keys that must never appear on a referral event, matched case-insensitively
 * against the whole payload.
 *
 * Two families: anything that identifies a person directly, and anything from
 * the referred user's own records. Both would turn a metrics pipeline into the
 * disclosure §5 refuses.
 */
const FORBIDDEN_KEY = new RegExp(
  [
    "email",
    "user_?id",
    "referred",
    "referrer_?id",
    "trip",
    "destination",
    "depart",
    "return",
    "traveler",
    "traveller",
    "passport",
    "document",
    "vault",
    "budget",
    "estimate",
    "savings",
    "readiness",
    "code$",
    "token",
  ].join("|"),
  "i",
);

/** The complete set of keys an event may carry. Nothing else passes. */
const PERMITTED_KEYS = new Set(["name", "at", "programKey", "actorRef"]);

/**
 * Refuse a payload that carries anything it should not.
 *
 * An allow-list, not a block-list: the next field somebody adds is refused by
 * default rather than only if it happens to resemble one of the names below.
 * `FORBIDDEN_KEY` exists to say *why* when the added field is one of the
 * obviously disclosing ones, because "email is not allowed on an analytics
 * event" is a more useful failure than "unexpected key".
 *
 * Throws rather than filtering. A silently stripped field looks like it was
 * delivered, and the next person adds it back.
 */
export function assertNoLeak(event: ReferralEvent): void {
  for (const key of Object.keys(event)) {
    if (PERMITTED_KEYS.has(key)) continue;
    if (FORBIDDEN_KEY.test(key)) {
      throw new Error(
        `referral event may not carry "${key}" — it would disclose the referred user`,
      );
    }
    throw new Error(`referral event may not carry an unrecognised key "${key}"`);
  }
}

export function buildReferralEvent(input: {
  name: ReferralEventName;
  programKey: string;
  actorRef: string;
  at: Date;
}): ReferralEvent {
  const event: ReferralEvent = {
    name: input.name,
    at: input.at.toISOString(),
    programKey: input.programKey,
    actorRef: input.actorRef,
  };
  assertNoLeak(event);
  return event;
}

export interface ReferralEventSink {
  record(event: ReferralEvent): void;
}

/**
 * The sink in force: none.
 *
 * It validates and discards. Keeping the call sites live against a discarding
 * sink means the events are exercised by the suite, so choosing a destination
 * later is a wiring change rather than an untested new code path.
 */
export const nullEventSink: ReferralEventSink = {
  record(event) {
    assertNoLeak(event);
  },
};
