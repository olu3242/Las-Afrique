/**
 * Attribution arithmetic and the shareable string.
 *
 * Pure and deterministic — nothing here reads a clock or a database of its
 * own. The window check takes `now` as an argument for the same reason the
 * readiness engine does: a rule you cannot evaluate at an arbitrary instant is
 * a rule you cannot test at the boundary where it matters.
 *
 * `normaliseEmail` is a deliberate duplicate of `public.normalise_email` in
 * migration 0012. Two copies of a rule is normally a defect, and it would be
 * one here if they could disagree silently — so `tests/referral-rls.test.ts`
 * runs the same fixtures through both and fails if they diverge. The
 * duplication buys the form a same-address warning before submit, without a
 * round trip, and the database keeps the copy that actually enforces it.
 */

/**
 * Characters a code is built from.
 *
 * No 0/O, no 1/I/L. A referral code gets read aloud, written on paper and
 * typed back in by someone who did not choose it; a pair that looks identical
 * in a sans-serif font turns an attribution into a support conversation.
 */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export const CODE_LENGTH = 10;

/** The shape migration 0012's check constraint accepts. */
export const CODE_PATTERN = /^[A-Z0-9]{8,16}$/;

/**
 * Build a code from caller-supplied randomness.
 *
 * Randomness is a parameter rather than a `crypto` call inside, so the mapping
 * from bytes to characters is testable and the module stays free of Node
 * built-ins that would bar it from a client component.
 */
export function codeFromBytes(bytes: Uint8Array): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    // Modulo bias across 31 symbols in a 256-value byte is under 1% and does
    // not weaken a code whose only job is to be unguessable enough that
    // enumeration is pointless; uniqueness is enforced by the schema.
    code += CODE_ALPHABET[(bytes[i] ?? 0) % CODE_ALPHABET.length];
  }
  return code;
}

export function isWellFormedCode(value: string): boolean {
  return CODE_PATTERN.test(value.toUpperCase());
}

/** Providers that treat a dot in the local part as insignificant. */
const DOT_INSENSITIVE_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/**
 * One definition of "the same address".
 *
 * Plus-addressing is stripped everywhere: every major provider treats it as a
 * tag on one mailbox. Dots are stripped only where the provider genuinely
 * ignores them — doing it universally would merge two distinct mailboxes
 * elsewhere, which is a worse error than missing a duplicate.
 */
export function normaliseEmail(address: string): string {
  const trimmed = address.trim().toLowerCase();
  const at = trimmed.indexOf("@");
  if (at < 1) return trimmed;

  const domain = trimmed.slice(at + 1);
  let local = trimmed.slice(0, at);

  const plus = local.indexOf("+");
  if (plus > -1) local = local.slice(0, plus);

  if (DOT_INSENSITIVE_DOMAINS.has(domain)) local = local.split(".").join("");

  return `${local}@${domain}`;
}

export function isSameAddress(a: string, b: string): boolean {
  return normaliseEmail(a) === normaliseEmail(b);
}

const DAY_MS = 86_400_000;

/**
 * Whether a touch still counts.
 *
 * A touch in the future is clamped rather than refused, matching
 * `attribute_referral`: the timestamp comes from the visitor's own cookie, so
 * it is untrusted, and clamping means a forged one buys no extension of the
 * window instead of buying an error page.
 */
export function isTouchWithinWindow(
  touchedAt: Date,
  now: Date,
  windowDays: number,
): boolean {
  const touch = Math.min(touchedAt.getTime(), now.getTime());
  return now.getTime() - touch <= windowDays * DAY_MS;
}

/**
 * What a resolved link leaves behind on the visitor's own device.
 *
 * Last touch within the window is the approved attribution model, and this is
 * where it is implemented: one value, overwritten by each resolution. There is
 * no server-side touch table, so a signed-out visitor causes no write anywhere
 * — which is also why no referral table grants `anon` anything.
 */
export interface ReferralTouch {
  /** The raw string from the link. Could be a code or an invitation token. */
  candidate: string;
  /** ISO 8601. Untrusted: it lives on the visitor's device. */
  touchedAt: string;
}

export const TOUCH_COOKIE = "tmh_ref";

/** How long the cookie itself lives. Generous; the window is the real rule. */
export const TOUCH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 60;

export function encodeTouch(touch: ReferralTouch): string {
  return JSON.stringify(touch);
}

/**
 * Read a touch back.
 *
 * Returns null for anything that is not a well-formed touch rather than
 * throwing: this parses a cookie any visitor can edit, and a malformed one
 * means "no referral", not "fail the signup".
 */
export function decodeTouch(value: string | undefined): ReferralTouch | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { candidate, touchedAt } = parsed as Record<string, unknown>;
    if (typeof candidate !== "string" || typeof touchedAt !== "string") {
      return null;
    }
    if (candidate.length < 8 || candidate.length > 128) return null;
    if (Number.isNaN(new Date(touchedAt).getTime())) return null;
    return { candidate, touchedAt };
  } catch {
    return null;
  }
}
