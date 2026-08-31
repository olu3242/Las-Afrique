"use server";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { field, type ActionState } from "@/lib/forms";
import {
  codeFromBytes,
  decodeTouch,
  encodeTouch,
  TOUCH_COOKIE,
  TOUCH_COOKIE_MAX_AGE_SECONDS,
} from "./attribution";
import { buildReferralEvent, nullEventSink } from "./events";
import { actorRef, currentProgram } from "./service";
import { validateReferralInvite, type InviteField } from "./validation";

/**
 * Referral mutations.
 *
 * Same order as every other action here: session → validation → persistence
 * (under RLS) → revalidate. Authorization is never re-implemented; a policy
 * refuses what the caller may not do and this file reports what the database
 * said.
 *
 * Two operations do not follow that pattern, and deliberately.
 * `attributeSignup` and `evaluateQualification` go through security-definer
 * functions, because each has to establish something the caller must not be
 * able to assert:
 *
 *   * which referrer to credit — codes are unreadable to the referred user, so
 *     a direct write would let anyone name anybody and forge the provenance;
 *   * whether the qualifying action actually happened — evaluated inside the
 *     function against the caller's real rows, so it is earned, not claimed.
 *
 * The plaintext invitation token is returned once, to be put in a link. Only
 * its hash is stored.
 */

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?reason=required");
  return { supabase, user };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// ---------------------------------------------------------------------------
// The referrer's own code
// ---------------------------------------------------------------------------

/**
 * Idempotent by construction.
 *
 * `(user_id, program_key)` is unique, so a second call cannot mint a second
 * code even if two requests race — the loser's insert is refused and it reads
 * the winner's row. That is the property, and it lives in the schema rather
 * than in a read-then-write here.
 */
export async function ensureReferralCode(): Promise<
  { status: "ok"; code: string } | { status: "unavailable" }
> {
  const { supabase, user } = await requireUser();

  const program = await currentProgram();
  if (!program) return { status: "unavailable" };

  const { data: existing } = await supabase
    .from("referral_codes")
    .select("code")
    .eq("program_key", program.key)
    .maybeSingle();

  if (existing) return { status: "ok", code: existing.code };

  const code = codeFromBytes(randomBytes(16));
  const { error } = await supabase.from("referral_codes").insert({
    user_id: user.id,
    program_key: program.key,
    code,
  });

  if (error) {
    // Either the race above, or a collision on the code's unique index. Both
    // are answered by reading rather than by retrying blindly.
    const { data: after } = await supabase
      .from("referral_codes")
      .select("code")
      .eq("program_key", program.key)
      .maybeSingle();
    if (after) return { status: "ok", code: after.code };
    return { status: "unavailable" };
  }

  nullEventSink.record(
    buildReferralEvent({
      name: "referral.code_created",
      programKey: program.key,
      actorRef: actorRef(user.id),
      at: new Date(),
    }),
  );

  revalidatePath("/referrals");
  return { status: "ok", code };
}

// ---------------------------------------------------------------------------
// Inviting someone
// ---------------------------------------------------------------------------

export interface InviteResult extends ActionState<InviteField> {
  /** The link to share. Shown once — the token is not stored in plaintext. */
  link?: string;
}

export async function inviteByEmail(
  _previous: InviteResult,
  form: FormData,
): Promise<InviteResult> {
  const { supabase, user } = await requireUser();

  const email = field(form, "email");
  const errors = validateReferralInvite({ email, ownEmail: user.email ?? null });
  if (Object.keys(errors).length > 0) {
    return { status: "error", errors, values: { email: email ?? "" } };
  }

  const program = await currentProgram();
  if (!program) {
    return { status: "error", message: "No referral programme is running." };
  }

  const token = randomBytes(32).toString("base64url");
  const { error } = await supabase.from("referral_invitations").insert({
    user_id: user.id,
    program_key: program.key,
    email: email as string,
    token_hash: hashToken(token),
  });

  if (error) {
    // Two refusals a person can act on, told apart by the constraint that
    // fired rather than by re-deriving the rule here.
    if (error.message.includes("referral_invitation_rate_limit")) {
      return {
        status: "error",
        message: `You can send ${program.invitation_rate_limit_per_day} invitations a day. Try again tomorrow.`,
        values: { email: email ?? "" },
      };
    }
    if (error.message.includes("one_pending_per_address")) {
      return {
        status: "error",
        errors: { email: "You already have an invitation out to that address." },
        values: { email: email ?? "" },
      };
    }
    return {
      status: "error",
      message: "We could not create that invitation. Try again.",
      values: { email: email ?? "" },
    };
  }

  revalidatePath("/referrals");
  return { status: "idle", link: `/r/${token}` };
}

/**
 * Withdraw an invitation that has not been taken up.
 *
 * Takes FormData so a server component can bind it directly to a form. The id
 * arrives from the client and is not trusted for authorization: the update is
 * scoped by RLS to the caller's own invitations, so naming somebody else's id
 * matches no row rather than revoking theirs.
 *
 * `state = 'pending'` is in the predicate rather than in a read-then-check. An
 * invitation that has already been accepted must not be revocable, and making
 * that a condition of the update is what keeps it true under a double click.
 */
