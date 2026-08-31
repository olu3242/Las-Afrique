import type {
  ReferralInvitationRow,
  ReferralRow,
  ReferralState,
} from "@/lib/supabase/types";

/**
 * What a referrer is shown, and the boundary that decides it.
 *
 * The engine's privacy rule in one place: a referrer learns three things and
 * no more —
 *
 *   1. that an address they themselves invited reached a status,
 *   2. that a link of theirs was used by somebody, with a status,
 *   3. counts over their own referrals.
 *
 * Everything else about the referred person — who they are when the referrer
 * did not name them, their trip, dates, documents, budget, readiness, anything
 * behavioural — is refused here as well as by the policies. This module takes
 * database rows in and returns a view that structurally cannot carry any of it:
 * the referred user's id never reaches the output type, so a component cannot
 * render it and a later change cannot leak it by accident.
 *
 * `INVITED` is composed rather than stored. A `referrals` row means a signup
 * happened, so the invited step lives on the invitation — a pending invitation
 * with nothing attributed to it yet. Storing `invited` as a fourth value of
 * `referral_state` would have created an enum value the table can never hold.
 */

export type ReferralStatus = "invited" | "joined" | "qualified" | "disqualified";

export interface ReferrerVisibleReferral {
  /** Opaque list key. Never the referred user's id. */
  key: string;
  status: ReferralStatus;
  /**
   * The address the referrer themselves typed, and only that.
   *
   * Null when a link was shared rather than a person invited — the referrer
   * did not name that address, so the engine will not name it for them. This
   * is the difference between "you invited Ama and she joined", which the
   * referrer already knew half of, and telling someone who used a link they
   * posted in a group chat.
   */
  invitedAddress: string | null;
  /** When it reached this status. */
  at: string;
}

export interface ReferralSummary {
  referrals: ReferrerVisibleReferral[];
  counts: Record<ReferralStatus, number>;
  /** Invitations that lapsed or were withdrawn. A count, not a list. */
  lapsedCount: number;
}

function statusFrom(state: ReferralState): ReferralStatus {
  return state;
}

function statusTime(row: ReferralRow): string {
  if (row.state === "qualified") return row.qualified_at ?? row.attributed_at;
  if (row.state === "disqualified") {
    return row.disqualified_at ?? row.attributed_at;
  }
  return row.attributed_at;
}

/**
 * Compose the referrer's list from their own invitations and their own
 * attributed referrals.
 *
 * Both inputs are already scoped by RLS to this referrer; nothing here
 * re-filters by user, because a second ownership check in application code is
 * a second source of truth and the one that drifts is always this one.
 */
export function summariseOwnReferrals(input: {
  invitations: ReferralInvitationRow[];
  referrals: ReferralRow[];
}): ReferralSummary {
  const addressByInvitation = new Map(
    input.invitations.map((i) => [i.id, i.email]),
  );

  const attributed: ReferrerVisibleReferral[] = input.referrals.map((row) => ({
    key: row.id,
    status: statusFrom(row.state),
    invitedAddress: row.invitation_id
      ? addressByInvitation.get(row.invitation_id) ?? null
      : null,
    at: statusTime(row),
  }));

  // An invitation that has been attributed is represented by its referral, not
  // twice. `attribute_referral` marks it accepted in the same statement that
  // writes the referral, so the state alone would usually do — but a referral
  // pointing at it is the stronger signal, and checking both means a row that
  // somehow missed the state change shows up once rather than twice.
  const attributedInvitations = new Set(
    input.referrals.map((r) => r.invitation_id).filter(Boolean),
  );

  const pending = input.invitations
    .filter((i) => i.state === "pending" && !attributedInvitations.has(i.id))
    .map((i) => ({
      key: i.id,
      status: "invited" as const,
      invitedAddress: i.email,
      at: i.created_at,
    }));

  const referrals = [...attributed, ...pending].sort((a, b) =>
    b.at.localeCompare(a.at),
  );

  const counts: Record<ReferralStatus, number> = {
    invited: 0,
    joined: 0,
    qualified: 0,
    disqualified: 0,
  };
  for (const row of referrals) counts[row.status] += 1;

  const lapsedCount = input.invitations.filter(
    (i) => i.state === "revoked" || i.state === "expired",
  ).length;

  return { referrals, counts, lapsedCount };
}

/**
 * Copy for a status, paired with a glyph.
 *
 * State is never conveyed by colour alone — the same rule `lib/readiness.ts`
 * follows, and the reason this returns a label and a mark rather than a class
 * name.
 */
export const REFERRAL_STATUS_LABELS: Record<
  ReferralStatus,
  { label: string; glyph: string; detail: string }
> = {
  invited: {
    label: "Invited",
    glyph: "○",
    detail: "Sent. Nothing has been attributed to it yet.",
  },
  joined: {
    label: "Joined",
    glyph: "◐",
    detail: "An account was created and attributed to your link.",
  },
  qualified: {
    label: "Qualified",
    glyph: "●",
    detail: "The programme's condition was met.",
  },
  disqualified: {
    label: "Not counted",
    glyph: "×",
    detail: "This referral was reversed. The record is kept.",
  },
};
