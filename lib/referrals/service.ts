import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { codeFromBytes } from "./attribution";
import { buildReferralEvent, nullEventSink } from "./events";
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

/**
 * The caller's code for the programme in force, minting one if they have none.
 *
 * Idempotent by construction: `(user_id, program_key)` is unique, so two
 * concurrent requests cannot mint two codes — the loser's insert is refused
 * and it reads the winner's row.
 *
 * Lives here rather than in the action, and that is the whole point. The
 * referrals page needs a code to exist before it can render one, so it calls
 * this during render — and a server action cannot be called during render,
 * because `revalidatePath` is unsupported there. That is not a style
 * preference: it returns a 500.
 *
 * A hosted run found it the hard way. The action revalidated only on the
 * branch that actually minted, so the page worked for anyone who already had
 * a code and returned 500 to every user on their first visit — which is
 * exactly the case the three browser journeys exercised, and the only case a
 * developer with an existing code would never see.
 *
 * So the mutation lives in the service, where render may call it, and the
 * action is a thin wrapper that adds the revalidation for callers that are
 * not a render.
 */
export async function ensureOwnReferralCode(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const program = await currentProgram();
  if (!program) return null;

  const { data: existing } = await supabase
    .from("referral_codes")
    .select("code")
    .eq("program_key", program.key)
    .maybeSingle();
  if (existing) return existing.code;

  const code = codeFromBytes(randomBytes(16));
  const { error } = await supabase.from("referral_codes").insert({
    user_id: user.id,
    program_key: program.key,
    code,
  });

  if (error) {
    // Either the race above or a collision on the code's unique index. Both
    // are answered by reading rather than by retrying blindly.
    const { data: after } = await supabase
      .from("referral_codes")
      .select("code")
      .eq("program_key", program.key)
      .maybeSingle();
    return after?.code ?? null;
  }

  nullEventSink.record(
    buildReferralEvent({
      name: "referral.code_created",
      programKey: program.key,
      actorRef: actorRef(user.id),
      at: new Date(),
    }),
  );

  return code;
}

export async function getReferralOverview(): Promise<ReferralOverview> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Minted here rather than by the page calling an action: see
  // `ensureOwnReferralCode`. A render may not call a server action.
  await ensureOwnReferralCode();

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
