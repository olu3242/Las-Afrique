/**
 * Auth rules that are not server actions.
 *
 * Split out because a `"use server"` file may only export async functions —
 * everything it exports becomes a callable server endpoint, so a constant or a
 * sync helper cannot live there. These are plain values, imported by both the
 * actions and the pages that render them.
 */

/**
 * Supabase's own default minimum is 6. Eight is this product's floor, checked
 * before the round trip so the user is told by the form rather than by GoTrue's
 * message afterwards. Supabase still enforces its own — this does not replace
 * it.
 */
export const MIN_PASSWORD_LENGTH = 8;

/** Where a signed-in user lands when no return path was requested. */
export const DEFAULT_DESTINATION = "/dashboard";

/**
 * Only same-origin paths are honoured as a post-sign-in destination.
 *
 * `?next=` comes from the URL, so it is attacker-controllable: without this a
 * link to /login?next=https://elsewhere.example would bounce a freshly
 * signed-in user off-site. A leading `//` is rejected too — the browser reads
 * `//host` as protocol-relative and leaves the origin. So is a backslash, which
 * some browsers normalise to a forward slash before parsing.
 */
export function safeDestination(next: string | null | undefined): string {
  if (!next) return DEFAULT_DESTINATION;
  if (!next.startsWith("/")) return DEFAULT_DESTINATION;
  if (next.startsWith("//") || next.startsWith("/\\")) return DEFAULT_DESTINATION;
  return next;
}
