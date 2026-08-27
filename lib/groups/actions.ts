"use server";

import { createHash, randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { field, type ActionState } from "@/lib/forms";
import { listCountryOptions } from "@/lib/trips/service";
import {
  deriveOwnCoordinationState,
  refreshOwnCoordinationState,
} from "./service";
import {
  validateActivityInput,
  validateGroupInput,
  validateInviteInput,
  validateMemberInput,
  validateTaskInput,
  type ActivityField,
  type GroupField,
  type InviteField,
  type MemberField,
  type TaskField,
} from "./validation";

/**
 * Group mutations.
 *
 * Same shape as every other action in this codebase, and the order matters:
 *
 *   session → validation → persistence (under RLS) → revalidate
 *
 * Authorization is not re-implemented here. Every write below is refused by a
 * policy when the caller lacks the role, so this file never asks "is this
 * person a coordinator" — it lets the database answer, and reports what it
 * said. A check here in addition to the policy would be a second source of
 * truth, and the one that drifts is always the one in application code.
 *
 * The user id always comes from the verified session, never from the form.
 */

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?reason=required");
  return { supabase, user };
}

/** A policy refusal and a genuine fault look different; say which happened. */
function refused(message: string): ActionState<never> {
  return { status: "error", message };
}

// ---------------------------------------------------------------------------
// The group itself
// ---------------------------------------------------------------------------

export async function createGroup(
  _previous: ActionState<GroupField>,
  form: FormData,
): Promise<ActionState<GroupField>> {
  const { supabase, user } = await requireUser();

  const input = {
    name: field(form, "name"),
    destinationCountryKey: field(form, "destinationCountryKey"),
    departOn: field(form, "departOn"),
    returnOn: field(form, "returnOn"),
  };

  const countries = await listCountryOptions();
  const errors = validateGroupInput(
    input,
    countries.map((c) => c.key),
  );
  if (Object.keys(errors).length > 0) {
    return { status: "error", errors, values: asValues(input) };
  }

  const { data: group, error } = await supabase
    .from("travel_groups")
    .insert({
      owner_id: user.id,
      name: input.name,
      destination_country_key: input.destinationCountryKey,
      depart_on: input.departOn,
      return_on: input.returnOn,
    })
    .select("id")
    .single();

  if (error || !group) {
    return {
      status: "error",
      message: "We could not create that group. Try again.",
      values: asValues(input),
    };
  }

  // The creator's own membership. Written as a second statement rather than a
  // trigger so it obeys the same insert policy as every other membership —
  // a row may only ever be created for yourself.
  const { error: membershipError } = await supabase
    .from("group_memberships")
    .insert({ group_id: group.id, user_id: user.id, role: "owner" });

  if (membershipError) {
    // A group whose creator is not in it is unreachable by anyone, including
    // them. Roll it back rather than leave an orphan.
    await supabase.from("travel_groups").delete().eq("id", group.id);
    return {
      status: "error",
      message: "We could not create that group. Try again.",
      values: asValues(input),
    };
  }

  revalidatePath("/groups");
  redirect(`/groups/${group.id}`);
}