export async function revokeInvitation(form: FormData): Promise<void> {
  const { supabase } = await requireUser();

  const invitationId = field(form, "invitationId");
  if (!invitationId) return;

  await supabase
    .from("referral_invitations")
    .update({ state: "revoked" })
    .eq("id", invitationId)
    .eq("state", "pending");

  revalidatePath("/referrals");
}

// ---------------------------------------------------------------------------
// Resolving a link, and attributing the signup that may follow
// ---------------------------------------------------------------------------

/**
 * Record a touch.
 *
 * Runs for signed-out visitors, and touches no database at all — which is why
 * no referral table grants `anon` anything. The touch lives in the visitor's
 * own cookie, so resolving a link cannot enumerate members, cannot disclose
 * who owns a code, and cannot be used to probe which codes exist.
 *
 * One value, overwritten by each resolution: that *is* the last-touch
 * attribution model, implemented where the touch is recorded rather than as a
 * tie-break at attribution time.
 */
export async function resolveReferralCode(candidate: string): Promise<void> {
  const jar = await cookies();
  jar.set(
    TOUCH_COOKIE,
    encodeTouch({ candidate, touchedAt: new Date().toISOString() }),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: TOUCH_COOKIE_MAX_AGE_SECONDS,
    },
  );
}

export type AttributionOutcome =
  | "attributed"
  | "already_attributed"
  | "self_referral"
  | "outside_window"
  | "expired_invitation"
  | "existing_account"
  | "unknown_code"
  | "no_touch"
  | "invalid";

/**
 * Attribute a signup to whatever touch the new account arrived with.
 *
 * Called from signup *and* sign-in, because a project with email confirmation
 * enabled returns no session at signup — the first session that exists is the
 * one created when the person comes back and signs in. Attributing only at
 * signup would leave the engine silently inert on exactly those projects.
 *
 * Running at sign-in is safe because `attribute_referral` refuses a touch that
 * predates the account: a long-standing user who clicks a friend's link gets
 * `existing_account`, not a credited referrer.
 *
 * Never throws: a referral that cannot be attributed must not cost someone
 * their account, so every failure is a returned outcome and the cookie is
 * cleared either way.
 */
export async function attributeSignup(): Promise<AttributionOutcome> {
  const jar = await cookies();
  const touch = decodeTouch(jar.get(TOUCH_COOKIE)?.value);
  if (!touch) return "no_touch";

  // Consumed whatever happens. A touch that failed to attribute should not sit
  // there attaching itself to the next thing this browser does.
  jar.delete(TOUCH_COOKIE);

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return "invalid";

    const { data, error } = await supabase.rpc("attribute_referral", {
      candidate: touch.candidate,
      hashed_token: hashToken(touch.candidate),
      touched_at: touch.touchedAt,
    });

    if (error) return "invalid";

    const row = (data as Array<{ outcome: string }> | null)?.[0];
    const outcome = (row?.outcome ?? "invalid") as AttributionOutcome;

    if (outcome === "attributed") {
      const program = await currentProgram();
      if (program) {
        nullEventSink.record(
          buildReferralEvent({
            name: "referral.signup_attributed",
            programKey: program.key,
            actorRef: actorRef(user.id),
            at: new Date(),
          }),
        );
      }
      revalidatePath("/referrals");
    }

    return outcome;
  } catch {
    return "invalid";
  }
}

// ---------------------------------------------------------------------------
// Qualification
// ---------------------------------------------------------------------------

export type QualificationOutcome =
  | "qualified"
  | "not_yet"
  | "already_settled"
  | "no_referral"
  | "invalid";

/**
 * Evaluate the programme's predicate for the signed-in user.
 *
 * Idempotent — a second call on a qualified referral reports `already_settled`
 * and mints nothing, because the entitlement's unique constraint on
 * `referral_id` refuses a second one.
 *
 * Wrapped so it cannot throw. It fires on a domain event in another engine's
 * action (creating a trip), and a referral that fails to evaluate must never
 * take that action down with it — the same rule `rescheduleTripReminders`
 * follows for the same reason.
 */
export async function evaluateQualification(): Promise<QualificationOutcome> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return "invalid";

    const { data, error } = await supabase.rpc("evaluate_referral_qualification");
    if (error) return "invalid";

    const row = (data as Array<{ outcome: string }> | null)?.[0];
    const outcome = (row?.outcome ?? "invalid") as QualificationOutcome;

    if (outcome === "qualified") {
      const program = await currentProgram();
      if (program) {
        for (const name of [
          "referral.qualified",
          "referral.entitlement_earned",
        ] as const) {
          nullEventSink.record(
            buildReferralEvent({
              name,
              programKey: program.key,
              actorRef: actorRef(user.id),
              at: new Date(),
            }),
          );
        }
      }
      revalidatePath("/referrals");
    }

    return outcome;
  } catch {
    return "invalid";
  }
}
