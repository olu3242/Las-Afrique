import "server-only";

import { createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import type {
  ReferralCodeRow,
  ReferralInvitationRow,
  ReferralProgramRow,
  ReferralRow,
  RewardEntitlementRow,
} from "@/lib/supabase/types";
import { summariseOwnReferrals, type ReferralSummary } from "./lifecycle";

/**
 * Referral reads.
 *
 * Everything goes through `lib/supabase/server.ts`, so RLS is the filter and
 * no query here writes its own ownership predicate to forget later. A caller
 * who is neither party to a referral gets an empty result from the database,
 * not from a check in this file.
 *
 * What is deliberately absent
 * ---------------------------
 * There is no read of the referred user's trip, travellers, documents, budget,
 * vault or readiness, and no function here that could be extended into one
 * without adding a table name that is currently nowhere in this module. That
 * is the boundary from Iteration 11, inherited: the referrer gets a status,
 * and the status is all there is to get.
 */

export interface ReferralOverview {
  program: ReferralProgramRow | null;
  code: ReferralCodeRow | null;
  summary: ReferralSummary;
  entitlements: RewardEntitlementRow[];
  /** The referral this user is the *subject* of, if any. Their own record. */
  ownAttribution: ReferralRow | null;
}

/**
 * The programme in force.
 *
 * Exactly one row has a null `effective_to` — a partial unique index enforces
 * it — so "the current programme" is a lookup rather than a judgement about
 * which of several overlapping rows applies.
 */
export async function currentProgram(): Promise<ReferralProgramRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("referral_programs")
    .select("*")
    .is("effective_to", null)
    .maybeSingle();
  return (data as ReferralProgramRow | null) ?? null;
}

/** A pseudonymous, stable reference for analytics. Never a user id. */
export function actorRef(userId: string): string {
  return createHash("sha256").update(`referral:${userId}`).digest("hex").slice(0, 32);
}

export async function getReferralOverview(): Promise<ReferralOverview> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const program = await currentProgram();

  if (!user) {
    return {
      program,
      code: null,
      summary: { referrals: [], counts: { invited: 0, joined: 0, qualified: 0, disqualified: 0 }, lapsedCount: 0 },
      entitlements: [],
      ownAttribution: null,
    };
  }

  const [codeResult, invitationResult, referralResult, entitlementResult, ownResult] =
    await Promise.all([
      supabase.from("referral_codes").select("*").maybeSingle(),
      supabase
        .from("referral_invitations")
        .select("*")
        .order("created_at", { ascending: false }),
      // As the referrer. RLS also returns the row where this user is the
      // referred party, so it is filtered by column here — not for security,
      // which the policy already provides, but because the two mean different
      // things on screen and must not be mixed into one list.
      supabase
        .from("referrals")
        .select("*")
        .eq("referrer_id", user.id)
        .order("attributed_at", { ascending: false }),
      supabase
        .from("reward_entitlements")
        .select("*")
        .order("earned_at", { ascending: false }),
      supabase
        .from("referrals")
        .select("*")
        .eq("referred_user_id", user.id)
        .maybeSingle(),
    ]);

  const invitations = (invitationResult.data as ReferralInvitationRow[] | null) ?? [];
  const referrals = (referralResult.data as ReferralRow[] | null) ?? [];

  return {
    program,
    code: (codeResult.data as ReferralCodeRow | null) ?? null,
    summary: summariseOwnReferrals({ invitations, referrals }),
    entitlements: (entitlementResult.data as RewardEntitlementRow[] | null) ?? [],
    ownAttribution: (ownResult.data as ReferralRow | null) ?? null,
  };
}