function asValues(input: Record<string, string | null>) {
  return Object.fromEntries(
    Object.entries(input).map(([k, v]) => [k, v ?? ""]),
  ) as Partial<Record<GroupField, string>>;
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

/**
 * The plaintext token is returned once, to be put in the link. Only its hash
 * is stored, so a coordinator reading the invitation table cannot replay
 * somebody else's acceptance.
 */
function mintToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function inviteToGroup(
  _previous: ActionState<InviteField>,
  form: FormData,
): Promise<ActionState<InviteField>> {
  const { supabase, user } = await requireUser();

  const groupId = field(form, "groupId");
  if (!groupId) return refused("That group no longer exists.");

  const input = { email: field(form, "email"), role: field(form, "role") };
  const errors = validateInviteInput(input);
  if (Object.keys(errors).length > 0) return { status: "error", errors };

  const { hash } = mintToken();

  const { error } = await supabase.from("group_invitations").insert({
    group_id: groupId,
    email: input.email!.toLowerCase(),
    role: input.role ?? "member",
    token_hash: hash,
    invited_by: user.id,
  });

  if (error) {
    // The unique partial index is what makes a duplicate invitation a
    // no-op rather than a race: two coordinators inviting the same person at
    // the same moment produce one pending invitation, not two.
    if (error.code === "23505") {
      return {
        status: "error",
        errors: { email: "That person already has a pending invitation." },
      };
    }
    return refused("Only a coordinator can invite people to this group.");
  }

  revalidatePath(`/groups/${groupId}`);
  return { status: "idle" };
}

export async function revokeInvitation(form: FormData): Promise<void> {
  const { supabase } = await requireUser();
  const groupId = field(form, "groupId");
  const invitationId = field(form, "invitationId");
  if (!groupId || !invitationId) return;

  await supabase
    .from("group_invitations")
    .update({ state: "revoked", updated_at: new Date().toISOString() })
    .eq("id", invitationId);

  revalidatePath(`/groups/${groupId}`);
}

/**
 * Accepting an invitation.
 *
 * The token is the authorization: the invitee has no read on the invitations
 * table, so they cannot find the row without it. Lookup is by hash, and the
 * membership insert obeys the ordinary "only for yourself" policy.
 *
 * Idempotent. Accepting twice — a double-clicked link, a retried request —
 * leaves one membership and reports success both times, because the second
 * attempt finds the membership already there rather than failing on a
 * constraint the user cannot interpret.
 */
export async function acceptInvitation(token: string): Promise<
  { status: "joined" | "already_member"; groupId: string } | { status: "invalid" }
> {
  const { supabase } = await requireUser();

  // Through the definer function, not a select: no policy grants the invitee a
  // read of group_invitations, and none should — a pending guest list is the
  // group's business. The token is the authorization, and validate-join-close
  // happening in one statement is what makes a double-clicked link safe.
  const { data, error } = await supabase.rpc("accept_group_invitation", {
    hashed_token: hashToken(token),
  });

  if (error) return { status: "invalid" };

  const row = (data as Array<{ outcome: string; group_id: string | null }> | null)?.[0];
  if (!row || row.outcome === "invalid" || !row.group_id) {
    return { status: "invalid" };
  }

  revalidatePath(`/groups/${row.group_id}`);
  return {
    status: row.outcome === "joined" ? "joined" : "already_member",
    groupId: row.group_id,
  };
}

// ---------------------------------------------------------------------------
// The shared plan
// ---------------------------------------------------------------------------

export async function createGroupTask(
  _previous: ActionState<TaskField>,
  form: FormData,
): Promise<ActionState<TaskField>> {
  const { supabase, user } = await requireUser();

  const groupId = field(form, "groupId");
  if (!groupId) return refused("That group no longer exists.");

  const input = {
    title: field(form, "title"),
    detail: field(form, "detail"),
    dueOn: field(form, "dueOn"),
  };
  const errors = validateTaskInput(input);
  if (Object.keys(errors).length > 0) return { status: "error", errors };

  const { error } = await supabase.from("group_tasks").insert({
    group_id: groupId,
    title: input.title,
    detail: input.detail,
    due_on: input.dueOn,
    created_by: user.id,
  });

  if (error) return refused("Only a coordinator can add tasks to this group.");

  revalidatePath(`/groups/${groupId}`);
  return { status: "idle" };
}

export async function assignTask(form: FormData): Promise<void> {
  const { supabase } = await requireUser();
  const groupId = field(form, "groupId");
  const taskId = field(form, "taskId");
  const assigneeId = field(form, "assigneeId");
  if (!groupId || !taskId || !assigneeId) return;

  // Idempotent by constraint: assigning the same person the same task twice is
  // the same fact stated twice, so the duplicate is swallowed rather than
  // surfaced as an error the coordinator cannot act on.
  const { error } = await supabase.from("group_task_assignments").insert({
    group_id: groupId,
    task_id: taskId,
    assignee_id: assigneeId,
  });

  if (error && error.code !== "23505") return;

  revalidatePath(`/groups/${groupId}`);
}

export async function completeAssignment(form: FormData): Promise<void> {
  const { supabase, user } = await requireUser();
  const groupId = field(form, "groupId");
  const assignmentId = field(form, "assignmentId");
  if (!groupId || !assignmentId) return;

  // Scoped to the caller as well as the id: the policy already refuses someone
  // else's assignment, and saying so here keeps the intent legible.
  await supabase
    .from("group_task_assignments")
    .update({ completed_at: new Date().toISOString() })
    .eq("id", assignmentId)
    .eq("assignee_id", user.id);

  revalidatePath(`/groups/${groupId}`);
}

export async function setTaskState(form: FormData): Promise<void> {
  const { supabase } = await requireUser();
  const groupId = field(form, "groupId");
  const taskId = field(form, "taskId");
  const state = field(form, "state");
  if (!groupId || !taskId) return;
  if (!state || !["open", "blocked", "done"].includes(state)) return;

  await supabase
    .from("group_tasks")
    .update({ state, updated_at: new Date().toISOString() })
    .eq("id", taskId);

  revalidatePath(`/groups/${groupId}`);
}

export async function createGroupActivity(
  _previous: ActionState<ActivityField>,
  form: FormData,
): Promise<ActionState<ActivityField>> {
  const { supabase, user } = await requireUser();

  const groupId = field(form, "groupId");
  if (!groupId) return refused("That group no longer exists.");

  const input = {
    title: field(form, "title"),
    happensOn: field(form, "happensOn"),
    location: field(form, "location"),
    estimatedCost: field(form, "estimatedCost"),
    costCurrency: field(form, "costCurrency"),
  };
  const errors = validateActivityInput(input);
  if (Object.keys(errors).length > 0) return { status: "error", errors };

  const { error } = await supabase.from("group_activities").insert({
    group_id: groupId,
    title: input.title,
    happens_on: input.happensOn,
    location: input.location,
    estimated_cost: input.estimatedCost,
    cost_currency: input.costCurrency?.toUpperCase() ?? null,
    created_by: user.id,
  });

  if (error) return refused("Only a coordinator can add activities.");

  revalidatePath(`/groups/${groupId}`);
  return { status: "idle" };
}

/**
 * Opting in or out of an activity.
 *
 * Nobody is forced onto a shared itinerary — the group agrees a plan, and each
 * member says whether they are part of each piece of it.
 */
export async function setParticipation(form: FormData): Promise<void> {
  const { supabase, user } = await requireUser();
  const groupId = field(form, "groupId");
  const activityId = field(form, "activityId");
  const state = field(form, "state");
  if (!groupId || !activityId) return;
  if (!state || !["in", "out", "undecided"].includes(state)) return;

  await supabase.from("group_activity_participation").upsert(
    {
      group_id: groupId,
      activity_id: activityId,
      user_id: user.id,
      state,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "activity_id,user_id" },
  );

  revalidatePath(`/groups/${groupId}`);
}

// ---------------------------------------------------------------------------
// What a member controls about themselves
// ---------------------------------------------------------------------------

export async function updateOwnMembership(
  _previous: ActionState<MemberField>,
  form: FormData,
): Promise<ActionState<MemberField>> {
  const { supabase, user } = await requireUser();

  const groupId = field(form, "groupId");
  if (!groupId) return refused("That group no longer exists.");

  const input = {
    displayName: field(form, "displayName"),
    arrivalOn: field(form, "arrivalOn"),
    departureOn: field(form, "departureOn"),
  };
  const errors = validateMemberInput(input);
  if (Object.keys(errors).length > 0) return { status: "error", errors };

  const sharesReadiness = form.get("sharesReadiness") === "on";

  // Derived *before* the write, and written with it.
  //
  // The first version updated the row and then called a refresh that re-read
  // the consent flag it had just set. That read-after-write is what five
  // hosted runs reported as "1 shared but has nothing to report yet": the
  // refresh saw a stale `false`, took the withdrawal branch, and cleared the
  // state it was supposed to publish. Nothing about the derivation was wrong.
  //
  // Now consent and the word it governs land in one statement, so there is no
  // window in which they can disagree — and withdrawing consent clears the
  // published word in that same statement rather than a moment later.
  const coordinationState = sharesReadiness
    ? await deriveOwnCoordinationState(groupId)
    : null;

  const { error } = await supabase
    .from("group_memberships")
    .update({
      display_name: input.displayName,
      arrival_on: input.arrivalOn,
      departure_on: input.departureOn,
      shares_readiness: sharesReadiness,
      coordination_state: coordinationState,
      updated_at: new Date().toISOString(),
    })
    .eq("group_id", groupId)
    .eq("user_id", user.id);

  if (error) return refused("We could not save that. Try again.");

  revalidatePath(`/groups/${groupId}`);
  return { status: "idle" };
}

/** Links the caller's own trip to the group. The trip stays private. */
export async function linkTripToGroup(form: FormData): Promise<void> {
  const { supabase, user } = await requireUser();
  const groupId = field(form, "groupId");
  const tripId = field(form, "tripId");
  if (!groupId || !tripId) return;

  const { error } = await supabase.from("group_trips").insert({
    group_id: groupId,
    trip_id: tripId,
    user_id: user.id,
  });

  if (error && error.code !== "23505") return;

  await refreshOwnCoordinationState(groupId);
  revalidatePath(`/groups/${groupId}`);
}

export async function leaveGroup(form: FormData): Promise<void> {
  const { supabase, user } = await requireUser();
  const groupId = field(form, "groupId");
  if (!groupId) return;

  // Marked rather than deleted, so the shared plan keeps its history: a task
  // somebody completed before leaving stays completed by a known person.
  await supabase
    .from("group_memberships")
    .update({
      state: "left",
      shares_readiness: false,
      coordination_state: null,
      updated_at: new Date().toISOString(),
    })
    .eq("group_id", groupId)
    .eq("user_id", user.id);

  revalidatePath("/groups");
  redirect("/groups");
}

export async function removeMember(form: FormData): Promise<void> {
  const { supabase } = await requireUser();
  const groupId = field(form, "groupId");
  const memberId = field(form, "memberId");
  if (!groupId || !memberId) return;

  // The policy refuses this unless the caller coordinates the group. Removing
  // a member does not touch the tasks they completed or the activities they
  // joined — the group's plan survives one person leaving it.
  await supabase
    .from("group_memberships")
    .update({ state: "removed", updated_at: new Date().toISOString() })
    .eq("group_id", groupId)
    .eq("user_id", memberId);

  revalidatePath(`/groups/${groupId}`);
}
